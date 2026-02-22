# AI Focus Group Studio — 技術文件

**版本**：3.1
**更新日期**：2026-02-22

---

## 1. 系統架構

```
瀏覽器 (public/)                    伺服器 (server.js + agentStore.js)
┌──────────────┐                   ┌──────────────────────┐
│  index.html  │                   │  Express.js          │
│  app.js      │◄── SSE 串流 ────►│                      │
│  style.css   │◄── REST API ────►│  ┌────────────────┐  │
│              │                   │  │ 速率限制器     │  │
│  localStorage│                   │  │ 輸入驗證器     │  │
└──────────────┘                   │  │ Session Map    │  │
                                   │  │ Summary Locks  │  │
                                   │  └────────────────┘  │
                                   │         │            │
                                   │         ↓            │
                                   │  ┌────────────────┐  │
                                   │  │ OpenAI API     │  │
                                   │  │ Brave Search   │  │
                                   │  └────────────────┘  │
                                   │         │            │
                                   │         ↓            │
                                   │  ┌────────────────┐  │
                                   │  │ agentStore.js  │  │
                                   │  │ data/agents.json│  │
                                   │  └────────────────┘  │
                                   └──────────────────────┘
```

### 技術棧

| 層級 | 技術 | 版本 |
|------|------|------|
| 執行環境 | Node.js | >= 18 |
| 後端框架 | Express.js | ^4.21.0 |
| AI SDK | openai (npm) | ^4.73.0 |
| UUID | uuid (npm) | ^11.0.0 |
| 前端 | 原生 HTML/CSS/JS | — |
| 串流 | Server-Sent Events (SSE) | — |
| 客戶端儲存 | localStorage | — |

---

## 2. 檔案結構與行數

```
server.js          989 行   後端核心
agentStore.js      146 行   Agent 持久化模組
public/app.js     2085 行   前端邏輯
public/index.html  364 行   HTML 結構
public/style.css  1935 行   樣式
```

---

## 3. 後端 API 詳述

### 3.1 `GET /api/config`

回傳伺服器配置。

**回應**：
```json
{ "model": "gpt-5-mini" }
```

### 3.2 `POST /api/discuss`

生成 Agent 角色。

**請求**：
```json
{
  "topic": "討論主題",
  "agentCount": 4,
  "goalMeasurement": "成功目標（選填）",
  "focusGroupMode": "share_perspectives | brainstorm | debate",
  "selectedAgentIds": ["uuid-1", "uuid-2"],
  "sessionTimezone": "Asia/Hong_Kong"
}
```

**驗證規則**：
- `topic`：必填，字串，最多 2000 字元
- `agentCount`：必填，數字，2-10
- `goalMeasurement`：選填，最多 1000 字元
- `focusGroupMode`：選填，必須是三個合法值之一
- `selectedAgentIds`：選填，從 Library 選取的 Agent UUID 陣列
- `sessionTimezone`：選填，IANA 時區字串，存入 Session 物件供後續使用

**回應**：
```json
{
  "sessionId": "uuid",
  "agents": [
    {
      "name": "Dr. Sarah Chen",
      "role": "AI Ethics Researcher",
      "background": "10 years studying algorithmic bias at MIT.",
      "perspective": "cautious advocate",
      "color": "#4CAF50"
    }
  ]
}
```

生成後會進行 Agent 結構驗證，確保每個 Agent 都有 `name`、`role`、`background`、`perspective`、`color` 五個必要欄位。

### 3.3 `POST /api/agent/prepare`

Agent 預先研究主題，形成立場簡報。

**請求**：
```json
{
  "sessionId": "uuid",
  "agentIndex": 0,
  "agents": [...],
  "topic": "討論主題",
  "goalMeasurement": "目標（選填）",
  "webSearchEnabled": true
}
```

**行為**：
- `webSearchEnabled = true`：使用 OpenAI Responses API + `web_search` 工具進行真實研究
- `webSearchEnabled = false`：使用 Chat Completions 基於專業知識生成立場
- 產出 4-6 點 bullet points：初始立場、具體數據/案例、他人可能盲點、挑戰問題
- 簡報儲存至伺服器端 Session 的 `agentBriefs` Map

