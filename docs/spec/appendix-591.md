# 附錄｜591 與網址去重的查證紀錄

> 已不屬於規格。規格 v2.0 不再解析 591 的刊登內容，也不做這裡描述的去重；本檔只作為先前的查證紀錄保留，實作時不必參照。

這份附錄是 [`mvp-spec.md`](./mvp-spec.md) B6 的依據，供實作解析與撰寫測試時參考。

- 查證日：2026-11-20。來源是一個美東的雲端位址，共 25 次請求，沒有被擋。
- 樣本：2 則店面出租、1 則店面出售、1 則住宅出租、1 則頂讓。辦公、住辦、廠房的詳細頁沒有抓過。
- 標記：**［已測］** 當天實際抓取或用存下的頁面驗過；**［未測］** 依推論或記憶，沒有驗過。
- 591 隨時可能改版。每一條規則都要寫成「抓不到就留空」。

## 1. 591 網址形狀與去重鍵

鍵的格式是 `591:<rent|sale|ding>:<物件編號>`。主機名不進鍵：出租編號在 `rent.` 與 `business.` 兩個主機是同一個序列，兩邊會互相 301［已測］。出租、出售、頂讓是三個獨立的編號序列。

比對對象是「主機名＋路徑」，查詢參數與 `#` 片段一律忽略。

| 類型 | 規則 | 狀態 |
|---|---|---|
| rent | `^business\.591\.com\.tw/rent/(\d{5,10})(?:[/?#]\|$)` | 已測 |
| rent | `^rent\.591\.com\.tw/(?:home/)?(\d{5,10})(?:[/?#]\|$)` | `/ID` 已測；`/home/ID` 未測 |
| rent | `^(?:rent\|www\|m)\.591\.com\.tw/rent-detail-(\d{5,10})\.html(?:[/?#]\|$)` | rent、www 已測；m 未測 |
| rent | `^m\.591\.com\.tw/v2/(?:business/)?rent/(\d{5,10})(?:[/?#]\|$)` | 已測 |
| sale | `^business\.591\.com\.tw/sale/(\d{5,10})(?:[/?#]\|$)` | 已測 |
| sale | `^m\.591\.com\.tw/v2/(?:business/)?sale/(\d{5,10})(?:[/?#]\|$)` | 未測 |
| ding | `^(?:store\|www\|m)\.591\.com\.tw/ding-detail-(\d{5,10})\.html(?:[/?#]\|$)` | store 已測；www、m 未測 |
| 手機詳細頁 | 路徑以 `/mobile-detail.html` 結尾，且查詢參數 `houseId` 符合 `^([RSD])(\d{5,10})$`（R 出租、S 出售、D 頂讓） | R、D 已測；S 未測 |

主機名檢查：必須等於 `591.com.tw` 或以 `.591.com.tw` 結尾。`business.591.com.tw.evil.example` 必須被拒絕［已測］。

**短分享連結**［已測］：形如 `https://www.591.com.tw/1B?salt=SAGrF&s=`，本身不含物件編號。實測轉址鏈是 `→ m.591.com.tw/v2/business/rent/<id>?s=` `→ business.591.com.tw/rent/<id>?s=`。

**重組後的標準網址**（存進 `source_url`）：

- rent：`https://rent.591.com.tw/<id>`（店面會自動轉到 business 主機［已測］）
- sale：`https://business.591.com.tw/sale/<id>`
- ding：`https://store.591.com.tw/ding-detail-<id>.html`

**591 連結上出現過、都可以丟掉的參數**：`ref`、`s`（分享連結；登入狀態下可能帶分享者身分［未測］）、`salt`、`aid`、`cache_time`、`src`、`utm_*`、`fbclid`。

**尚未確認**：591 App 的「分享」實際複製出來的文字。四次搜尋都沒找到真實樣本，短連結規則是依網頁內嵌的分享資料推得。

## 2. 店面出租頁可取得的資料

