# 題庫池控制台（網頁版）

網址：https://easontseng56.github.io/qbank/console/ （noindex，只從 hub 團隊專區連過來）

- 本頁**不含任何內部資料**。登入 Google（沿用 `app/config.js` 的 clientId）後才從雲端讀資料；對 題庫池 沒權限的帳號讀不到任何東西。
- 上傳考卷：Drive 可續傳上傳到 `題庫池\01_待處理`，無大小限制；類型、備註、上傳者寫在檔案「說明」欄。
- 收件匣：列 01_待處理（待處理）與 _已處理 最近 3 個日期資料夾（完成）。
- 同步狀態、儀表板：讀 `題庫池\05_工具\儀表板\控制台資料.json`（格式同 dashboard/data.json，另有 links）。
  每週排程：`python build_dashboard_data.py sheets.json --sync sync.json --console > 控制台資料.json`，寫回雲端該位置。
- 與 Artifact 版差異：沒有「通知 Claude 立刻處理」，急件到討論串說。