**回應**：
```json
{ "brief": "Agent 的私人立場筆記..." }
```

### 3.4 `POST /api/agent/respond`

取得單一 Agent 的串流回應。

**請求**：
```json
{
  "sessionId": "uuid",
  "agentIndex": 0,
  "agents": [...],
  "topic": "討論主題",
  "messages": [...],
  "userInterjection": "主持人插話（選填）",
  "webSearchEnabled": true,
  "goalMeasurement": "目標",
  "focusGroupMode": "share_perspectives",
  "round": 1,
  "totalRounds": 3,
  "sessionTimezone": "Asia/Hong_Kong"
}
```

**驗證規則**：
- `topic`：必填字串
- `agents`：必填非空陣列
- `agentIndex`：必填，範圍 0 到 agents.length-1
- 目標 Agent 必須有五個必要欄位

**Round-aware 行為**：
- `round = 1`：獨立意見模式。忽略其他 Agent 訊息，要求獨立分享觀點（防錨定效應）
- `round = 2 ~ n-1`：交鋒辯論模式。直接回應他人、引入新證據
- `round = totalRounds`（>2 時）：敍合結論模式。尋找共識、指出分歧、提出具體下一步

**安全措施**：
- 若伺服器端有對應 Session，優先使用伺服器端的 Agent 資料（不信任客戶端）
- 自動注入 Agent 的 Position Brief（若有）

**時區解析優先順序**：`req.body.sessionTimezone` → `session.sessionTimezone` → `'UTC'`

**回應格式**：SSE 串流
```
data: {"type":"chunk","content":"部分文字"}
data: {"type":"done","content":"完整文字","sources":[{"url":"...","title":"..."}]}
data: {"type":"error","error":"錯誤訊息"}
```

- `done` 事件的 `sources` 陣列包含 web search 分支找到的引用 URL 和標題
- 非 web search 分支的 `sources` 為空陣列
- sources 同時存入伺服器端 Session messages，供知識累積使用

**兩種呼叫路徑**：
- `webSearchEnabled = true`：使用 OpenAI Responses API + `web_search` 工具
- `webSearchEnabled = false`：使用 OpenAI Chat Completions API

**Temperature**：所有 API 呼叫均使用模型預設 temperature（不傳自訂值），確保與 `gpt-5-mini` 等僅支援預設 temperature 的模型相容。

### 3.5 `POST /api/search`

側欄快速搜尋。

**請求**：`{ "query": "搜尋關鍵字" }`

**回應**：
```json
{
  "results": [{ "title": "...", "url": "...", "description": "..." }],
  "source": "brave | mock | brave-error"
}
```

若未設定 `BRAVE_SEARCH_API_KEY`，回傳模擬結果。

### 3.6 `POST /api/summary`

生成討論摘要（SSE 串流）。

**防重複機制**：
1. 檢查 Session 的 `summaryGenerated` 旗標 → 409
2. 檢查 `summaryLocks` 原子鎖 → 429
3. 通過後加入鎖，完成後釋放

**回應格式**：SSE 串流，最終 `done` 事件包含 JSON：
```json
{
  "summary": "高管摘要...",
  "keyInsights": ["洞察1", "洞察2"],
  "todos": [{ "task": "...", "priority": "high", "rationale": "..." }],
  "dissent": "未解決分歧..."
}
```

### 3.7 `GET /api/session/:id` / `DELETE /api/session/:id`

取得或刪除伺服器端 Session。

### 3.8 Persistent Agent Library API

| 端點 | 說明 |
|------|------|
| `GET /api/agents` | 列出所有持久 Agent |
| `GET /api/agents/:id` | 取得單一 Agent（含 `accumulatedInsights`、`knowledgeSources`） |
| `POST /api/agents` | 手動建立 Agent（name、role、background、perspective、color） |
| `PUT /api/agents/:id` | 更新 Agent profile（allowedFields 白名單過濾） |
| `DELETE /api/agents/:id` | 刪除 Agent |
| `POST /api/agents/save-from-session` | 批量將 Session 中生成的 Agent 存入 Library |
| `POST /api/agents/:id/learn` | 觸發知識累積 |

