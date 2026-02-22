# AI Focus Group Studio

多個 AI Agent 以不同專業背景、觀點圍繞你設定的主題進行深度討論的互動式平台。Agent 可持久保存、跨 Session 累積知識，越用越聰明。

## 功能總覽

### 核心功能

- **AI 焦點小組**：2-10 個 AI Agent，各自擁有獨特姓名、職稱、背景與觀點
- **預先研究機制**：討論開始前，每個 Agent 根據自身角色與專長，由 AI 動態生成搜尋查詢並並行研究主題，帶著真實知識和數據進入討論
- **Anti-Anchoring（防錨定效應）**：Round 1 各 Agent 獨立發言，不受其他人觀點影響
- **分階段討論策略**：Round 1 獨立意見 → 中間回合交鋒辯論 → 最終回合敍合結論
- **三種討論模式**：分享觀點 / 腦力激盪 / 辯論求解
- **人性化回應**：Agent 以真人口吻發言，分享具體經歷、引用真實數據、直接點名挑戰對方觀點
- **即時串流**：Agent 回應透過 SSE 逐字即時串流到介面

### Persistent Evolving Agents（持久進化 Agent）

- **Agent Library**：左側欄 Agent 庫，儲存可重複使用的 Agent 角色
- **跨 Session 知識累積**：每次討論結束後，LLM 自動將新學習與舊知識合併濃縮為 `accumulatedInsights`（含日期標記）
- **Knowledge Provenance（知識溯源）**：自動追蹤每條知識的來源 URL、學習日期、來源主題，Agent 詳情頁可查看完整來源清單
- **三種面板組合模式**：Generate New（全新生成）/ Pick from Library（從庫中選取）/ Mix（混合搭配）
- **Auto-save to Library**：討論結束後自動將新 Agent 存入 Library（也可手動批量存入）
- **伺服器端持久化**：Agent 資料存於 `data/agents.json`，原子寫入防止損壞，伺服器重啟不遺失
- **知識注入**：持久 Agent 的累積知識自動注入 system prompt，使其在後續 Session 中能提供更深入的見解

### 討論與摘要

- **主持人介入**：討論中可隨時暫停、插話引導方向；討論結束後仍可追問（最多 5 個 Agent 回應）
- **可插拔式網路搜尋**：支援 OpenAI / Exa.ai / Firecrawl / Brave 四種搜尋提供者，可在 UI 自由切換；外部 provider 成本最低僅 OpenAI 的 1/10
- **快速搜尋面板**：側欄獨立搜尋，可選擇不同搜尋 provider
- **引用來源面板**：右側欄自動彙整討論中所有引用連結，標示來源 Agent
- **自動摘要**：討論結束後生成結構化摘要、關鍵洞察、待辦事項；可隨時重開查看
- **CJK 語言偵測**：自動偵測主題語言，確保 Agent 回應和摘要使用一致語言
- **Session 時區**：可設定討論時區，Agent 會知道「今天是幾號」，討論標題顯示日期與時區

### 管理與匯出

- **匯出匯入**：JSON / Markdown 匯出（含完整元資料 + 引用來源清單），JSON 匯入
- **Session 管理**：瀏覽器 localStorage 自動儲存；伺服器端記憶體同步
- **暗色主題**：WhatsApp 風格聊天介面，支援桌面、平板、手機響應式佈局
- **Toast 通知**：所有提示以非阻塞式 Toast 呈現，取代傳統 alert()

## 快速開始

### 環境需求

- Node.js >= 18
- OpenAI API Key（必要）
- 搜尋 Provider API Key（選填）：Exa.ai / Firecrawl / Brave，至少設一個即可啟用網路搜尋

### 安裝與啟動

```bash
# 安裝依賴
npm install

# 設定環境變數
cp .env.example .env
# 編輯 .env 填入你的 OPENAI_API_KEY

# 啟動伺服器
npm start
```

啟動後前往 `http://localhost:3001`。

### 環境變數

