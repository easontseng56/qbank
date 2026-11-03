# 題庫勘誤系統（網頁版）

網址：https://easontseng56.github.io/qbank/errata/ （noindex，從 hub 私領域連過來）

- 本頁**不含任何內部資料**。登入 Google（沿用 `app/config.js` 的 clientId，與控制台共用登入）後才讀寫雲端；對 題庫池 沒權限的帳號讀不到。
- 資料檔：`題庫池\07_紀錄\勘誤\勘誤清單.json`（第一次寫入時自動建資料夾）；附圖存 `題庫池\07_紀錄\勘誤\附件\`，檔名前綴勘誤編號。
- 每筆欄位：`id`（E0001…）、`tag`（題目標籤，不含【】）、`paper`（卷名）、`bank`、`kind`（題目／答案／詳解／圖表／分類／缺頁殘缺／其他）、
  `problem`、`suggestion`、`status`（待處理／處理中／已修正／不修正）、`resolution`、`reporter`、`created`、`source`、`attachments`、`history`。
- 寫入一律「重讀最新版 → 套用 → 寫回」，降低多人同時編輯互蓋。
- 每週一排程讀這個檔，處理「待處理」，改狀態並寫 `resolution`、在 `history` 加一筆。
- 網址 `#E0123` 可直接打開某一筆。
