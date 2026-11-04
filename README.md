# 估價單產生器

大毛小毛火鍋料的報價開單工具。單一網頁、完全離線、無後端無套裝依賴，資料直接寫回本機 JSON 檔案。

## 系統需求

**Chrome 或 Edge**。其他瀏覽器仍可使用，但缺少 File System Access API，資料只能存在瀏覽器的 localStorage，無法寫回本機檔案；介面上方會出現提示。

## 快速開始

1. 雙擊 `quotation.html`（或放到本機 HTTP 伺服器下）。
2. 點「📁 建立自動存檔檔案」，選一個 JSON 檔案（預設檔名 `quotation_database.json`）。之後每次修改都會自動寫回該檔。
3. 換電腦、或要改用別份資料時，點「📂 載入其他檔案」。
4. 填好品項後點「🖨️ 列印單據」，會先驗證必填欄位再叫出列印對話框。

## 自動存檔的行為

- 寫入採 debounce（400ms）與單一佇列，快速打字不會造成並發寫壞檔案。
- 若瀏覽器暫存為空而檔案有資料（換機器、清過瀏覽器、`file://` 下被隔離），會沿用**檔案版本**而非覆蓋，狀態列標示「部分資料以檔案版本保留」。這是 v0.2.0 修掉的主要風險：舊版會在這種情況下把歷史單據整個抹掉。
- 連結檔案時先備份原始內容到瀏覽器，可随时用「↩️ 還原檔案備份」回滾。
- 寫入失敗會把狀態列轉紅並顯示原因，不會假裝成功。

## 客戶專屬價

「⚙️ 商品管理」建立商品基底（預設單位、預設單價）。「👥 客戶管理」建立客戶名單，並為單一客戶覆寫特定商品價格；未設定專屬價的商品自動採用基底價。

買受人欄位**離開焦點**（或按 Enter、點「🔄 重新套用客戶專屬價」）才會重算整張單價。打字中不會覆蓋你手動改過的價格——這是刻意的，舊版每敲一個字就吞掉手動價。

## 資料存放

| 位置 | 內容 |
| --- | --- |
| 瀏覽器 localStorage | 主要資料源，鍵名見 `assets/js/core.js` 的 `STORAGE_KEYS` |
| 本機 JSON 檔案 | 上述資料的全量快照，供離線備份與跨機器搬移 |
| IndexedDB | 只記住 JSON 檔案的位置（handle），不含資料 |

`quotation_database.example.json` 是格式範例。實際使用的 `quotation_database.json` 含營業資料，已列入 `.gitignore`，不應進版控。

## 專案結構

```
quotation.html              標記與結構
assets/quotation.css        樣式（含 @media print）
assets/js/core.js           常量、純工具、localStorage、IndexedDB、狀態列
assets/js/currency.js       國字大寫金額
assets/js/store.js          檔案連結、自動存檔管線、防抹除、備份還原
assets/js/invoice.js        單據列、總計、驗證列印、流水號、歷史單據
assets/js/catalog.js        單位與商品管理
assets/js/clients.js        客戶與專屬價管理
assets/js/app.js            datalist 同步、事件委派、啟動流程
```

腳本刻意用 classic script（`<script src>`）而非 ES modules，以維持「雙擊 HTML 直接開啟」在 `file://` 下可用。代價是各檔共享 global scope——新增頂層符號時注意不要跨檔重複宣告，否則整個 app 會載入失敗。

版本號只有單一來源：`assets/js/core.js` 的 `APP_VERSION`，由 `app.js` 填入介面右下角（列印時隱藏）。改版本只動那一處。

## 版本

目前 `v0.2.0`。各版本變更看 `git log` 或 tag 註解；需要對外發佈時用 GitHub Releases。

## 授權

MIT © [Hanson](LICENSE)。

程式碼版權為著作人所有。「大毛小毛火鍋料」為店家名稱，本授權不含任何商標授權。報價資料（JSON 檔案內容）不屬程式碼授權範圍。

## 開發方式

本專案以 AI 代理協作開發為主。修改後的驗證方式是起本機 HTTP 伺服器、用真實瀏覽器驅動實際操作，涵蓋：防抹除各條路徑、debounce 行為、寫入失敗狀態、注入測試、大寫金額案例、列印 CSS、客戶遷移與刪除。純語法層可用 `node --check` 逐檔檢查，但跨檔重複宣告只有在串成同一 global scope 才會爆，需一併編譯驗證。