| 變數 | 必填 | 預設值 | 說明 |
|------|------|--------|------|
| `OPENAI_API_KEY` | 是 | — | OpenAI API 金鑰 |
| `OPENAI_MODEL` | 否 | `gpt-5-mini` | 使用的模型名稱（可更換為任何 OpenAI 相容模型，見下方相容性說明） |
| `EXA_API_KEY` | 否 | — | [Exa.ai](https://exa.ai) 搜尋 API 金鑰 |
| `FIRECRAWL_API_KEY` | 否 | — | [Firecrawl](https://firecrawl.dev) 搜尋 API 金鑰 |
| `BRAVE_SEARCH_API_KEY` | 否 | — | Brave Search API 金鑰 |
| `PORT` | 否 | `3001` | 伺服器監聽埠號 |

### 模型相容性

所有 OpenAI API 呼叫均使用模型預設 temperature（不傳自訂值），確保與 `gpt-5-mini` 等僅支援 `temperature=1` 的模型相容。如需切換模型，只需修改 `OPENAI_MODEL` 環境變數即可。

## 使用流程

```
設定主題 → 選擇模式/Agent數/回合數 → 選擇面板組合 → 生成/選取角色 → 修改角色（選填）
     ↓                                    ↓                                     ↓
 設定目標（選填）              Generate New / Library / Mix     Agent 預先研究主題（並行）
     ↓                                                                          ↓
 選擇搜尋 Provider / 設定時區                                      Round 1: 獨立意見（防錨定效應）
                                                                          ↓
                                                          Round 2+: 交鋒辯論 → 暫停/介入/恢復
                                                                          ↓
                                                          最終 Round: 敍合結論 → 生成摘要
                                                                          ↓
                                                              知識累積（持久 Agent 自動學習）
                                                                          ↓
                                                                  審批待辦 → 匯出報告
```

1. **設定主題**：輸入討論主題（最多 2000 字）
2. **選擇模式**：分享觀點 / 腦力激盪 / 辯論求解
3. **選擇人數與回合**：Agent 2-10 個，回合 1-10 輪
4. **設定目標**（選填，最多 1000 字）：定義討論成功指標
5. **選擇搜尋提供者**（選填）：OpenAI / Exa.ai / Firecrawl / Brave / 停用，可調整每次查詢結果數量
6. **設定時區**（選填）：預設為瀏覽器時區，Agent 會知道當前日期時間
7. **選擇面板組合**：
   - **Generate New**：AI 全新生成所有角色
   - **Pick from Library**：從 Agent Library 勾選已保存的 Agent
   - **Mix**：選取部分 Library Agent + AI 自動生成剩餘角色
8. **生成/選取角色**：角色顯示後可點卡片修改
9. **開始討論**：Agent 先並行研究主題、形成立場簡報，再進入討論
10. **Round 1 獨立發言**：每個 Agent 獨立分享觀點，不受他人影響（防錨定效應）
11. **Round 2+ 交鋒辯論**：Agent 直接點名挑戰對方觀點，引入新證據
12. **主持人介入**：暫停、插話引導、恢復（支援快速連續多條訊息）
13. **討論結束**：新 Agent 自動存入 Library，知識累積自動觸發
14. **生成摘要**：一鍵生成結構化摘要和待辦事項（可隨時重開查看）
15. **匯出**：JSON 或 Markdown 格式匯出完整討論記錄（含引用來源清單）

## API 端點

### Session & Discussion

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/` | 前端頁面 |
| GET | `/api/config` | 取得伺服器配置（模型名稱、可用搜尋 providers） |
| POST | `/api/discuss` | 生成 Agent 角色（支援 `selectedAgentIds` 從 Library 選取，`sessionTimezone` 設定時區） |
| POST | `/api/agent/prepare` | Agent 預先研究主題、形成立場簡報（含 Web Search） |
| POST | `/api/agent/respond` | 取得單一 Agent 的串流回應 (SSE)，自動注入累積知識 + 時區日期 |
| POST | `/api/search` | 網路搜尋（支援 Exa / Firecrawl / Brave，由 `provider` 參數指定） |
| POST | `/api/summary` | 生成討論摘要 (SSE)，支援 CJK 語言偵測 |
| GET | `/api/session/:id` | 取得 Session 資料 |
| DELETE | `/api/session/:id` | 刪除 Session |

### Persistent Agent Library

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/agents` | 列出所有持久 Agent |
| GET | `/api/agents/:id` | 取得單一 Agent（含累積知識） |
| POST | `/api/agents` | 手動建立 Agent |
| PUT | `/api/agents/:id` | 更新 Agent profile |
| DELETE | `/api/agents/:id` | 刪除 Agent |
| POST | `/api/agents/save-from-session` | 將 Session 中生成的 Agent 批量存入 Library |
| POST | `/api/agents/:id/learn` | Session 結束後觸發知識累積（LLM 合併濃縮 + 來源追蹤） |

## 技術棧

| 層級 | 技術 |
|------|------|
| 後端 | Node.js + Express |
| 前端 | 原生 HTML / CSS / JavaScript（零框架） |
| AI 模型 | OpenAI Chat Completions API + Responses API (web_search) |
| 搜尋 | 可插拔式：Exa.ai / Firecrawl / Brave / OpenAI（選填，0 新 npm 依賴） |
| 即時通訊 | Server-Sent Events (SSE) |
| Session 儲存 | 瀏覽器 localStorage + 伺服器記憶體 Map |
| Agent 持久化 | `data/agents.json`（原子寫入 + 記憶體快取） |

## 專案結構

```
ai-focus-group-studio/
├── server.js              # 後端核心（989 行）— API 端點、Prompt 工程、SSE 串流
├── agentStore.js          # Agent 持久化模組（146 行）— CRUD、原子寫入、知識更新
├── public/
│   ├── index.html         # HTML 結構（364 行）— 含 Agent Library UI、Agent Picker
│   ├── app.js             # 前端邏輯（2085 行）— 含 Library 管理、知識累積觸發
│   └── style.css          # 樣式（1935 行）— 含 Library/Picker/Panel Composition 樣式
├── data/
│   └── agents.json        # Agent 持久化資料（執行時自動建立）
├── .env.example           # 環境變數範本
├── package.json           # 依賴定義
├── SPEC.md                # 產品規格書
├── TECHNICAL.md           # 技術文件
└── README.md              # 本文件
```

## Agent 資料模型

```json
{
  "id": "uuid-v4",
  "name": "Dr. Sarah Chen",
  "role": "AI Ethics Researcher",
  "background": "10 years studying algorithmic bias...",
  "perspective": "cautious advocate",
  "color": "#4CAF50",
  "createdAt": "2026-02-22T10:00:00Z",
  "updatedAt": "2026-02-22T15:30:00Z",
  "knowledgeBase": {
    "topicsDiscussed": [
      { "topic": "...", "sessionId": "...", "date": "..." }
    ],
    "sessionCount": 3
  },
  "accumulatedInsights": "LLM 濃縮的累積知識（~400 字上限，含日期標記）",
  "knowledgeSources": [
    { "url": "https://...", "title": "Source Title", "date": "ISO 8601", "sessionTopic": "討論主題" }
  ]
}
```

`knowledgeSources` 為來源追蹤陣列（FIFO，上限 50 筆），記錄每條知識來自哪個 URL，不注入 prompt，僅在 UI 顯示。

## 安全機制

- 伺服器端輸入驗證（主題長度、Agent 數量範圍、Agent 結構）
- Prompt Injection 防護（使用者輸入以 XML 標籤包裝）
- API 速率限制（每分鐘 30 次）
- 摘要生成原子鎖（防止競態條件）
- Session 自動清理（24 小時過期，上限 100 個）
- localStorage 溢位自動處理
- XSS 防護（所有使用者輸入經 escapeHtml 處理）
- Agent 資料原子寫入（`.tmp` → `rename` 防止 crash 損壞）

## 討論品質機制

| 機制 | 說明 |
|------|------|
| **預先研究** | 每個 Agent 在討論前根據自身角色由 AI 動態生成搜尋查詢，帶著差異化的真實數據形成立場簡報 |
| **Anti-Anchoring** | Round 1 過濾掉其他 Agent 的訊息，每人只看到主題獨立發言 |
| **分階段策略** | Round 1 獨立意見 → 中間回合交鋒 → 最終回合敍合結論 |
| **人性化語氣** | 要求分享個人經歷、真實情緒反應、直接點名挑戰，禁止企業術語 |
| **語言一致** | CJK 偵測確保中文主題的 Agent 全程用中文回覆 |
| **上下文感知** | 不重複觀點，必須深化、挑戰或引入新證據 |
| **知識累積** | 持久 Agent 跨 Session 累積學習，後續討論中自然運用過往經驗 |
| **知識溯源** | 自動追蹤知識來源 URL、日期、主題；合併時標注時效性資料日期 |
| **時區感知** | Agent 知道當前日期時間，避免引用過時資訊；討論標題顯示日期與時區 |

## 授權

MIT