#### `POST /api/agents/:id/learn` 詳述

**請求**：
```json
{
  "topic": "討論主題",
  "sessionId": "uuid",
  "recentContributions": "Agent 在本次討論的發言摘要",
  "sources": [{ "url": "https://...", "title": "Source Title" }]
}
```

**行為**：
1. 呼叫 `buildKnowledgeMergePrompt()` 生成合併 prompt（含今日日期 + 最多 10 條 source URLs）
2. LLM 將舊 `accumulatedInsights` + 新學習合併濃縮為 ~400 字（含日期標記）
3. 呼叫 `agentStore.updateKnowledge()` 更新 topic、insights、sources
4. `knowledgeSources` 以 FIFO 方式 append，上限 50 筆

---

## 4. Token 管理

### 訊息歷史截斷 (`truncateHistory`)

防止長時間討論超過模型 context window。

**策略**：
1. 永遠保留最近 8 條訊息
2. 剩餘訊息從新到舊填入，直到達到 token 預算
3. 被截斷的部分以 `[Earlier discussion omitted]` 提示替代
4. Token 估算：字元數 / 4

**預算**：
- Agent 回應：12,000 tokens
- 摘要生成：16,000 tokens

### 知識注入 Token 預算

| 來源 | Token 數 | 說明 |
|------|---------|------|
| `accumulatedInsights` | ~400-600 | 注入 Agent system prompt，每次討論都使用 |
| `knowledgeSources` | 0 | **不注入 prompt**，僅在 UI 顯示 |
| 知識合併時 source URLs | ~100-200 | 一次性使用（最多 10 條），不進入累積文字 |
| 時區日期行 | ~20 | `Current date and time: ...` 單行注入 |

---

## 5. Prompt 工程

### 5.1 角色生成 Prompt

要求 AI 為指定主題生成指定數量的多元面板成員，包含領域專家、實踐者、懷疑論者、終端使用者、業界人士的組合。回傳格式為 JSON 陣列。

### 5.2 Agent 預先研究 Prompt

討論開始前，每個 Agent 獨立研究主題：
- 啟用 Web Search 時使用 Responses API + `web_search` 工具
- 產出 4-6 點私人立場筆記（初始立場、數據案例、他人盲點、挑戰問題）
- 簡報使用與主題相同的語言
- 儲存至 Session 的 `agentBriefs` Map，後續注入系統 prompt

### 5.3 Agent 系統 Prompt 結構

```
身份區段：姓名、職稱、背景、觀點立場
日期時間：Current date and time: {localized date} ({timezone})  ← 新增
主題區段：<user_topic> 標籤包裝
語言規則：CJK 偵測後強制使用一致語言
目標區段：<user_goal> 標籤包裝（選填）
模式指令：對應討論模式的行為規範
階段指令：Round-aware 行為（獨立意見 / 交鋒辯論 / 敍合結論）
上下文感知規則：不重複、深化、聚焦
其他參與者列表
語氣與風格：真人說話方式（個人經歷、情緒反應、直接挑戰）
內容深度標準：具體案例、真實公司/研究、明確立場
網路搜尋指引（選填）
預先研究簡報（選填，注入為私人知識庫）
累積知識（選填，持久 Agent 的 accumulatedInsights）
```

#### 時區日期注入

`buildAgentSystemPrompt()` 接受 `sessionTimezone` 參數，使用 `toLocaleString()` 計算該時區的本地化日期時間：

```javascript
const tz = sessionTimezone || 'UTC';
const formatted = new Date().toLocaleString('en-US', {
  timeZone: tz, weekday: 'long', year: 'numeric', month: 'long',
  day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
});
// → "Current date and time: Saturday, February 22, 2026, 10:30 PM (Asia/Hong_Kong)"
```

### 5.4 Round-aware 階段指令

