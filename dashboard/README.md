# 題庫池儀表板

網址：https://easontseng56.github.io/qbank/dashboard/ （noindex，不從 qbank 首頁連過去）

- `index.html`：靜態頁，讀同目錄 `data.json` 只顯示題庫統計與網站份數（2026-11-03 Eason 決定：公開頁不放待辦、校名、試算表連結、同步明細）。
- `data.json`：公開資料，只含 updated／banks／sites（name,url,count,updated）。
- 更新方式：每週一排程跑完，用 `build_dashboard_data.py` 由控制板試算表五個分頁的值產生 `data.json`，推到 qbank repo `dashboard/data.json`，開 PR 自動合併。頁面本身不用改。
- 網頁版控制台（含內部資料、需登入）見 ../console/README.md。