適用 `business.591.com.tw/rent/<id>`。頁面有 `og:title`、`og:description`、`og:image`、`og:url`、`rel=canonical`，以及一段 JSON-LD（`@graph` 內含 `RealEstateListing`、`Place`、`BreadcrumbList`、`ImageObject`）。

不要解析頁面內嵌的 `__NUXT__` 資料：它的值被提成函式參數，原文看起來像 `deposit:a$`，無法直接讀［已測］。

| 欄位 | 來源 | 狀態 |
|---|---|---|
| 名稱 | JSON-LD `Place.name`（已是乾淨標題） | 已測 |
| 名稱（後備） | `og:title` 或 `<title>`，先解碼 HTML 實體，再去掉結尾：`/\s*(?:\|\s*[^\|｜]{2,12}?\s*)?-\s*591(?:房屋交易網\|租屋網)\s*$/` | 已測 |
| 月租金 | JSON-LD `RealEstateListing.offers.price`（數字） | 已測 |
| 月租金（後備） | 描述句：`/租金\s*([\d,]+(?:\.\d+)?)\s*元\/月/` | 已測 |
| 坪數 | 只在描述句（JSON-LD 沒有）：`/(?:使用坪數\|面積\|坪數)\s*([\d,]+(?:\.\d+)?)\s*坪/`。描述可能寫 19.999 而頁面顯示 20，存入前四捨五入到小數兩位 | 已測 |
| 地區 | JSON-LD `Place.address.addressRegion`＋`addressLocality`（例：台北市＋信義區） | 已測 |
| 地址 | `addressRegion`＋`streetAddress`。`streetAddress` 本身已含行政區（例：信義區忠孝東路四段290號） | 已測 |
| 地址（後備） | 描述句：`/位於([^，,]+)[，,]/` | 已測 |
| 樓層與用途 | JSON-LD `Place.additionalProperty` 中 `name` 為「樓層」者，例 `10F/11F`、`1F~3F/3F`（所在樓層／總樓層）。原樣存入 | 已測 |
| 押金／其他費用 | JSON-LD 沒有。頁面文字：`/class="deposit"[^>]*>\s*([^<]{1,30})</`，得到「押金二個月」。原文存入 | 已測（2 頁） |
| 物件描述 | `og:description` | 已測 |

描述句的固定句型（`og:description` 與 meta description 相同）：

> 台北市信義區店面出租：租金11500元/月，使用坪數19.999坪，位於信義區忠孝東路四段290號，更多店面出租詳情，就上591！

其他頁面類型的差異：

- **出售頁** `business.591.com.tw/sale/<id>`：`offers.price` 是總價（新台幣元），**不可**寫入月租金。本專案對出售頁只做通用解析。
- **住宅頁** `rent.591.com.tw/<id>`：JSON-LD 節點型別是 `["Product","Accommodation"]`，描述句的數字被遮蔽（「租金?元/月，面積?坪」），沒有地址與樓層。只做通用解析。
- **頂讓頁** `store.591.com.tw/ding-detail-<id>.html`：沒有 og 標籤、沒有 JSON-LD、沒有 canonical，費用是圖片。只有 `<title>` 與 meta description 可用。只做通用解析，照片由股東上傳。

## 3. 照片

［已測：4 頁，分別 15、12、3、8 張；整份 HTML 內沒有任何推薦或鄰近物件的照片。］

1. 讀 JSON-LD 中 `image` 是陣列的那個節點（店面頁是 `Place`）。
2. 只保留符合下列規則的網址：

   ```
   /^https?:\/\/img\d*\.591\.com\.tw\/(house\/\d{4}\/\d{2}\/\d{2}\/\d+\.(?:jpe?g|png|webp|gif))(![^\s"'<>]*)?$/i
   ```

   這會排除 AI 修圖（`/house_refresh_ai/`）、頭像（`/user/`）與預設圖。