| Round | 階段名稱 | 行為 |
|-------|---------|------|
| 1 | INDEPENDENT OPINIONS | 獨立分享觀點，不參考他人，取明確立場 |
| 2 ~ n-1 | ENGAGEMENT & DEBATE | 直接回應他人、挑戰論點、引入新證據 |
| n (>2) | SYNTHESIS & CONCLUSIONS | 尋找共識、指出分歧、提出具體下一步 |

客戶端在 Round 1 過濾掉 `type === 'agent'` 的訊息，確保每個 Agent 只看到主題而不受其他人影響（Anti-Anchoring）。

### 5.5 上下文感知規則

- 不得重複自己或他人已提出的觀點
- 可接受的貢獻：新論點、新證據、直接挑戰、觀點綜合、未提及的具體案例
- 不可接受的貢獻：換個說法重述、無洞察的摘要
- 所有發言必須緊扣核心主題和目標
- 討論充分後應推向可執行的結論

### 5.6 人性化語氣要求

- 以真人口吻發言：第一人稱、分享直接經驗
- 具體故事：「我曾跟一個客戶合作...」、「在我做了 8 年 X 之後...」
- 真實情緒反應：驚訝、挫折、興奮、懷疑
- 直接反對：「我必須反駁這一點，因為...」而非「這是有趣的觀點，但...」
- 禁止企業/學術術語和陳腔濫調

### 5.7 內容深度標準

- 每次回應 150-300 字
- 必須包含至少一個具體案例、研究或數據點
- 引用真實公司名、真實研究、真實趨勢
- 取明確立場。不確定時，說你會押注什麼及原因
- 點名挑戰：指出 WHOSE 觀點有問題，解釋邏輯哪裡斷裂
- 深度優先：一個充分發展的論點勝過三個淺層觀察

### 5.8 CJK 語言偵測

摘要生成和 Agent 回應均會偵測主題是否包含 CJK 字元（`/[\u4e00-\u9fff\u3400-\u4dbf]/`）：
- CJK 主題：系統 prompt 和使用者 prompt 切換為中文版本
- 摘要 JSON 範例模板也會使用中文
- Agent 系統 prompt 加入 `LANGUAGE` 指令強制使用一致語言

### 5.9 網路搜尋指引

- 按需搜尋，不是每次發言都要搜尋
- 只在需要驗證聲明、引用統計數據、查找即時資料時搜尋
- 大多數發言應依賴自身專業知識
- 搜尋是補充手段，不是必要條件

### 5.10 知識合併 Prompt（`buildKnowledgeMergePrompt`）

合併持久 Agent 的新舊知識時使用。接受四個參數：`agent`、`topic`、`recentContributions`、`sources`。

**Prompt 結構**：
```
Today's date: YYYY-MM-DD

SOURCES REFERENCED IN THIS SESSION:
- Source Title (https://url)
- ...（最多 10 條）

[合併指令]
- 將新學習與舊知識合併濃縮為 ~400 字
- 時效性資料（市場數據、統計、政策變動）需註明學習日期（如 "as of Feb 2026"）
- 新舊衝突時以較新資料為準
- 保留最有價值的洞察，淘汰過時或低質量內容
```

---

## 6. 前端架構

### 6.1 狀態管理

全域 `state` 物件，包含：

```javascript
{
  currentView,        // 'setup' | 'discussion'
  sessionId,          // UUID 或 null
  topic,              // 主題字串
  agents,             // Agent 陣列
  messages,           // 訊息陣列（每則 agent 訊息含 .sources[]）
  rounds,             // 設定回合數
  currentRound,       // 當前回合（可恢復）
  agentCount,         // Agent 數量
  isPaused,           // 是否暫停
  isRunning,          // 是否進行中
  pendingInterjections, // 主持人插話佇列（陣列）
  _abortController,   // SSE 串流中止控制器
  summaryData,        // 摘要 JSON
  summaryGenerated,   // 是否已生成摘要
  webSearchEnabled,   // 是否啟用網路搜尋
  goalMeasurement,    // 目標字串
  focusGroupMode,     // 討論模式
  agentBriefs,        // Agent 預研究立場簡報 Map（name → brief）
  sessionTimezone     // IANA 時區字串（預設瀏覽器時區）
}
```

