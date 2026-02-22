# AI Focus Group Studio — 產品規格書

**版本**：6.0
**更新日期**：2026-02-22

---

## 1. 產品概述

**產品名稱**：AI Focus Group Studio
**產品類型**：網頁應用 (Web Application)
**核心價值**：讓使用者快速召集一組具備多元專業背景的 AI Agent，圍繞任意主題進行深度討論、辯論或腦力激盪，最終產出結構化摘要與待辦事項。Agent 可持久保存並跨 Session 累積知識，越用越進步。
**目標用戶**：需要進行議題研究、團隊頭腦風暴、用戶調研、決策分析的個人或團隊。

---

## 2. 功能規格

### 2.1 討論設置

| 功能 | 說明 | 限制 |
|------|------|------|
| 主題設定 | 使用者輸入討論主題或問題 | 最多 2000 字元 |
| 目標/成功標準 | 定義討論的成功衡量指標，引導 Agent 聚焦 | 最多 1000 字元，選填 |
| 討論模式 | 三種模式擇一 | 見下方說明 |
| Agent 數量 | 選擇參與討論的 Agent 人數 | 2-10 人 |
| 討論回合 | 設定討論輪次 | 1-10 回合 |
| 網路搜尋開關 | 啟用/停用 Agent 的網路搜尋能力 | 每個 Session 獨立設定 |
| 模型配置 | 使用的 AI 模型由環境變數控制 | 預設 gpt-5-mini |
| Session 時區 | 設定討論的日期/時間背景，Agent 會知道「今天是幾號」 | 預設瀏覽器時區，fallback UTC |
| 面板組合 | 三種組建模式擇一 | 見 2.7 |

#### 討論模式詳述

| 模式 | 行為特性 |
|------|----------|
| **分享觀點** (Share Perspectives) | Agent 從各自專業出發分享獨特觀點，互相補充，目標是全面探索主題 |
| **腦力激盪** (Brainstorm) | 以「yes, and...」思維為主，鼓勵大膽創新，著重創意和點子數量 |
| **辯論求解** (Debate) | 批判性評估每個論點，挑戰弱論點，透過嚴謹辯論找到最強解答 |

### 2.2 Agent 能力

| 功能 | 說明 |
|------|------|
| 預先研究 | 討論開始前，每個 Agent 並行研究主題（含 Web Search），形成 4-6 點立場簡報 |
| 角色扮演 | 每個 Agent 維持一致的人設（姓名、職稱、背景、觀點立場） |
| 人性化語氣 | 以真人口吻發言——分享個人經歷、表達真實情緒、直接點名挑戰對方 |
| 上下文感知 | 不重複已有觀點；必須深化、挑戰或提出新論點 |
| 目標導向 | 發言始終圍繞核心主題和目標，不偏題 |
| 內容品質 | 引用真實公司、研究、數據；區分事實、專家意見與推測；深度優先 |
| 防錨定效應 | Round 1 各 Agent 獨立發言，看不到其他人的回應 |
| 分階段策略 | Round 1 獨立意見 → 中間回合交鋒辯論 → 最終回合敍合結論 |
| 語言一致 | 自動偵測 CJK 字元，確保 Agent 回應和摘要使用與主題一致的語言 |
| 網路搜尋 | 啟用時可按需搜尋（非每次發言都搜尋），以 `[標題](URL)` 格式內嵌引用 |
| 累積知識注入 | 持久 Agent 的 `accumulatedInsights` 自動注入 system prompt |
| 時區感知 | Agent system prompt 注入當前日期時間（依 Session 時區計算） |
| 發言長度 | 每次回應 150-300 字 |

### 2.3 討論介面

| 功能 | 說明 |
|------|------|
| 聊天氣泡 | WhatsApp 風格，每個 Agent 有獨立顏色 |
| 即時串流 | SSE 逐字顯示回應，帶打字游標動畫 |
| 打字指示器 | 三點跳動動畫顯示正在回應的 Agent |
| Agent 高亮 | 右側面板標示正在發言的 Agent |
| 回合指示 | 顯示當前回合 / 總回合數 |
| 引用連結 | 回應中的 `[text](url)` 格式自動轉為可點擊連結 |
| 搜尋卡片 | Agent 搜尋結果以獨立卡片顯示（與內嵌引用去重） |
| 引用來源面板 | 右側欄自動彙整所有引用 URL，標示來源 Agent 及顏色 |
| Markdown 渲染 | 支援粗體、斜體、行內代碼、有序/無序列表、連結 |
| 時間戳記 | 每則訊息顯示完成時間 |
| Library 徽章 | 來自 Library 的 Agent 在角色卡片上顯示 "Library" 標籤 |
| 討論標題日期 | 討論開始後標題顯示日期與時區（如 `Topic (Feb 22, 2026 Asia/Hong_Kong)`） |

