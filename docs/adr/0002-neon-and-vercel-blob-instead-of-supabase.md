# 資料放 Neon Postgres、照片放 Vercel Blob，不用 Supabase

最初的規格把 Supabase 列為首選，因為它一個服務就同時有資料庫與檔案儲存。我們改用 Neon Postgres（經 Vercel Marketplace 安裝）加 Vercel Blob：Supabase 免費專案閒置七天會暫停，必須有人登入後台手動喚醒，而選址倉庫正是「想到才開」的使用型態，又明確不做排程保活。Neon 閒置時也會休眠，但有連線就自動喚醒，不需要人介入。

## Considered Options

- **Supabase**：一站式，但閒置暫停需要人工喚醒。
- **只用 Vercel Blob 存 JSON**：少一個服務，但多人同時寫入會互相覆蓋，列出檔案也會消耗有限的操作額度。
- **Cloudflare（Workers、D1、R2）或 Netlify**：免費層允許商業使用，但要改寫儲存層並重新設定部署，與最快交付相違。

## Consequences

- 資料庫與照片的帳務、設定都在同一個 Vercel 帳號下。解除安裝 Vercel 上的 Neon 整合會刪除資料庫。
- 為了保留日後換主機的彈性，所有照片存取集中在單一模組，資料庫只用標準 Postgres 與一條連線字串。
- Neon Free 的時間點還原只有 6 小時，所以誤刪的防線是軟刪除與回收桶。