### 6.2 SSE 串流讀取器

`readSSEStream(response, onChunk, onDone, onError)`

- 60 秒超時機制（`Promise.race`）
- TextDecoder 串流模式 + 最終 flush
- JSON parse 錯誤記錄到 console.warn
- 超時時自動取消 reader

### 6.3 來源收集管道（Knowledge Provenance）

`triggerAgentLearning()` 從三個管道收集來源 URL，去重後 POST 到 `/api/agents/:id/learn`：

| 管道 | 來源 | 說明 |
|------|------|------|
| SSE sources | `msg.sources[]` | SSE done 回調中的 `data.sources`，透過 closure 變數捕獲 |
| Inline citations | Regex `[title](url)` | 從 Agent 回應文字中抽取內嵌引用 |
| Search results | `msg.results[]` | `type: 'search'` 訊息的搜尋結果 |

**去重**：使用 `Set` 以 URL 為 key，確保同一 URL 不重複儲存。

**SSE Source 捕獲模式**：使用 closure 變數（`capturedSources`、`retrySources`、`feedbackSources`）在 SSE done callback 中捕獲 sources，再存入 message 物件：
```javascript
let capturedSources = [];
await readSSEStream(response,
  onChunk, // 串流文字
  (data) => { capturedSources = data.sources || []; }, // done
  onError
);
msg.sources = capturedSources;
```

### 6.4 暫停/恢復機制

使用 Promise-based 等待模式（零 CPU 消耗）：

```javascript
// 暫停時等待 Promise
if (state.isPaused) await waitForResume();

// 恢復時 resolve Promise
function signalResume() { _resumeResolve(); }
```

### 6.5 事件處理

- **事件委派**：`sessionList` 和 `roleCards` 的點擊事件在 `DOMContentLoaded` 只綁定一次到父容器
- **介入佇列**：快速連續多條訊息存入 `pendingInterjections[]`，下一個 Agent 發言時 `splice(0)` 全部取出並 `join('\n\n')`

### 6.6 渲染優化

- **`createMessageElement()`**：共用訊息元素建構函數
- **DocumentFragment**：`renderChat()` 使用 Fragment 批次 DOM 操作
- **增量更新**：討論流程只用 `addMessage()` 增量添加

### 6.7 通知系統

`showNotification(message, type, duration)` 取代所有 `alert()`：

- type：`info` / `error` / `success` / `warning`
- 非阻塞 Toast，4 秒自動消失
- CSS 進入/離開過渡動畫

### 6.8 失敗重試

Agent 回應失敗時在錯誤訊息旁顯示 Retry 按鈕，點擊後重新呼叫 `retrySingleAgent()`。

### 6.9 時區選擇器

`DOMContentLoaded` 時使用 `Intl.supportedValuesOf('timeZone')` 填充 `<select>` 選項，預設選中瀏覽器時區。舊瀏覽器不支援 `supportedValuesOf` 時 fallback 為硬編碼常用時區清單。

---

## 7. 儲存機制

### 7.1 localStorage

**Key**：`fg_sessions`
**格式**：JSON 陣列，最新的在前

每個 Session 儲存：
```javascript
{
  id, topic, agents, messages, rounds, currentRound,
  summaryData, summaryGenerated, webSearchEnabled,
  goalMeasurement, focusGroupMode, sessionTimezone,
  createdAt, updatedAt
}
```

每則 Agent 訊息額外含 `sources: [{ url, title }]` 陣列，供知識累積使用。

**溢位處理**：`QuotaExceededError` 時自動移除最舊 Session 並遞迴重試。

### 7.2 伺服器端 Session Map

- 與客戶端鏡像，用於 Agent 回應時的安全驗證
- 24 小時 TTL，最多 100 個，每 30 分鐘清理一次
- 摘要生成時使用 `summaryLocks` Set 防止競態條件
- `agentBriefs`：儲存每個 Agent 的預研究立場簡報（name → brief），在 Agent 回應時自動注入 system prompt
- `sessionTimezone`：IANA 時區字串，由 `/api/discuss` 存入，`/api/agent/respond` 讀取
- `messages[]`：每則訊息含 `sources` 陣列（web search 分支的引用 URL）