### 2.4 主持人介入

| 功能 | 說明 |
|------|------|
| 暫停/恢復 | 隨時暫停討論，恢復時從暫停處繼續（Promise-based，零 CPU 消耗） |
| 插話 | 以主持人身份加入意見或指引方向 |
| 多條排隊 | 快速連續多條訊息不遺失，以佇列方式合併後傳遞給下一個 Agent |
| 討論後追問 | 討論結束後仍可輸入追問，最多 5 個 Agent 回應（優先選最近發言者） |

### 2.5 摘要與輸出

| 功能 | 說明 |
|------|------|
| 結構化摘要 | 高管摘要 + 關鍵洞察列表 + 待辦事項 + 未解決分歧 |
| 待辦事項 | 每項含任務描述、優先級（高/中/低）、理由 |
| 審批機制 | 勾選批准或點 X 移除待辦事項，帶動畫過渡 |
| 一次性限制 | 每個 Session 只能生成一次摘要（前端 + 後端雙重防護 + 原子鎖） |
| 知識累積觸發 | 摘要生成完成後，自動背景觸發持久 Agent 的知識累積 |
| JSON 匯出 | 包含主題、Agent、訊息、回合、目標、模式、搜尋開關、摘要 |
| Markdown 匯出 | 包含元資料區塊（日期、模式、目標、回合、搜尋開關） |
| JSON 匯入 | 驗證檔案結構後匯入，恢復所有 Session 狀態 |

### 2.6 Session 管理

| 功能 | 說明 |
|------|------|
| 自動儲存 | 每次狀態變更自動存入 localStorage |
| 溢位防護 | localStorage 容量不足時自動移除最舊 Session 並重試 |
| Session 列表 | 左側欄顯示所有已存 Session，點擊切換 |
| 狀態恢復 | 載入 Session 時恢復所有狀態（含 currentRound） |
| 伺服器端清理 | 24 小時過期，上限 100 個 Session，每 30 分鐘自動清理 |

### 2.7 Persistent Agent Library（持久 Agent 庫）

| 功能 | 說明 |
|------|------|
| Agent Library 側欄 | 左側欄底部顯示所有持久 Agent（頭像 + 名字 + 職稱 + Session 數） |
| 建立 Agent | 「+」按鈕開啟 Create Agent Modal（姓名、職稱、背景、觀點、顏色選擇器） |
| Agent 詳情頁 | 點擊 Library Agent 查看完整資料、累積知識、參與過的主題 |
| 編輯/刪除 Agent | 在詳情頁可編輯 Profile 或永久刪除 |
| 面板組合模式 | 三種模式選擇 Agent 來源 |
| Agent Picker | 勾選卡片式 UI，顯示 Agent 資料 + 過往 Session 數 + 選取狀態 |
| Save to Library | 角色生成後，一鍵將新 Agent 批量存入 Library |
| 伺服器端持久化 | 資料存於 `data/agents.json`，原子寫入（`.tmp` → `rename`） |
| 知識累積 | 摘要生成後自動觸發；LLM 將舊知識 + 新學習合併濃縮為 ~400 字摘要（含日期標記） |
| 知識溯源 | 自動追蹤每條知識的來源 URL、學習日期、來源主題（`knowledgeSources[]`，FIFO 上限 50 筆） |
| 來源收集 | 從三個管道收集：SSE 回應 sources、內嵌引用 `[title](url)` regex、搜尋結果；去重後儲存 |
| 知識注入 | 持久 Agent 的 `accumulatedInsights` 注入 system prompt，自然融入討論 |
| 日期感知合併 | 知識合併 prompt 包含今日日期 + source URLs；時效性資料須標注學習日期，新舊衝突以較新為準 |

#### 面板組合模式

| 模式 | 行為 |
|------|------|
| **Generate New**（預設） | AI 全新生成所有 Agent，與現有行為完全一致 |
| **Pick from Library** | 從 Agent Library 勾選 Agent，不進行生成 |
| **Mix** | 選取部分 Library Agent + AI 自動生成剩餘角色補齊人數 |

