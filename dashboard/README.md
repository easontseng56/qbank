# 題庫池儀表板

網址：https://easontseng56.github.io/qbank/dashboard/ （noindex，不從 qbank 首頁連過去）

- `index.html`：靜態頁，讀同目錄 `data.json` 顯示題庫總覽、待 Eason 處理、來源待處理、每週執行結果、網站份數。
- `data.json`：資料來源，與控制板試算表五個分頁對應（banks／todo／pending_sources／runs／sites）。
- 更新方式：每週一排程跑完，用 `build_dashboard_data.py` 由控制板試算表五個分頁的值產生 `data.json`，推到 qbank repo `dashboard/data.json`，開 PR 自動合併。頁面本身不用改。