### 7.3 Agent 持久化（`agentStore.js`）

- 資料存於 `data/agents.json`，原子寫入（`.tmp` → `rename`）
- 記憶體快取 + 檔案同步，避免每次讀取都走磁碟
- `knowledgeSources[]`：FIFO 陣列，上限 50 筆，每筆含 `url`、`title`、`date`、`sessionTopic`
- `updateKnowledge()` 接受 `{ topic, sessionId, newInsights, sources }` 四個參數

---

## 8. 安全架構

### 8.1 輸入驗證

**伺服器端**（`validateDiscussRequest` / `validateAgentRespondRequest`）：
- 型別檢查：字串、數字、陣列
- 範圍檢查：topic 2000 字元、goal 1000 字元、agentCount 2-10
- 列舉檢查：focusGroupMode 三個合法值
- 結構檢查：Agent 必須有 name/role/background/perspective/color

**前端**：
- `maxlength` 屬性限制輸入長度
- 角色編輯非空驗證
- 匯入檔案結構驗證

### 8.2 Prompt Injection 防護

使用者提供的主題和目標以 XML 標籤包裝後插入 system prompt：
```
<user_topic>使用者輸入的主題</user_topic>
<user_goal>使用者輸入的目標</user_goal>
```

Agent 回應時優先使用伺服器端 Session 中的 Agent 資料，不信任客戶端傳入的 `agents` 陣列。

### 8.3 速率限制

記憶體 Map 實作，以 IP 為 key：
- 視窗：60 秒
- 上限：30 次
- 超過回傳 429

### 8.4 XSS 防護

所有使用者輸入經 `escapeHtml()` 處理後才插入 DOM。引用連結經 regex 轉換後使用 `rel="noopener"` 和 `target="_blank"`。

---

## 9. 搜尋結果去重

Agent 回應中若已包含內嵌引用連結（`[text](url)` 格式），`onDone` 回調不再額外顯示搜尋卡片。判斷邏輯：

```javascript
const hasInlineCitations = /\[[^\]]+\]\(https?:\/\//.test(fullText);
if (!hasInlineCitations) { /* 顯示搜尋卡片 */ }
```

---

## 10. 匯出格式

### JSON 匯出欄位

```javascript
{
  topic, agents, messages, rounds, currentRound,
  goalMeasurement, focusGroupMode, webSearchEnabled,
  summaryGenerated, summary, exportedAt
}
```

### Markdown 匯出結構

```markdown
# Focus Group: {topic}

**Date:** YYYY-MM-DD
**Panelists:** Agent1, Agent2, ...
**Mode:** share_perspectives
**Goal:** {goal}
**Rounds:** 3/3
**Web Search:** Enabled

---

## Discussion
### AgentName (AgentRole)
{content}

---

## Summary
{summary}

### Key Insights
- {insight}

### Action Items
- [ ] **[high]** {task} — {rationale}
```

---

## 11. CSS 架構

### 設計系統

- **主題**：暗色（WhatsApp 風格）
- **色彩變數**：`:root` CSS custom properties
- **字體**：系統字體堆疊 (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)

### 響應式斷點

| 斷點 | 側欄 | Agent 面板 | 聊天寬度 | 角色卡片 |
|------|------|-----------|----------|----------|
| > 900px | 320px | 280px | 彈性 | 網格 |
| 600-900px | 240px | 隱藏 | 彈性 | 單欄 |
| < 600px | 隱藏 | 隱藏 | 100% | 單欄 |

### 關鍵動畫

- `messageIn`：訊息進入（0.2s 淡入上移）
- `blink`：串流游標閃爍（0.8s）
- `typingBounce`：打字指示器跳動（1.4s）
- `spin`：載入旋轉（0.8s）
- Toast 進入/離開過渡（0.3s）

---

*技術文件版本：3.1*
