# Google 聯絡表單

## 本機啟動

直接雙擊 `start-preview.cmd`，或在專案根目錄的 PowerShell 執行：

```powershell
.\index_gpt\start-preview.cmd
```

然後開啟 **http://127.0.0.1:4173/**。保留啟動的終端機，按 Ctrl+C 停止。

也可以在已安裝 Node.js 20 以上版本的環境執行 `node index_gpt/server.mjs`。

**請使用此預覽網址測試提交。** 雙擊 HTML 或僅使用 Live Server 不會提供 `/api/contact`，網站將保留輸入並顯示錯誤，不會冒充成功。未來正式部署時，也須部署這個提交端點；不要只上傳 HTML。

## 已核對的欄位

來源是 Google 原始碼末端 `FB_PUBLIC_LOAD_DATA_`，取用 `question[4][0][0]`，不是 `question[0]` 的題目區塊 ID。

| 欄位 | 資料輸入參數 |
| --- | --- |
| 您的姓名／稱呼 | `entry.588998168` |
| 聯絡電子信箱 | `entry.476214014` |
| 您的需求 | `entry.1610329698` |
| 目前需求階段 | `entry.1646642689` |
| 需求簡介 | `entry.473479111` |
| 適合聯絡的日期／時段偏好 | `entry.1091995575` |

目前線上表單的實際 Action：

`https://docs.google.com/forms/d/e/1FAIpQLSeCq5vcCjQBlWITixdB8W5OQleXJGxmbHub3qq8zQ843B3NSA/formResponse`

此為提供的 `/forms/u/0/d/e/.../formResponse` 的公開表單路徑，避免依賴登入帳號索引。

最後一題的輸入 ID 是 `805813894`，型別 9，日期選項為 `[0,1]`：**包含年份，不包含時間**。指定日期拆成 `entry.805813894_year`、`entry.805813894_month`、`entry.805813894_day` 三個整數參數；不傳送基底 `entry.805813894`、`_hour` 或 `_minute`。不指定日期時省略三個參數。方便聯絡的時段會附在 `entry.1091995575` 的文字中。

## 背景提交與成功判定

前端以 JavaScript POST 到同源 `/api/contact`，畫面不跳轉。端點先驗證欄位、讀取 Google 最新欄位結構與 `fbzx`，再 POST 到 Google。僅在收到 Google 的回覆確認頁標記且未返回驗證表單時，回傳 `confirmed: true`；此時才顯示品牌成功視窗。

沒有使用 `no-cors` 的 opaque 回覆或 iframe `load` 事件判定成功。Google 的未公開頁面結構日後可能變動，遇到無法確認的回覆會保留內容、提示以信箱確認，不會自動重送或謊稱成功。

不記錄／保存表單內容，也不將任何 Google 登入憑證放在網頁中。

## 驗證

```powershell
node --test index_gpt/contact-submit.test.mjs index_gpt/contact-ui.test.mjs
```

測試使用模擬 Google 回覆，涵蓋欄位 ID、日期拆分、驗證失敗、登入／錯誤頁、防止假成功，以及本機頁面和影片 Range 回應。整合檢查不向真實 Google 問卷寫入測試回覆；正式收件仍需由表單擁有者確認。