3. 以第 1 個擷取群組（去掉主機名與 `!…` 尺寸字尾後的路徑）去重。`img1` 與 `img2` 是同一批圖。保留出現順序，第一張就是封面，與 `og:image` 相同。
4. 照頁面給的網址原樣下載，不要改寫或移除字尾。預設最大尺寸是 `!1000x.water2.jpg`：寬 1000px、帶 591 浮水印，實測一張約 187 KB，不需要 Referer 或 cookie。`og:image` 用的是較小的 `!730x460.water2.jpg`。
5. 最多 20 張，下載失敗的跳過。

## 4. 失敗判斷

- 最終狀態碼必須是 200。
- 404 代表刊登已下架或不存在［已測］。business 主機回的是 JSON `{"error":true,"statusCode":404,"message":"物件找不到了"}`；rent 與 store 主機回的是標題為「對不起，您訪問的頁面不存在」的網頁。
- 25 次請求中沒有遇到 403、429 或逾時；預設 curl、桌面 Chrome、iPhone Safari 三種 User-Agent 結果相同。
- 每一頁的 JSON-LD `offers.availability` 都是 `InStock`。抓得到不代表物件還在出租。

## 5. 通用去重鍵的測試案例

實作單元測試時至少涵蓋這些：

| 輸入 | 預期 |
|---|---|
| `HTTP://WWW.Sinyi.com.tw:80/rent/houseno/C361273#photos` | `sinyi.com.tw/rent/houseno/C361273` |
| `https://www.hbhousing.com.tw/detail/?sn=QR46425` 與 `…/detail?sn=QR46425` | 同一把鍵 |
| `…/detail?sn=gJT05249` 與 `…/detail?sn=GJT05249` | 不同鍵（參數值保留大小寫） |
| `https://century21.com.tw/rentpage/7558304` 與加上 `www.` | 同一把鍵 |
| `https://rent.housefun.com.tw/rent/house/2000512` 與結尾加 `/` | 同一把鍵 |
| 樂屋 `…/rent_item/info?ehid=<A>` 加上 `utm_source`、`fbclid`、`gclid`、`openExternalBrowser`、`UTM_Campaign` | 與不帶這些參數時同一把鍵 |
| 樂屋 `?ehid=<A>` 與 `?ehid=<B>` | 不同鍵 |
| `…/RentDetail.aspx?Guid=x&GCode=NWE&ID=R1` 與 `?ID=R1&GCode=NWE&Guid=x` | 同一把鍵（參數排序） |
| `https://example.com/#/house/1` 與 `#/house/2` | 不同鍵 |
| `【591租屋】大安區金店面 5萬\nhttps://rent.591.com.tw/21657691?utm_source=line` | 取出網址；鍵為 `591:rent:21657691` |
| `看這間https://rent.591.com.tw/21657691，不錯` | 取出 `https://rent.591.com.tw/21657691` |
| `https://business.591.com.tw.evil.example/rent/21657691` | 不是 591，走通用規則 |

## 6. 其他網站的實測結果

每站最多 3 次請求，預設 curl 與桌面 Chrome 兩種 User-Agent 各試一次，沒有嘗試繞過任何防護。

| 網站 | 物件編號位置 | 伺服器抓取結果 |
|---|---|---|
| 樂屋網 | 查詢參數 `ehid` | 403，Cloudflare 驗證 |
| 永慶房屋 | 路徑 | 202，AWS WAF 驗證 |
| 台灣房屋 | 路徑 | 403，Cloudflare |
| 太平洋房屋 | 查詢參數 `saleID` 或 `ID` | 200，但內容由前端渲染，og 標籤是空的 |
| 信義房屋 | 路徑 | 200；有標題與描述；`og:image` 是全站共用的預設圖 |
| 21 世紀 | 路徑 | 200；沒有 `og:title`（用 `<title>`）；`og:image` 是真實照片 |
| 好房網、住商、中信、東森 | 路徑（住商是查詢參數 `sn`） | 當天試的編號都回「找不到物件」，有效刊登的結果未知 |
| Facebook Marketplace | — | 轉到登入頁，抓不到 |
| Google Maps | — | 只有通用標題與一張靜態地圖 |

下架頁不一定回 404：見過 420（住商）、200 加錯誤頁（中信、東森）、302 轉到 200 的錯誤頁（好房）。
