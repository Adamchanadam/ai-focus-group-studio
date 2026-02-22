# AI Focus Group Studio — Claude 開發筆記

> 每次新 session 必讀。遇到問題先查本文件，再查官方文件，不要猜。

---

## 索引

- [1. 偵錯 SOP](#1-偵錯-sop) — 出問題時先看這裡
- [2. gpt-5-mini 參數速查](#2-gpt-5-mini-參數速查) — API 呼叫前必查
- [3. 搜尋 Provider API](#3-搜尋-provider-api) — Exa / Firecrawl / Brave
- [4. 專案架構](#4-專案架構) — 檔案結構與 endpoint 對照
- [5. 踩坑記錄](#5-踩坑記錄) — 已解決的 bug，避免重蹈覆轍
- [6. 開發守則](#6-開發守則) — 每次改 code 前過一遍

---

## 1. 偵錯 SOP

**出問題時按這個順序做，不要跳步驟：**

1. `list_network_requests` → `get_network_request` 看真實 request/response
2. 有回應再看 code，不要憑空讀 code 猜問題
3. 需要加 log 時：記錄輸入大小、關鍵變數值、迴圈次數
4. 用最小案例重現：`evaluate_script` 直接發 fetch 測試
5. 修完後用 Chrome DevTools 做端到端驗證
6. 偵錯日誌用完要清掉

**常見症狀 → 原因速查：**

| 症狀 | 先查什麼 |
|------|---------|
| 串流回傳 `content: ""` | `max_completion_tokens` 是否太低（見 §2） |
| API 報 `Unsupported parameter` | 查 §2 不支援的參數清單 |
| 搜尋結果為空 | 查 §3 對應 provider 的 URL/auth/回應格式 |
| 伺服器啟動失敗 EADDRINUSE | `lsof -ti:3001 \| xargs kill` |
| 改了 code 沒效果 | 有沒有重啟伺服器？ |

---

## 2. gpt-5-mini 參數速查

**官方文件**:
[Azure Reasoning Models](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning?view=foundry-classic) ·
[GPT-5 mini Model](https://developers.openai.com/api/docs/models/gpt-5-mini) ·
[Reasoning Guide](https://developers.openai.com/api/docs/guides/reasoning/)

### 規格
- Context: 400K (Input 272K / Output 128K)
- 類型: **推理模型** — reasoning tokens 佔輸出 ~60%
- Knowledge cutoff: May 31, 2024

### 禁用參數（會報錯）
`temperature` · `top_p` · `presence_penalty` · `frequency_penalty` · `logprobs` · `max_tokens`

### max_completion_tokens
- **包含 reasoning tokens + 可見輸出**，設太低 → 輸出為空
- 官方範例用 5000，建議至少 5000+
- Chat Completions 用 `max_completion_tokens`；Responses API 用 `max_output_tokens`

### reasoning_effort
- **Chat Completions**: `reasoning_effort: "low"` （頂層字串）
- **Responses API**: `reasoning: { effort: "low" }` （巢狀物件）
- 選項: `minimal` · `low` · `medium` · `high`

### 本專案目前設定值
| 用途 | max_completion_tokens | reasoning_effort |
|------|----------------------|-----------------|
| generateSearchQueries | 2,000 | low |
| generateDiscussionSearchQuery | 1,000 | low |
| /api/discuss 角色生成 | 8,000 | low |
| /api/agent/prepare | 8,000 | low |
| /api/agent/respond 串流 | 16,384 | low |
| /api/summarize 串流 | 16,384 | low |
| knowledge merge | 4,000 | low |

---

## 3. 搜尋 Provider API

### Exa.ai
- **文件**: [exa.ai/docs/reference/search](https://exa.ai/docs/reference/search)
- **URL**: `POST https://api.exa.ai/search`
- **Auth**: `x-api-key` header
- **參數**: `query`(必填), `numResults`(預設10, max 100), `type`(`neural`/`fast`/`auto`/`deep`/`instant`), `contents.text`
- **回應**: `{ results: [{ title, url, text, highlights, publishedDate }] }`
- **程式碼**: `server.js` → `searchExa()`

### Firecrawl
- **文件**: [docs.firecrawl.dev/api-reference/endpoint/search](https://docs.firecrawl.dev/api-reference/endpoint/search)
- **URL**: `POST https://api.firecrawl.dev/v2/search` ⚠️ **v2 不是 v1**
- **Auth**: `Authorization: Bearer <key>`
- **參數**: `query`(必填), `limit`(預設5, max 100), `scrapeOptions`
- **回應**: `{ success, data: { web: [{ title, url, description }] } }`
- **程式碼**: `server.js` → `searchFirecrawl()`

### Brave Search
- **程式碼**: `server.js` → `searchBrave()`，有 mock fallback

### 搜尋流程（外部 provider）
```
generateSearchQueries() → performWebSearch() → buildSearchContext()
→ 注入 Chat Completions system prompt → Agent 引用 [title](url)
```

---

## 4. 專案架構

### 檔案
| 檔案 | 用途 |
|------|------|
| `server.js` | Express 後端，所有 API endpoints |
| `public/app.js` | 前端 SPA 邏輯 |
| `public/index.html` | HTML 結構 |
| `public/style.css` | 樣式 |
| `.env` | API keys + 設定 |
| Port | 3001 |

### 主要 API endpoints
| Endpoint | 用途 | API 類型 |
|----------|------|---------|
| POST /api/discuss | 生成角色 | Chat Completions |
| POST /api/agent/prepare | Agent 預研究 | Chat Completions 或 Responses API |
| POST /api/agent/respond | Agent 討論回應（SSE 串流）| Chat Completions 或 Responses API |
| POST /api/search | Sidebar 快速搜尋 | 外部搜尋 API |
| POST /api/summarize | 討論摘要（SSE 串流）| Chat Completions |
| GET /api/config | 前端取設定 + 可用 providers | — |

### 搜尋 Provider 路徑選擇
- `provider === 'openai'` → Responses API + web_search tool（原有路徑）
- `provider === 'exa'/'firecrawl'/'brave'` → 外部搜尋 + Chat Completions
- `provider === 'none'` → Chat Completions 無搜尋

---

## 5. 踩坑記錄

### 討論訊息空白 (2026-02-22)
- **症狀**: respond 串流 `content: ""`, `finish_reason: "length"`, 0 chunks
- **原因**: `max_completion_tokens: 1000` 太低，推理模型用完所有 token 在 reasoning
- **修復**: 提高至 16384 + 加 `reasoning_effort: "low"`
- **教訓**: gpt-5-mini 的 `max_completion_tokens` 包含 reasoning tokens

### temperature 報錯 (2026-02-22)
- **症狀**: API 報 `Unsupported parameter`
- **修復**: commit `97224c0` 移除所有 temperature 參數
- **教訓**: 推理模型禁用 sampling 參數

### Firecrawl API 版本錯誤 (2026-02-22)
- **症狀**: 用 v1 endpoint（暫時能用但非官方當前版本）
- **修復**: URL 改為 v2，回應解析改為 `data.data?.web || data.data`
- **教訓**: 寫 code 前先查官方文件

---

## 6. 開發守則

1. **API 語法必查官方文件** — 用 WebFetch 讀 API Reference，不要猜
2. **查到的 API 資訊寫回本文件** — 下次不用重查
3. **改完 server.js 必須重啟** — 否則改動不生效
4. **用 Chrome DevTools 端到端驗證** — 不要只看 code 覺得對
5. **偵錯日誌用完要清掉** — 不留在 production code