#### Agent 資料模型

```json
{
  "id": "uuid-v4",
  "name": "Dr. Sarah Chen",
  "role": "AI Ethics Researcher",
  "background": "10 years studying algorithmic bias...",
  "perspective": "cautious advocate",
  "color": "#4CAF50",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601",
  "knowledgeBase": {
    "topicsDiscussed": [{ "topic": "...", "sessionId": "...", "date": "..." }],
    "sessionCount": 0
  },
  "accumulatedInsights": "LLM 濃縮的累積知識（~400 字上限，含日期標記）",
  "knowledgeSources": [
    { "url": "https://...", "title": "Source Title", "date": "ISO 8601", "sessionTopic": "討論主題" }
  ]
}
```

- `knowledgeSources`：來源追蹤陣列，FIFO 上限 50 筆，不注入 prompt，僅在 Agent 詳情頁 UI 顯示

---

## 3. 使用者流程

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  設定主題    │────→│  選擇面板組合 │────→│  生成/選取角色 │
│  選擇模式    │     │  Gen/Lib/Mix  │     │  Save to Lib   │
│  設定目標    │     └──────────────┘     └───────┬───────┘
└─────────────┘                                   │
                                                  ↓
                                          ┌───────────────┐
                                          │  Agent 預研究  │  ← 並行 Web Search
                                          │  形成立場簡報  │
                                          └───────┬───────┘
                                                  ↓
                                          ┌───────────────┐
                                          │  R1: 獨立意見  │  ← 防錨定效應
                                          │  R2+: 交鋒辯論 │  ← 累積知識注入
                                          │  Rn: 敍合結論  │
                                          │  暫停 / 介入   │
                                          └───────┬───────┘
                                                  ↓
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  匯出報告   │←────│  生成摘要    │←────│  知識累積      │
│  JSON / MD  │     │  審批待辦    │     │  （背景自動）  │
└─────────────┘     └──────────────┘     └───────────────┘
```

---

## 4. 安全與防護

| 機制 | 說明 |
|------|------|
| 輸入驗證 | 伺服器端驗證主題長度、Agent 數量範圍、模式合法性、Agent 結構完整性 |
| 前端驗證 | textarea maxlength、角色編輯非空驗證、匯入檔案結構驗證 |
| Prompt Injection | 使用者輸入以 `<user_topic>` / `<user_goal>` 標籤包裝 |
| 速率限制 | 每 IP 每分鐘 30 次 API 請求 |
| 競態防護 | 摘要生成使用前端 disable + 後端原子鎖 |
| XSS 防護 | 所有使用者輸入經 `escapeHtml()` 處理 |
| Session 安全 | 優先使用伺服器端 Agent 資料（不信任客戶端傳來的 agents） |
| Agent 資料安全 | 原子寫入（`.tmp` → `rename`）防止 crash 損壞 |

---

## 5. 無障礙支援

| 元素 | 處理 |
|------|------|
| Modal | `role="dialog"` `aria-modal="true"` `aria-labelledby` |
| 聊天區域 | `role="log"` `aria-live="polite"` |
| 圖示按鈕 | 全部加 `aria-label` |
| Toggle | `role="switch"` `aria-label` |
| 鍵盤操作 | Escape 關閉最上層 Modal |
| Body 捲動鎖定 | Modal 開啟時鎖定背景捲動 |

---

## 6. 響應式設計

| 斷點 | 行為 |
|------|------|
| > 900px | 完整三欄：左側欄（含 Agent Library）+ 聊天區 + 右側 Agent 面板 |
| 600-900px | 兩欄：縮小左側欄（Library 高度限制 150px）、隱藏右側 Agent 面板、角色卡片單欄 |
| < 600px | 單欄：隱藏左側欄、全寬聊天區、Agent Picker 單欄、允許 body 捲動 |

---

## 7. 向後相容性

| 場景 | 處理 |
|------|------|
| 現有 Session | Agent 沒有 `id` 欄位 → 系統視為 ad-hoc Agent，行為完全不變 |
| 新增欄位 | `id`、`accumulatedInsights` 都是可選的，不影響現有流程 |
| `data/agents.json` 不存在 | 自動建立空陣列 |
| API 路徑 | `/api/agents` 不與現有 `/api/agent/prepare` 衝突 |
| `knowledgeSources` 不存在 | 現有 Agent 無此欄位時以 `\|\| []` fallback，UI 自動隱藏空白區段，無需遷移 |
| `sessionTimezone` 不存在 | 舊 Session 無此欄位時 fallback 為 `'UTC'`，不影響討論功能 |

---

## 8. 未實作功能（未來規劃）

| 功能 | 複雜度 | 說明 |
|------|--------|------|
| 向特定 Agent 提問 | 中 | 使用者可點選 Agent 後針對該 Agent 提問 |
| 即時摘要 | 高 | 討論進行中即時更新摘要 |
| 任務轉化 | 高 | 批准的待辦事項可轉化為具體執行指令 |
| Agent 分享/匯入 | 低 | Library Agent 匯出為 JSON 分享給他人 |

---

## 9. 驗收清單

### 核心功能

- [x] 設定主題、目標、模式、Agent 數量、回合數
- [x] AI 自動生成多元角色
- [x] 使用者可修改角色
- [x] WhatsApp 風格即時串流聊天
- [x] Agent 按需網路搜尋（非每次都搜尋）
- [x] 搜尋引用去重（內嵌引用 vs 搜尋卡片）
- [x] 使用者可暫停/恢復討論
- [x] 使用者可插話引導方向
- [x] 多條快速訊息不遺失
- [x] 討論後追問（最多 5 Agent 回應）
- [x] 結構化摘要 + 待辦事項
- [x] 一次性摘要（雙重防護）
- [x] 待辦審批（勾選/移除）
- [x] JSON / Markdown 匯出（含完整元資料）
- [x] JSON 匯入（結構驗證）
- [x] localStorage 自動儲存 + 溢位防護
- [x] 伺服器端 Session 清理
- [x] 輸入驗證 + Prompt Injection 防護
- [x] 速率限制
- [x] Toast 通知取代 alert()
- [x] 按鈕載入動畫
- [x] 無障礙支援
- [x] 響應式設計（桌面/平板/手機）
- [x] 失敗重試按鈕
- [x] 模型名稱可設定化
- [x] Agent 預先研究機制（含 Web Search）
- [x] Anti-Anchoring — Round 1 獨立發言防錨定效應
- [x] 分階段討論策略（獨立意見 → 交鋒 → 敍合）
- [x] 人性化 Agent 語氣（真人口吻、個人經歷、直接挑戰）
- [x] CJK 語言偵測（Agent 回應 + 摘要語言一致）
- [x] 引用來源面板（右側欄自動彙整 URL）
- [x] Markdown 渲染（粗體、斜體、列表、連結）
- [x] Session 重載後 Summary 按鈕保持顯示

### Persistent Evolving Agents

- [x] Agent Library 側欄（頭像 + 名字 + 職稱 + Session 數）
- [x] Create Agent Modal（含 Color Picker）
- [x] Agent 詳情頁（含累積知識、參與主題）
- [x] 編輯 Agent Profile
- [x] 刪除 Agent
- [x] Panel Composition 選擇器（Generate New / Pick from Library / Mix）
- [x] Agent Picker 勾選卡片 UI（含選取狀態、計數器）
- [x] Save to Library 批量儲存
- [x] `data/agents.json` 原子寫入持久化
- [x] 伺服器重啟後 Agent 資料保留
- [x] 知識累積（摘要生成後自動觸發 LLM 合併）
- [x] 累積知識注入 system prompt
- [x] Library Agent 在角色卡片顯示 "Library" 徽章
- [x] 向後相容（現有 ad-hoc Agent 行為不變）

### Knowledge Provenance & Session Timezone

- [x] `knowledgeSources[]` 來源追蹤陣列（FIFO 上限 50 筆）
- [x] 來源收集三管道（SSE sources、inline citation regex、搜尋結果）去重
- [x] 日期感知知識合併（LLM prompt 注入今日日期 + source URLs）
- [x] 時效性資料自動標注學習日期（如 "as of Feb 2026"）
- [x] Agent 詳情頁 Knowledge Sources 區段（可點擊 URL + 日期 + 來源主題）
- [x] Session 時區選擇器（預設瀏覽器時區，Intl API 填充選項）
- [x] Agent system prompt 注入當前日期時間（依 Session 時區計算）
- [x] 討論標題顯示日期與時區
- [x] 向後相容（`knowledgeSources` / `sessionTimezone` 缺失時自動 fallback）

*文件版本：6.0*
