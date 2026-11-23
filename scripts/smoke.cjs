/* eslint-disable @typescript-eslint/no-require-imports -- the preinstalled Playwright can only be loaded with require */
// Walks the main flows in a real browser.
// Usage: node scripts/smoke.cjs <base-url> [591-listing-url]
// For a protected Vercel preview, set SHARE_URL to its share link first.
// Browser requests to other sites are answered with a stub page, so the test
// never loads listing sites in the browser. The server still reads the 591 page
// once, the same way it does for a real paste.
const { chromium, devices } = require("playwright");
const http = require("http");
const assert = require("assert");

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
// REAL_591=1 when the server can read 591 (on Vercel): real photos are then required.
const REAL = process.env.REAL_591 === "1";
// Thirty uploads to one item cost Blob operations, so the cap test runs only where asked.
const CAP_TEST = process.env.CAP_TEST === "1";
const LISTING = process.argv[3] || "https://business.591.com.tw/rent/22197387";
const stamp = Date.now().toString(36);
const results = [];

function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

let currentPage = null;

async function check(name, fn) {
  try {
    const detail = await fn();
    step(name, true, detail || "");
  } catch (e) {
    const where = (e.stack || "").split("\n").find((l) => l.includes("smoke.cjs")) || "";
    step(name, false, `${e.message.split("\n")[0]} ${where.trim()}`);
    if (process.env.FAIL_SHOTS && currentPage) await currentPage.screenshot({ path: `${process.env.FAIL_SHOTS}/fail-${name.split(" ")[0]}.png` }).catch(() => {});
  }
}

async function stubExternal(context) {
  const base = new URL(BASE);
  if (process.env.SHARE_URL) {
    const p = await context.newPage();
    await p.goto(process.env.SHARE_URL);
    await p.close();
  }
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.host === base.host) return route.continue();
    if (route.request().resourceType() === "image") {
      // Real 591 listing photos are loaded so the photo preview is checked with real images.
      if (/^img\d*\.591\.com\.tw$/.test(url.host)) return route.continue();
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>stub page</h1></body></html>" });
  });
}

async function paste(page, text) {
  await page.getByLabel("貼上網址", { exact: true }).fill(text);
  await page.getByRole("button", { name: "收藏", exact: true }).click();
}

async function cardIds(page) {
  return page.locator("[data-item-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")));
}

/** After adding, the user must stay in the warehouse with an empty, focused paste box. */
async function assertStayedInWarehouse(page) {
  assert.strictEqual(await page.getByRole("region", { name: "物件瀏覽" }).count(), 0, "新增後自動開啟了詳細面板");
  assert.strictEqual(await page.getByRole("dialog").count(), 0, "新增後跳出了視窗");
  assert.strictEqual(new URL(page.url()).searchParams.get("item"), null, "網址帶了 ?item=");
  assert.strictEqual(await page.getByLabel("貼上網址", { exact: true }).inputValue(), "", "輸入框沒有清空");
  assert.strictEqual(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "貼上網址", "焦點不在輸入框");
}

/** Waits until a real image has loaded with actual pixels, not just a URL in the page. */
async function loadedImage(locator) {
  await locator.waitFor();
  await locator.evaluate((img) => (img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true }) || img.addEventListener("error", r, { once: true }))));
  const size = await locator.evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight, src: img.currentSrc }));
  assert.ok(size.w > 0 && size.h > 0, `圖片沒有載入：${size.src}`);
  return size;
}

async function cardCount(page) {
  return page.locator("[data-item-id]").count();
}

/** Searching the title finds the listing (switching filters if the search says it is elsewhere). */
async function search591(page, title, listing) {
  await page.getByLabel("搜尋", { exact: true }).fill(title.slice(1, 7));
  const hint = page.getByLabel("其他分類的搜尋結果").getByRole("button").first();
  await Promise.race([page.locator(`[data-source-url="${listing}"]`).first().waitFor(), hint.waitFor()]);
  if (!(await page.locator(`[data-source-url="${listing}"]`).count())) await hint.click();
  await page.locator(`[data-source-url="${listing}"]`).first().waitFor();
  await page.getByLabel("搜尋", { exact: true }).fill("");
}

/** The warehouse opens on 未討論; most steps work on 全部. */
async function showFilter(page, label) {
  const button = page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: new RegExp(`^${label}`) });
  await button.click();
  await page.waitForFunction((l) => [...document.querySelectorAll('[aria-label="狀態篩選"] button')].some((b) => b.textContent.startsWith(l) && b.getAttribute("aria-pressed") === "true"), label);
}

(async () => {
  // A local server that must never be contacted by the app's server.
  let internalHits = 0;
  const internal = http.createServer((req, res) => {
    internalHits++;
    res.end("<title>internal</title>");
  });
  await new Promise((r) => internal.listen(4599, r));

  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await stubExternal(desktop);
  desktop.setDefaultTimeout(20000);
  const page = await desktop.newPage();
  currentPage = page;
  page.on("dialog", (d) => d.accept());
  let listingId = null;
  let manualId = null;

  await check("1 開啟網址直接進入網站，不需登入；預設篩選是「未討論」", async () => {
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Potions 二店選址倉庫" }).waitFor();
    assert.strictEqual(await page.getByLabel("貼上網址", { exact: true }).isVisible(), true);
    const filters = page.getByRole("group", { name: "狀態篩選" });
    assert.strictEqual(await filters.getByRole("button", { name: /^未討論/ }).getAttribute("aria-pressed"), "true", "預設不是未討論");
    const shown = await page.locator("[data-item-id]").count();
    const undecided = Number((await filters.getByRole("button", { name: /^未討論/ }).innerText()).replace(/\D/g, ""));
    assert.strictEqual(shown, undecided, "未討論篩選顯示的數量不對");
    await showFilter(page, "全部");
    return `未討論 ${undecided} 筆；可切換到全部`;
  });

  await check("2 貼上 591 連結建立收藏（第一次會詢問暱稱），收藏後留在倉庫", async () => {
    const before = await cardIds(page);
    await paste(page, `看看這間 ${LISTING}?utm_source=line`);
    const nickField = page.getByLabel("暱稱", { exact: true });
    // Either the nickname is asked (first add) or, when an earlier run saved the
    // listing, the "already saved" notice shows at once and fades after a few seconds.
    const first = await Promise.race([
      nickField.waitFor({ timeout: 25000 }).then(() => "nick", () => "none"),
      page.getByText("這個物件已經在倉庫裡").waitFor({ timeout: 25000 }).then(() => "dup", () => "none"),
    ]);
    const asked = first === "nick";
    if (asked) {
      await nickField.fill(`測試員${stamp}`);
      await page.getByRole("dialog", { name: "你的暱稱" }).getByRole("button", { name: "確定", exact: true }).click();
      await page.getByText(/^已收藏|這個物件已經在倉庫裡/).waitFor({ timeout: 25000 });
    }
    const existed = !asked;
    if (!asked) {
      // The listing was saved by an earlier run, so no nickname was needed yet.
      await page.getByRole("button", { name: "設定暱稱", exact: true }).click();
      await nickField.fill(`測試員${stamp}`);
      await page.getByRole("dialog", { name: "你的暱稱" }).getByRole("button", { name: "確定", exact: true }).click();
      await page.getByLabel("貼上網址", { exact: true }).focus();
    }
    await assertStayedInWarehouse(page);
    listingId = await page.locator(`[data-source-url="${LISTING}"]`).first().getAttribute("data-item-id");
    assert.ok(listingId, "倉庫裡找不到這個 591 物件");
    assert.strictEqual((await cardIds(page)).length, before.length + (existed ? 0 : 1));
    const name = await page.locator(`[data-item-id="${listingId}"] [data-name]`).first().innerText();
    return `名稱：${name.slice(0, 30)}${existed ? "（先前已收藏）" : ""}`;
  });

  await check("3 點卡片才開啟；右側是本站原生預覽（照片、資訊），iframe 預設關閉可選配", async () => {
    await page.locator(`[data-item-id="${listingId}"]`).first().click();
    const region = page.getByRole("region", { name: "物件瀏覽" });
    await region.waitFor();
    try {
    assert.strictEqual(await region.locator("iframe").count(), 0, "預設就嵌入了 iframe");
    let detail = "";
    if (REAL) {
      const listingThumbs = region.getByRole("list", { name: "照片縮圖" }).locator('[data-photo-source="listing"]');
      if ((await listingThumbs.count()) < 2) {
        // Saved by an older version: only a cover. Reloading must bring in the photos without re-creating the item.
        await region.getByRole("button", { name: "重新取得照片與資訊", exact: true }).click();
        await page.getByText("已重新取得照片與資訊").waitFor({ timeout: 30000 });
        await listingThumbs.nth(1).waitFor();
        detail = "舊物件按「重新取得」後帶入照片；";
      }
      const main = region.locator('img[data-photo-source="listing"]').first();
      const size = await loadedImage(main);
      const thumbs = await listingThumbs.count();
      assert.ok(thumbs >= 2, `只有 ${thumbs} 張 591 照片`);
      await listingThumbs.nth(1).click();
      const size2 = await loadedImage(region.locator('img[data-photo-source="listing"]').first());
      await region.getByText("月租金").waitFor();
      await region.getByText("坪數").first().waitFor();
      await region.getByText("地址", { exact: true }).waitFor();
      await region.getByRole("button", { name: "放大檢視", exact: true }).click();
      const box = page.getByRole("dialog", { name: "放大檢視照片" });
      await loadedImage(box.locator("img"));
      await page.keyboard.press("Escape");
      await box.waitFor({ state: "detached" });
      assert.ok(await region.isVisible(), "按 Esc 連面板一起關掉了");
      detail += `591 照片 ${thumbs} 張，第一張 ${size.w}x${size.h}、第二張 ${size2.w}x${size2.h} 已在瀏覽器載入`;
    } else {
      await region.getByRole("button", { name: "上傳照片或截圖", exact: true }).first().waitFor();
      detail = "本機讀不到 591，只確認預覽區與上傳按鈕";
    }
    const embed = region.getByRole("button", { name: "嵌入原始網頁", exact: true });
    if (await embed.count()) {
      await embed.click();
      const src = await region.locator("iframe").getAttribute("src");
      assert.ok(src.includes("591.com.tw") && !src.includes("utm_source"), src);
      await region.getByRole("button", { name: "看本站預覽", exact: true }).click();
      assert.strictEqual(await region.locator("iframe").count(), 0);
      detail += "；iframe 可選配開啟";
    }
    return detail;
    } finally {
      if (await region.count()) await region.getByRole("button", { name: "關閉", exact: true }).click();
      await region.waitFor({ state: "detached" });
    }
  });

  await check("4 同一網址（加追蹤參數）再貼一次：只提示已存在，不跳轉", async () => {
    const before = await cardCount(page);
    await paste(page, `${LISTING}?fbclid=abc`);
    await page.getByText("這個物件已經在倉庫裡").waitFor();
    await assertStayedInWarehouse(page);
    assert.strictEqual(await cardCount(page), before);
  });

  await check("5 連續收藏 3 個網址不需關閉任何面板；內部位址照樣建立但伺服器不去讀", async () => {
    const before = await cardCount(page);
    const urls = [`http://127.0.0.1:4599/seq-${stamp}-1`, `http://localhost:4599/seq-${stamp}-2`, `http://127.0.0.1:4599/seq-${stamp}-3`];
    for (const [i, url] of urls.entries()) {
      await page.getByLabel("貼上網址", { exact: true }).fill(url);
      await page.keyboard.press("Enter");
      await page.waitForFunction((n) => document.querySelectorAll("[data-item-id]").length === n, before + i + 1, { timeout: 20000 });
      await page.getByText("已收藏，但讀不到網站資料，可稍後在物件中補填").first().waitFor();
      await assertStayedInWarehouse(page);
    }
    assert.strictEqual(internalHits, 0, `內部伺服器被讀了 ${internalHits} 次`);
    return "3 筆都建立、全程留在倉庫，內部伺服器被讀取 0 次";
  });

  await check("6 手動新增後留在倉庫；點卡片可看到 Google Maps 連結", async () => {
    await page.getByRole("button", { name: "手動新增", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "手動新增物件" });
    await dialog.getByLabel("名稱（必填）", { exact: true }).fill(`手動測試物件${stamp}`);
    await dialog.getByLabel("地址（填了才會出現 Google Maps 連結）", { exact: true }).fill("台北市信義區市府路1號");
    await dialog.getByRole("button", { name: "新增", exact: true }).click();
    await page.getByText("已新增").waitFor();
    assert.strictEqual(await page.getByRole("region", { name: "物件瀏覽" }).count(), 0, "手動新增後自動開啟了面板");
    const card = page.locator("[data-item-id]").filter({ hasText: `手動測試物件${stamp}` }).first();
    manualId = await card.getAttribute("data-item-id");
    await card.click();
    await page.getByRole("region", { name: "物件瀏覽" }).locator("h2").filter({ hasText: `手動測試物件${stamp}` }).waitFor();
    const href = await page.getByRole("link", { name: "Google Maps" }).getAttribute("href");
    assert.ok(href.includes(encodeURIComponent("台北市信義區市府路1號")), href);
  });

  const panel = page.getByRole("region", { name: "物件瀏覽" });

  await check("7 修改狀態並自動留下紀錄", async () => {
    await panel.getByRole("button", { name: "待確認", exact: true }).click();
    await panel.getByText(/將狀態從「未討論」改為「待確認」/).waitFor();
  });

  await check("8 重要備註與留言", async () => {
    await panel.getByLabel("重要備註", { exact: true }).fill("房東願意談，下週看屋");
    await panel.getByRole("button", { name: "儲存備註", exact: true }).click();
    await panel.getByText(`最後更新：測試員${stamp}`).waitFor();
    await panel.getByLabel("留言", { exact: true }).fill(`留言測試 ${stamp}`);
    await panel.getByRole("button", { name: "送出留言", exact: true }).click();
    await panel.getByText(`留言測試 ${stamp}`).waitFor();
  });

  await check("9 上一間／下一間", async () => {
    const first = await panel.locator("h2").innerText();
    await panel.getByRole("button", { name: "下一間", exact: true }).click();
    await page.waitForFunction((t) => document.querySelector('[aria-label="物件瀏覽"] h2')?.textContent !== t, first);
    await panel.getByRole("button", { name: "上一間", exact: true }).click();
    await page.waitForFunction((t) => document.querySelector('[aria-label="物件瀏覽"] h2')?.textContent === t, first);
  });

  await check("10 瀏覽器返回鍵與 Esc 可關閉", async () => {
    await page.goBack();
    await panel.waitFor({ state: "detached" });
    assert.strictEqual(new URL(page.url()).searchParams.get("item"), null);
    await page.locator(`[data-item-id="${manualId}"]`).click();
    await panel.waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
  });

  await check("11 圖庫／列表切換與搜尋", async () => {
    await page.getByRole("button", { name: "列表", exact: true }).click();
    await page.locator("ul [data-item-id]").first().waitFor();
    await page.getByLabel("搜尋", { exact: true }).fill(`手動測試物件${stamp}`);
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 1);
    await page.getByLabel("搜尋", { exact: true }).fill("");
    await page.getByRole("button", { name: "圖庫", exact: true }).click();
  });

  await check("12 改成不考慮後面板不會自己關掉；關閉後移到「不考慮」篩選", async () => {
    await page.locator(`[data-item-id="${manualId}"]`).click();
    await panel.getByRole("button", { name: "不考慮", exact: true }).click();
    await panel.getByText(/改為「不考慮」/).waitFor();
    assert.ok(await panel.isVisible());
    await panel.getByRole("button", { name: "關閉", exact: true }).click();
    await panel.waitFor({ state: "detached" });
    assert.strictEqual(await page.locator(`[data-item-id="${manualId}"]`).count(), 0);
    await page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: /^不考慮/ }).click();
    await page.locator(`[data-item-id="${manualId}"]`).waitFor();
  });

  await check("13 刪除與還原", async () => {
    await page.locator(`[data-item-id="${manualId}"]`).click();
    await panel.getByRole("button", { name: "刪除", exact: true }).click();
    await panel.getByText("這個物件在回收桶裡").waitFor();
    await panel.getByRole("button", { name: "關閉", exact: true }).click();
    await page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: /^回收桶/ }).click();
    await page.locator(`[data-item-id="${manualId}"]`).click();
    await panel.getByRole("button", { name: "還原", exact: true }).first().click();
    await panel.getByText("這個物件在回收桶裡").waitFor({ state: "detached" });
    await panel.getByRole("button", { name: "關閉", exact: true }).click();
  });

  await check("14 「開啟原始網頁」沿用同一個外部視窗", async () => {
    await page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: /^全部/ }).click();
    await page.locator(`[data-item-id="${listingId}"]`).click();
    const openButton = panel.getByRole("button", { name: "開啟原始網頁 ↗", exact: true }).first();
    const [popup] = await Promise.all([desktop.waitForEvent("page"), openButton.click()]);
    await popup.waitForURL(/591\.com\.tw/);
    let extra = 0;
    desktop.on("page", () => extra++);
    await openButton.click();
    await page.waitForTimeout(1000);
    assert.strictEqual(extra, 0, "又開了新視窗");
    await popup.close();
  });

  await check("15 不同裝置看到相同資料、直達連結直接開啟該物件", async () => {
    const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await stubExternal(other);
    const p2 = await other.newPage();
    await p2.goto(`${BASE}/?item=${manualId}`);
    await p2.getByRole("region", { name: "物件瀏覽" }).getByText(`留言測試 ${stamp}`).waitFor();
    await other.close();
  });

  await check("16 重新整理後資料仍在", async () => {
    await page.reload();
    await showFilter(page, "全部");
    await page.locator(`[data-item-id="${listingId}"]`).waitFor();
  });

  await check("17 手機：全螢幕檢視、開啟原始網頁、改狀態、留言", async () => {
    const mobile = await browser.newContext({ ...devices["iPhone 13"] });
    await stubExternal(mobile);
    await mobile.addInitScript((n) => localStorage.setItem("potions-nickname", n), `手機${stamp}`);
    const m = await mobile.newPage();
    await m.goto(BASE);
    await showFilter(m, "全部");
    await m.locator(`[data-item-id="${listingId}"]`).click();
    await m.getByRole("button", { name: "開啟原始網頁 ↗", exact: true }).waitFor();
    assert.strictEqual(await m.locator("iframe").count(), 0, "手機不該嵌入");
    // Data from earlier runs may already have this status; make sure it really changes.
    const target = m.getByRole("button", { name: "確定考慮", exact: true });
    if ((await target.getAttribute("aria-pressed")) === "true") {
      await m.getByRole("button", { name: "待確認", exact: true }).click();
      await m.getByText(new RegExp(`手機${stamp} 將狀態從「確定考慮」改為「待確認」`)).waitFor();
    }
    await target.click();
    await m.getByText(new RegExp(`手機${stamp} 將狀態從「[^」]+」改為「確定考慮」`)).waitFor();
    await m.getByLabel("留言", { exact: true }).fill(`手機留言 ${stamp}`);
    await m.getByRole("button", { name: "送出留言", exact: true }).click();
    await m.getByText(`手機留言 ${stamp}`).waitFor();
    await m.getByRole("button", { name: "關閉", exact: true }).click();
    await m.getByRole("heading", { name: "Potions 二店選址倉庫" }).waitFor();
    await mobile.close();
  });

  await check("18 批量收藏：無上限、統計正確、處理中可操作、重貼不重複", async () => {
    const lines = Array.from({ length: 35 }, (_, i) => `http://127.0.0.1:4599/batch-${stamp}-${i}`);
    const text = [
      ...lines,
      `大哥看這間 http://localhost:4599/line-${stamp}，不錯`,
      `${lines[0]}?utm_source=line`, // repeated inside the batch
      LISTING, // already in the warehouse
      "http://%zz/broken", // cannot be parsed
    ].join("\n");
    const before = await cardCount(page);
    await page.getByRole("button", { name: "批量收藏", exact: true }).click();
    const box = page.getByRole("region", { name: "批量收藏" });
    await box.getByLabel("批量網址", { exact: true }).fill(text);
    await box.getByText("找到 39 個網址").waitFor();
    await box.getByRole("button", { name: "開始收藏", exact: true }).click();
    // The warehouse stays usable while the batch runs.
    assert.strictEqual(await page.getByRole("dialog").count(), 0, "批量收藏擋住了畫面");
    await page.locator(`[data-item-id="${listingId}"]`).first().click();
    await page.getByRole("region", { name: "物件瀏覽" }).waitFor();
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "關閉", exact: true }).click();
    await box.getByText("完成", { exact: true }).waitFor({ timeout: 120000 });
    const count = async (k) => Number(await box.locator(`[data-count="${k}"]`).innerText());
    const first = { added: await count("added"), needsFill: await count("needs-fill"), duplicates: await count("duplicates"), failed: await count("failed") };
    assert.deepStrictEqual(first, { added: 36, needsFill: 36, duplicates: 2, failed: 1 });
    assert.strictEqual((await box.getByLabel("進度").innerText()).replace(/\s/g, ""), "39/39");
    assert.strictEqual(await cardCount(page), before + 36);
    assert.strictEqual(await page.getByRole("region", { name: "物件瀏覽" }).count(), 0, "批量收藏後自動開了面板");
    // Pasting the same batch again must not create anything.
    await box.getByRole("button", { name: "再貼一批", exact: true }).click();
    await box.getByLabel("批量網址", { exact: true }).fill(text);
    await box.getByRole("button", { name: "開始收藏", exact: true }).click();
    await box.getByText("完成", { exact: true }).waitFor({ timeout: 120000 });
    const again = { added: await count("added"), duplicates: await count("duplicates"), failed: await count("failed") };
    assert.deepStrictEqual(again, { added: 0, duplicates: 38, failed: 1 });
    assert.strictEqual(await cardCount(page), before + 36);
    assert.strictEqual(internalHits, 0, `內部伺服器被讀了 ${internalHits} 次`);
    await box.getByRole("button", { name: "關閉", exact: true }).click();
    return `第一次 ${JSON.stringify(first)}；重貼 ${JSON.stringify(again)}`;
  });

  await check("19 上傳照片：永久保存、換裝置可見、可刪除；伺服器端限制生效", async () => {
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 200 } });
    await page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: /^全部/ }).click();
    await page.locator(`[data-item-id="${listingId}"]`).first().click();
    const region = page.getByRole("region", { name: "物件瀏覽" });
    const before = await region.locator("[aria-label='照片位置']").innerText().catch(() => "0 / 0");
    await region.getByLabel("選擇照片", { exact: true }).first().setInputFiles({ name: "現場照.png", mimeType: "image/png", buffer: png });
    const uploaded = region.locator('img[data-photo-source="upload"]');
    const size = await loadedImage(uploaded);
    // Survives a reload and shows on another device.
    await page.reload();
    await showFilter(page, "全部");
    const reloaded = page.getByRole("region", { name: "物件瀏覽" });
    const reThumbs = reloaded.getByRole("list", { name: "照片縮圖" }).getByRole("listitem");
    // Wait for the panel to render before counting thumbnails.
    await reloaded.getByLabel("照片位置").waitFor();
    if (await reThumbs.count()) await reThumbs.last().click();
    await loadedImage(reloaded.locator('img[data-photo-source="upload"]'));
    const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await stubExternal(other);
    const p2 = await other.newPage();
    await p2.goto(`${BASE}/?item=${listingId}`);
    const r2 = p2.getByRole("region", { name: "物件瀏覽" });
    await r2.getByLabel("照片位置").waitFor();
    const count2 = await r2.getByRole("list", { name: "照片縮圖" }).getByRole("listitem").count().catch(() => 0);
    if (count2 > 0) await r2.getByRole("list", { name: "照片縮圖" }).getByRole("listitem").last().click();
    await loadedImage(r2.locator('img[data-photo-source="upload"]'));
    await other.close();

    let refetch = "";
    if (REAL) {
      await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "重新取得照片與資訊", exact: true }).click();
      await page.getByText("已重新取得照片與資訊").waitFor({ timeout: 30000 });
      const r = page.getByRole("region", { name: "物件瀏覽" });
      const total = await r.getByRole("list", { name: "照片縮圖" }).getByRole("listitem").count();
      await r.getByRole("list", { name: "照片縮圖" }).getByRole("listitem").last().click();
      await loadedImage(r.locator('img[data-photo-source="upload"]'));
      refetch = `；重新取得後共 ${total} 張，上傳的照片仍在`;
    }

    // Server-side limits, called the way any visitor could.
    const post = (id, body, type = "image/jpeg") =>
      page.evaluate(async ({ id, body, type }) => {
        const res = await fetch(`/api/items/${id}/photos`, { method: "POST", body: new Uint8Array(body), headers: { "content-type": type } });
        return res.status;
      }, { id, body, type });
    const jpegHead = [0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)];
    const big = await page.evaluate(async (id) => {
      const res = await fetch(`/api/items/${id}/photos`, { method: "POST", body: new Uint8Array(5 * 1024 * 1024).fill(0xff), headers: { "content-type": "image/jpeg" } });
      return res.status;
    }, listingId);
    assert.strictEqual(big, 413, "超過 4 MB 沒被拒");
    assert.strictEqual(await post(listingId, [...new TextEncoder().encode("<html>這不是圖片</html>"), ...new Array(20).fill(32)], "image/jpeg"), 415, "偽裝成 JPEG 的文字沒被拒");
    assert.strictEqual(await post("no-such-item", jpegHead), 404, "不存在的物件沒被拒");
    const seqCard = page.locator("[data-item-id]").filter({ hasText: "來自 127.0.0.1" }).first();
    const trashId = await seqCard.getAttribute("data-item-id");
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "關閉", exact: true }).click();
    await seqCard.click();
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "刪除", exact: true }).click();
    await page.getByText("這個物件在回收桶裡").waitFor();
    assert.strictEqual(await post(trashId, jpegHead), 404, "回收桶中的物件沒被拒");
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "還原", exact: true }).first().click();
    await page.getByText("這個物件在回收桶裡").waitFor({ state: "detached" });
    let cap = "（每物件上限未測）";
    if (CAP_TEST) {
      const statuses = [];
      for (let i = 0; i < 31; i++) statuses.push(await post(trashId, jpegHead));
      assert.ok(statuses.slice(0, 30).every((s) => s === 200), `前 30 張：${statuses.slice(0, 30).join(",")}`);
      assert.strictEqual(statuses[30], 409, "第 31 張沒被拒");
      cap = "；第 31 張被拒";
    }

    // Delete the uploaded photo on the listing.
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "關閉", exact: true }).click();
    await page.locator(`[data-item-id="${listingId}"]`).first().click();
    const r = page.getByRole("region", { name: "物件瀏覽" });
    const items = r.getByRole("list", { name: "照片縮圖" }).getByRole("listitem");
    if (await items.count()) await items.last().click();
    const uploadsBefore = await r.getByRole("list", { name: "照片縮圖" }).locator('[data-photo-source="upload"]').count();
    await r.getByRole("button", { name: "刪除這張照片", exact: true }).click();
    if (uploadsBefore <= 1) await r.locator('img[data-photo-source="upload"]').waitFor({ state: "detached" });
    else await page.waitForFunction((n) => document.querySelectorAll('[aria-label="照片縮圖"] [data-photo-source="upload"]').length === n - 1, uploadsBefore);
    await r.getByRole("button", { name: "關閉", exact: true }).click();
    return `上傳後 ${size.w}x${size.h} 已載入（原本 ${before}）；超過 4 MB、偽裝檔、不存在與回收桶物件都被拒${cap}${refetch}`;
  });

  await check("20 連結健康：被擋或讀不到是「無法確認」，下架才是「已失效」", async () => {
    await page.reload();
    await showFilter(page, "全部");
    const internalCard = page.locator(`[data-source-url="http://127.0.0.1:4599/seq-${stamp}-1"]`).first();
    await internalCard.getByText("無法確認").waitFor();
    assert.strictEqual(await internalCard.getByText("已失效").count(), 0, "讀不到的內部位址被標成已失效");
    if (!REAL) return "本機：讀不到的位址標為「無法確認」（真實下架與 403 樣本在雲端驗）";
    const results = [];
    const removed = "https://business.591.com.tw/rent/20024768";
    // From Vercel's servers this site answers with an AWS WAF bot challenge (observed 2026-11-22).
    const blocked = "https://rent.yungching.com.tw/";
    for (const url of [removed, blocked]) {
      if ((await page.locator(`[data-source-url="${url}"]`).count()) === 0) {
        await paste(page, url);
        await page.waitForFunction((u) => document.querySelector(`[data-source-url="${u}"]`), url, { timeout: 30000 });
      }
    }
    const goneCard = page.locator(`[data-source-url="${removed}"]`).first();
    await goneCard.getByText("已失效").waitFor();
    results.push("已下架 591（404）→ 已失效");
    const blockedCard = page.locator(`[data-source-url="${blocked}"]`).first();
    await blockedCard.getByText("無法確認").waitFor();
    assert.strictEqual(await blockedCard.getByText("已失效").count(), 0);
    results.push(`永慶租屋（反機器人驗證）→ 無法確認：${(await blockedCard.getAttribute("title")) || ""}`.trim());
    await page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: /^已失效/ }).click();
    await page.locator(`[data-source-url="${removed}"]`).first().waitFor();
    assert.strictEqual(await page.locator(`[data-source-url="${blocked}"]`).count(), 0, "無法確認的物件出現在已失效篩選");
    await page.locator(`[data-source-url="${removed}"]`).first().click();
    await page.getByRole("region", { name: "物件瀏覽" }).getByText(/原始刊登已失效/).waitFor();
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "關閉", exact: true }).click();
    await page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: /^全部/ }).click();
    await page.locator(`[data-item-id="${listingId}"]`).first().click();
    await page.getByRole("region", { name: "物件瀏覽" }).getByText(/原始刊登正常/).waitFor();
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "關閉", exact: true }).click();
    results.push("在架 591 → 正常");
    return results.join("；");
  });

  await check("23 聯絡資訊：可編輯、電話與 LINE 成為連結、可用聯絡人與電話搜尋（其他分類的結果會提示）", async () => {
    const phone = "0912-345-678";
    const contact = `測試不動產 王小姐${stamp}  ${phone}\n\nLINE ID：@t${stamp}`;
    await showFilter(page, "全部");
    await page.locator(`[data-item-id="${manualId}"]`).count().then((n) => n || showFilter(page, "不考慮"));
    await page.locator(`[data-item-id="${manualId}"]`).first().click();
    const region = page.getByRole("region", { name: "物件瀏覽" });
    await region.getByRole("button", { name: "編輯", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "編輯物件" });
    await dialog.getByLabel("聯絡資訊（房仲公司、聯絡人、電話、LINE ID 等）", { exact: true }).fill(contact);
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    const box = region.getByRole("group", { name: "聯絡資訊" });
    await box.getByText(`王小姐${stamp}`).waitFor();
    assert.strictEqual(await box.locator('a[data-contact="tel"]').getAttribute("href"), "tel:0912345678");
    assert.strictEqual(await box.locator('a[data-contact="line"]').getAttribute("href"), `https://line.me/R/ti/p/%40t${stamp}`);
    await region.getByRole("button", { name: "關閉", exact: true }).click();
    // The item is 不考慮 (step 12): searching from 未討論 points to the other filter.
    await showFilter(page, "未討論");
    const search = page.getByLabel("搜尋", { exact: true });
    for (const q of [`王小姐${stamp}`, "0912345678", phone]) {
      await search.fill(q);
      const hint = page.getByLabel("其他分類的搜尋結果").getByRole("button", { name: /^不考慮/ });
      await hint.waitFor();
      await hint.click();
      await page.locator(`[data-item-id="${manualId}"]`).waitFor();
      await showFilter(page, "未討論");
    }
    await search.fill("");
    // Survives a reload.
    await page.goto(`${BASE}/?item=${manualId}`);
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("group", { name: "聯絡資訊" }).getByText(`王小姐${stamp}`).waitFor();
    await page.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "關閉", exact: true }).click();
    return "編輯→顯示→tel／LINE 連結→以姓名、電話（有無橫線）搜尋→重新整理後仍在";
  });

  await check("24 比較介面：卡片／列表／詳細的租金（萬元）坪數樓層商圈一致、六種排序、三種快速篩選、標籤人工修正", async () => {
    const tag = `比較${stamp}`;
    // A: rent and area, ground floor, 可餐飲 in the title. B: rent only, 2F, 不可餐飲. C: area only, no floor, hedged 頂讓.
    const specs = [
      { key: "A", name: `${tag}-A 可餐飲`, rent: "10", area: "30", floor: "1F/7F", zone: `商圈${stamp}` },
      { key: "B", name: `${tag}-B 不可餐飲`, rent: "20.5", area: "", floor: "2F/16F", zone: "" },
      { key: "C", name: `${tag}-C 看起來是頂讓`, rent: "", area: "50", floor: "", zone: "" },
    ];
    await showFilter(page, "全部");
    const ids = {};
    for (const sp of specs) {
      await page.getByRole("button", { name: "手動新增", exact: true }).click();
      const d = page.getByRole("dialog", { name: "手動新增物件" });
      await d.getByLabel("名稱（必填）", { exact: true }).fill(sp.name);
      await d.getByLabel("月租金（萬元）", { exact: true }).fill(sp.rent);
      await d.getByLabel("坪數", { exact: true }).fill(sp.area);
      await d.getByLabel("樓層", { exact: true }).fill(sp.floor);
      await d.getByLabel("商圈／區域", { exact: true }).fill(sp.zone);
      await d.getByRole("button", { name: "新增", exact: true }).click();
      await d.waitFor({ state: "detached" });
      const card = page.locator("[data-item-id]").filter({ hasText: sp.name }).first();
      await card.waitFor();
      ids[sp.key] = await card.getAttribute("data-item-id");
    }
    const search = page.getByLabel("搜尋", { exact: true });
    await search.fill(tag);
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 3);
    const facts = (root) => root.evaluate((el) => Object.fromEntries([...el.querySelectorAll("[data-fact]")].map((f) => [f.dataset.fact, f.textContent.trim()])));
    // Card, list row and detail show the same values.
    const expected = {
      A: { rent: "10萬/月", area: "30坪", floor: "1F/7F", zone: `商圈${stamp}`, tags: "可餐飲" },
      B: { rent: "20.5萬/月", area: "未提供", floor: "2F/16F", zone: "未提供" },
      C: { rent: "未提供", area: "50坪", floor: "未提供", zone: "未提供" },
    };
    for (const [k, want] of Object.entries(expected)) {
      assert.deepStrictEqual(await facts(page.locator(`[data-item-id="${ids[k]}"]`)), want, `卡片 ${k}`);
    }
    await page.getByRole("button", { name: "列表", exact: true }).click();
    for (const [k, want] of Object.entries(expected)) {
      assert.deepStrictEqual(await facts(page.locator(`ul [data-item-id="${ids[k]}"]`)), want, `列表 ${k}`);
    }
    await page.getByRole("button", { name: "圖庫", exact: true }).click();
    await page.locator(`[data-item-id="${ids.A}"]`).click();
    const region = page.getByRole("region", { name: "物件瀏覽" });
    const detailFacts = await facts(region.locator('[aria-label="物件資訊"]').first());
    assert.deepStrictEqual({ rent: detailFacts.rent, area: detailFacts.area, floor: detailFacts.floor, zone: detailFacts.zone }, { rent: "10萬/月", area: "30坪", floor: "1F/7F", zone: `商圈${stamp}` });
    // Rent is edited in 萬元: 10.68 is stored as 106,800 元; saving untouched keeps it.
    await region.getByRole("button", { name: "編輯", exact: true }).click();
    let d = page.getByRole("dialog", { name: "編輯物件" });
    assert.strictEqual(await d.getByLabel("月租金（萬元）", { exact: true }).inputValue(), "10");
    await d.getByLabel("月租金（萬元）", { exact: true }).fill("10.68");
    await d.getByText("＝ 106,800 元/月").waitFor();
    await d.getByRole("button", { name: "儲存", exact: true }).click();
    await region.locator('[data-fact="rent"]').filter({ hasText: "10.68萬/月" }).waitFor();
    await region.getByRole("button", { name: "編輯", exact: true }).click();
    d = page.getByRole("dialog", { name: "編輯物件" });
    assert.strictEqual(await d.getByLabel("月租金（萬元）", { exact: true }).inputValue(), "10.68");
    await d.getByRole("button", { name: "儲存", exact: true }).click();
    await d.waitFor({ state: "detached" });
    assert.strictEqual(await region.locator('[data-fact="rent"]').innerText(), "10.68萬/月");
    // Tags: read from the title, corrected by hand, survive a reload, and go back to automatic.
    const food = (r) => r.getByRole("group", { name: "可餐飲" });
    assert.strictEqual(await food(region).getAttribute("data-state"), "yes");
    await food(region).getByRole("button", { name: "否", exact: true }).click();
    await region.locator('[data-tag="food"][data-state="no"]').waitFor();
    await page.reload();
    await showFilter(page, "全部");
    const r2 = page.getByRole("region", { name: "物件瀏覽" });
    await r2.locator('[data-tag="food"][data-state="no"]').waitFor();
    await food(r2).getByText(/股東填寫/).waitFor();
    await food(r2).getByRole("button", { name: "自動", exact: true }).click();
    await r2.locator('[data-tag="food"][data-state="yes"]').waitFor();
    // Closing an item opened before a reload keeps the warehouse view (filter, search) as it is.
    await search.fill(tag);
    await r2.getByRole("button", { name: "關閉", exact: true }).click();
    await page.waitForTimeout(1500);
    assert.strictEqual(await page.getByRole("group", { name: "狀態篩選" }).locator('button[aria-pressed="true"]').innerText().then((t) => t.startsWith("全部")), true, "關閉後篩選被重置");
    assert.strictEqual(await search.inputValue(), tag, "關閉後搜尋被清空");
    await page.locator(`[data-item-id="${ids.B}"]`).click();
    await r2.locator('[data-tag="food"][data-state="no"]').waitFor();
    await r2.getByRole("button", { name: "關閉", exact: true }).click();
    await page.locator(`[data-item-id="${ids.C}"]`).click();
    await r2.locator('[data-tag="transfer"][data-state="unknown"]').waitFor();
    await r2.getByRole("button", { name: "關閉", exact: true }).click();
    // Sorting: same order in both views, kept when switching, missing values last.
    await search.fill(tag);
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 3);
    const order = async () => (await cardIds(page)).map((id) => Object.keys(ids).find((k) => ids[k] === id)).join("");
    const sorts = { 最新新增: "CBA", 最早新增: "ABC", 租金低到高: "ABC", 租金高到低: "BAC", 坪數小到大: "ACB", 坪數大到小: "CAB" };
    for (const [label, want] of Object.entries(sorts)) {
      await page.getByLabel("排序", { exact: true }).selectOption({ label });
      assert.strictEqual(await order(), want, `圖庫 ${label}`);
      await page.getByRole("button", { name: "列表", exact: true }).click();
      assert.strictEqual(await order(), want, `列表 ${label}`);
      await page.getByRole("button", { name: "圖庫", exact: true }).click();
      assert.strictEqual(await order(), want, `切回圖庫後仍是 ${label}`);
    }
    await page.getByLabel("排序", { exact: true }).selectOption({ label: "最新新增" });
    // Quick filters, alone and together; items without the data never match.
    await page.getByRole("button", { name: /^快速篩選/ }).click();
    const quick = page.getByRole("group", { name: "快速篩選" });
    const expectShown = async (want, why) => {
      await page.waitForFunction((n) => document.querySelectorAll("[data-item-id]").length === n, want.length);
      assert.strictEqual(await order(), want, why);
    };
    await quick.getByLabel("最高月租金（萬元）", { exact: true }).fill("15");
    await expectShown("A", "租金上限 15 萬");
    await quick.getByLabel("最高月租金（萬元）", { exact: true }).fill("");
    await quick.getByLabel("最低坪數", { exact: true }).fill("40");
    await expectShown("C", "坪數至少 40");
    await quick.getByLabel("最低坪數", { exact: true }).fill("");
    await quick.getByLabel("必須包含一樓").check();
    await expectShown("A", "必須含一樓");
    await quick.getByLabel("最高月租金（萬元）", { exact: true }).fill("25");
    await expectShown("A", "租金上限 25 萬＋一樓");
    await page.getByRole("button", { name: "清除條件", exact: true }).click();
    await expectShown("CBA", "清除條件");
    await page.getByRole("button", { name: /^快速篩選/ }).click();
    await search.fill("");
    return "三視圖數值一致、萬元編輯 10.68→106,800 且原值保留、六種排序、三種篩選與清除、標籤自動／人工／還原自動皆正確";
  });

  await check("25 手機：卡片與列表看得到租金坪數、排序與快速篩選可用、詳細面板有店面條件", async () => {
    const mobile = await browser.newContext({ ...devices["iPhone 13"] });
    await stubExternal(mobile);
    await mobile.addInitScript((n) => localStorage.setItem("potions-nickname", n), `手機${stamp}`);
    const m = await mobile.newPage();
    await m.goto(BASE);
    await showFilter(m, "全部");
    await m.getByLabel("搜尋", { exact: true }).fill(`比較${stamp}`);
    await m.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 3);
    const card = m.locator("[data-item-id]").filter({ hasText: `比較${stamp}-A` }).first();
    assert.strictEqual(await card.locator('[data-fact="rent"]').innerText(), "10.68萬/月");
    assert.ok(await card.locator('[data-fact="rent"]').isVisible());
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `手機版橫向溢出 ${overflow}px`);
    await m.getByLabel("排序", { exact: true }).selectOption({ label: "租金高到低" });
    await m.getByRole("button", { name: /^快速篩選/ }).click();
    await m.getByRole("group", { name: "快速篩選" }).getByLabel("必須包含一樓").check();
    await m.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 1);
    await m.getByRole("button", { name: "清除條件", exact: true }).click();
    await m.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 3);
    await m.getByRole("button", { name: "列表", exact: true }).click();
    assert.strictEqual(await m.locator('ul [data-fact="rent"]').first().innerText(), "20.5萬/月");
    await m.locator(`ul [data-item-id]`).filter({ hasText: `比較${stamp}-A` }).click();
    await m.getByRole("group", { name: "可餐飲" }).waitFor();
    await m.getByRole("button", { name: "編輯", exact: true }).click();
    await m.getByRole("dialog", { name: "編輯物件" }).getByLabel("月租金（萬元）", { exact: true }).waitFor();
    await m.getByRole("dialog", { name: "編輯物件" }).getByRole("button", { name: "取消", exact: true }).click();
    // 股東評價 can be marked and unmarked on a phone.
    const flaw = m.getByRole("group", { name: "一般缺點" }).getByRole("button", { name: "屋況差", exact: true });
    await flaw.click();
    await m.waitForFunction(() => [...document.querySelectorAll('[aria-label="一般缺點"] button')].some((b) => b.textContent === "屋況差" && b.getAttribute("aria-pressed") === "true" && !b.disabled));
    await flaw.click();
    await m.waitForFunction(() => [...document.querySelectorAll('[aria-label="一般缺點"] button')].some((b) => b.textContent === "屋況差" && b.getAttribute("aria-pressed") === "false" && !b.disabled));
    await m.getByRole("button", { name: "＋自訂", exact: true }).click();
    await m.getByLabel("自訂標籤名稱", { exact: true }).waitFor();
    await mobile.close();
    return "iPhone 13：無橫向溢出、排序與快速篩選可用並可清除、列表與詳細面板正常、可標記與取消股東評價、可開自訂表單";
  });

  await check("27 股東評價：一鍵選取／取消／多選並立即儲存、紅色優先最多兩個加 +N、篩選、自訂標籤共用與去重、無人使用即消失", async () => {
    const tag = `比較${stamp}`;
    const flagButton = (root, level, label) => root.getByRole("group", { name: `${level}缺點` }).getByRole("button", { name: label, exact: true });
    const settle = (label, pressed) =>
      page.waitForFunction(
        ([l, p]) => [...document.querySelectorAll('[aria-label="股東評價"] [data-flag-button]')].some((b) => b.textContent === l && b.getAttribute("aria-pressed") === p && !b.disabled),
        [label, String(pressed)],
      );
    const flagsOf = (sel) => page.locator(sel).first().evaluate((el) => {
      const box = el.querySelector("[data-flags]");
      return box ? { all: box.getAttribute("data-flags"), shown: [...box.querySelectorAll("[data-flag]")].map((c) => `${c.textContent}:${c.dataset.flag}`) } : { all: "", shown: [] };
    });
    await showFilter(page, "全部");
    const search = page.getByLabel("搜尋", { exact: true });
    await search.fill(tag);
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 3);
    const idOf = async (k) => page.locator("[data-item-id]").filter({ hasText: `${tag}-${k}` }).first().getAttribute("data-item-id");
    const A = await idOf("A");
    const B = await idOf("B");
    await page.locator(`[data-item-id="${A}"]`).click();
    const region = page.getByRole("region", { name: "物件瀏覽" });
    const statusBefore = await region.locator('[aria-pressed="true"]').filter({ hasText: /^(未討論|待確認|確定考慮|不考慮)$/ }).innerText();
    const commentsBefore = await page.getByText(/^留言（\d+）$/).first().innerText();
    for (const [level, label] of [["重大", "太小"], ["一般", "地下室"], ["一般", "租金太高"]]) {
      await flagButton(region, level, label).click();
      await settle(label, true);
    }
    await region.getByLabel("評價紀錄").getByText(`太小｜測試員${stamp}`).waitFor();
    assert.deepStrictEqual(await flagsOf(`[data-item-id="${A}"]`), { all: "太小、地下室、租金太高", shown: ["太小:major", "地下室:minor", "+1:more"] });
    // Marking never changes the status or adds a comment.
    assert.strictEqual(await region.locator('[aria-pressed="true"]').filter({ hasText: /^(未討論|待確認|確定考慮|不考慮)$/ }).innerText(), statusBefore);
    assert.strictEqual(await page.getByText(/^留言（\d+）$/).first().innerText(), commentsBefore, "貼標新增了留言或紀錄");
    await region.getByRole("button", { name: "關閉", exact: true }).click();
    await page.getByRole("button", { name: "列表", exact: true }).click();
    assert.deepStrictEqual(await flagsOf(`ul [data-item-id="${A}"]`), { all: "太小、地下室、租金太高", shown: ["太小:major", "地下室:minor", "+1:more"] });
    await page.getByRole("button", { name: "圖庫", exact: true }).click();
    // Survives a reload; unselecting one updates every view.
    await page.reload();
    await showFilter(page, "全部");
    await search.fill(tag);
    await page.locator(`[data-item-id="${A}"] [data-flags]`).waitFor();
    await page.locator(`[data-item-id="${A}"]`).click();
    await flagButton(region, "一般", "地下室").click();
    await settle("地下室", false);
    assert.deepStrictEqual(await flagsOf(`[data-item-id="${A}"]`), { all: "太小、租金太高", shown: ["太小:major", "租金太高:minor"] });
    await region.getByRole("button", { name: "關閉", exact: true }).click();
    // Filters: hide 重大 flaws, then only one label; cleared together with the other conditions.
    await page.getByRole("button", { name: /^快速篩選/ }).click();
    const quick = page.getByRole("group", { name: "快速篩選" });
    await quick.getByLabel("隱藏有重大缺點").check();
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 2);
    assert.strictEqual(await page.locator(`[data-item-id="${A}"]`).count(), 0);
    await quick.getByLabel("隱藏有重大缺點").uncheck();
    await quick.getByRole("group", { name: "只看有此標籤" }).getByRole("button", { name: "租金太高", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 1);
    await page.getByRole("button", { name: "列表", exact: true }).click();
    assert.strictEqual(await page.locator("ul [data-item-id]").count(), 1);
    await page.getByRole("button", { name: "圖庫", exact: true }).click();
    await quick.getByLabel("隱藏有重大缺點").check();
    await page.getByRole("button", { name: "清除條件", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 3);
    assert.strictEqual(await quick.getByLabel("隱藏有重大缺點").isChecked(), false);
    await page.getByRole("button", { name: /^快速篩選/ }).click();
    // Custom label: created on A at 重大, offered on B, the same name at 一般 on B keeps 重大.
    const custom = `遠${stamp.slice(-4)}`;
    await page.locator(`[data-item-id="${A}"]`).click();
    await region.getByRole("button", { name: "＋自訂", exact: true }).click();
    await region.getByLabel("自訂標籤名稱", { exact: true }).fill(custom);
    await region.getByRole("radio", { name: "重大" }).click();
    await region.getByRole("button", { name: "建立", exact: true }).click();
    await settle(custom, true);
    assert.strictEqual(await flagButton(region, "重大", custom).getAttribute("aria-pressed"), "true");
    await region.getByRole("button", { name: "關閉", exact: true }).click();
    await page.locator(`[data-item-id="${B}"]`).click();
    assert.strictEqual(await flagButton(region, "重大", custom).getAttribute("aria-pressed"), "false", "自訂標籤沒有出現在其他物件");
    await region.getByRole("button", { name: "＋自訂", exact: true }).click();
    await region.getByLabel("自訂標籤名稱", { exact: true }).fill(` ${custom} `);
    await region.getByRole("radio", { name: "一般" }).click();
    await region.getByRole("button", { name: "建立", exact: true }).click();
    await page.getByText("已有此標籤（重大），已直接套用").waitFor();
    await settle(custom, true);
    assert.strictEqual(await region.getByRole("group", { name: "一般缺點" }).getByRole("button", { name: custom, exact: true }).count(), 0, "同名標籤出現兩種級別");
    // Unused custom labels disappear.
    await flagButton(region, "重大", custom).click();
    await settle(custom, false);
    await region.getByRole("button", { name: "關閉", exact: true }).click();
    await page.locator(`[data-item-id="${A}"]`).click();
    await flagButton(region, "重大", custom).click();
    await page.waitForFunction((l) => ![...document.querySelectorAll('[aria-label="股東評價"] [data-flag-button]')].some((b) => b.textContent === l), custom);
    await region.getByRole("button", { name: "關閉", exact: true }).click();
    await page.getByRole("button", { name: /^快速篩選/ }).click();
    assert.strictEqual(await quick.getByRole("group", { name: "只看有此標籤" }).getByRole("button", { name: custom, exact: true }).count(), 0);
    await page.getByRole("button", { name: /^快速篩選/ }).click();
    await search.fill("");
    return "選取三個→卡片與列表「太小、地下室、+1」、重新整理仍在、取消一個即時更新、狀態與留言不變；隱藏重大／只看標籤／清除條件正確；自訂標籤共用、同名不同級別沿用重大、無人使用即消失";
  });

  await check("28 多人同時操作：同一物件不同標籤都保留；同名不同級別同時建立，全站只有一個級別", async () => {
    const tag = `比較${stamp}`;
    const open = async (nickname) => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await stubExternal(ctx);
      await ctx.addInitScript((n) => localStorage.setItem("potions-nickname", n), nickname);
      const p = await ctx.newPage();
      p.setDefaultTimeout(30000);
      return { ctx, p };
    };
    await showFilter(page, "全部");
    await page.getByLabel("搜尋", { exact: true }).fill(tag);
    await page.waitForFunction(() => document.querySelectorAll("[data-item-id]").length === 3);
    const idOf = async (k) => page.locator("[data-item-id]").filter({ hasText: `${tag}-${k}` }).first().getAttribute("data-item-id");
    const [A, C] = [await idOf("A"), await idOf("C")];
    const x = await open(`甲${stamp}`);
    const y = await open(`乙${stamp}`);
    await Promise.all([x.p.goto(`${BASE}/?item=${C}`), y.p.goto(`${BASE}/?item=${C}`)]);
    const btn = (p, level, label) => p.getByRole("region", { name: "物件瀏覽" }).getByRole("group", { name: `${level}缺點` }).getByRole("button", { name: label, exact: true });
    await Promise.all([btn(x.p, "重大", "挑高太低").waitFor(), btn(y.p, "一般", "位置偏").waitFor()]);
    await Promise.all([btn(x.p, "重大", "挑高太低").click(), btn(y.p, "一般", "位置偏").click()]);
    const pressedIn = (p, label) => p.waitForFunction((l) => [...document.querySelectorAll("[data-flag-button]")].some((b) => b.textContent === l && b.getAttribute("aria-pressed") === "true" && !b.disabled), label);
    await Promise.all([pressedIn(x.p, "挑高太低"), pressedIn(y.p, "位置偏")]);
    await page.goto(`${BASE}/?item=${C}`);
    const records = page.getByRole("region", { name: "物件瀏覽" }).getByLabel("評價紀錄");
    await records.getByText(`挑高太低｜甲${stamp}`).waitFor();
    await records.getByText(`位置偏｜乙${stamp}`).waitFor();
    // Same new name, different levels, at the same time on two items.
    const name = `併${stamp.slice(-4)}`;
    await Promise.all([x.p.goto(`${BASE}/?item=${A}`), y.p.goto(`${BASE}/?item=${C}`)]);
    for (const [who, level] of [[x, "重大"], [y, "一般"]]) {
      const r = who.p.getByRole("region", { name: "物件瀏覽" });
      await r.getByRole("button", { name: "＋自訂", exact: true }).click();
      await r.getByLabel("自訂標籤名稱", { exact: true }).fill(name);
      await r.getByRole("radio", { name: level }).click();
    }
    await Promise.all([x, y].map((who) => who.p.getByRole("region", { name: "物件瀏覽" }).getByRole("button", { name: "建立", exact: true }).click()));
    await Promise.all([pressedIn(x.p, name), pressedIn(y.p, name)]);
    const notices = (await Promise.all([x, y].map((who) => who.p.getByText(/已有此標籤（(重大|一般)），已直接套用/).count()))).reduce((a, b) => a + b, 0);
    await page.goto(`${BASE}/?item=${A}`);
    const levels = await page.getByRole("region", { name: "物件瀏覽" }).locator("[data-flag-button]").evaluateAll((els, l) => els.filter((b) => b.textContent === l).map((b) => b.dataset.flagButton), name);
    assert.strictEqual(levels.length, 1, `同名標籤出現 ${levels.length} 個按鈕`);
    let raw = "畫面";
    if (process.env.LOCAL_DATA) {
      // The stored data itself, not just the display, holds one level.
      const data = JSON.parse(require("fs").readFileSync(process.env.LOCAL_DATA, "utf8"));
      const stored = new Set(data.items.flatMap((i) => i.flags || []).filter((f) => f.label === name).map((f) => f.level));
      assert.strictEqual(stored.size, 1, `儲存的資料有 ${stored.size} 種級別`);
      raw = "儲存資料與畫面";
    }
    assert.strictEqual(notices, 1, `「已有此標籤」提示出現 ${notices} 次`);
    // Clean up the shared label on both items.
    for (const [who, id] of [[x, A], [y, C]]) {
      await who.p.goto(`${BASE}/?item=${id}`);
      const b = who.p.getByRole("region", { name: "物件瀏覽" }).locator("[data-flag-button]").filter({ hasText: name });
      await b.click();
      await who.p.waitForFunction((l) => [...document.querySelectorAll("[data-flag-button]")].some((e) => e.textContent === l && e.getAttribute("aria-pressed") === "false" && !e.disabled) || ![...document.querySelectorAll("[data-flag-button]")].some((e) => e.textContent === l), name);
    }
    await x.ctx.close();
    await y.ctx.close();
    await page.goto(BASE);
    return `兩人同時標不同標籤都保留；同名同時建立後全站只有「${levels[0] === "major" ? "重大" : "一般"}」一種級別（${raw}），提示 1 次`;
  });

  if (REAL) {
    await check("22 591 App 分享連結（591.to）存成物件本身的網址並帶入照片，與網頁版連結去重", async () => {
      const share = "https://591.to/elOXb";
      const listing = "https://business.591.com.tw/rent/22383299";
      await page.getByRole("group", { name: "狀態篩選" }).getByRole("button", { name: /^全部/ }).click();
      if ((await page.locator(`[data-source-url="${listing}"]`).count()) === 0) {
        await paste(page, `【591】信義區店面 ${share}`);
        await page.waitForFunction((u) => document.querySelector(`[data-source-url="${u}"]`), listing, { timeout: 30000 });
      }
      const card = page.locator(`[data-source-url="${listing}"]`).first();
      await card.click();
      const region = page.getByRole("region", { name: "物件瀏覽" });
      // The real title (not 「591房屋交易網」) and the public contact details; an older copy is corrected by 重新取得.
      const title = "#稀有釋出#可餐飲#可飲酒";
      let fixed = "";
      if ((await region.locator("h2").innerText()) !== title || (await region.getByRole("group", { name: "聯絡資訊" }).count()) === 0) {
        await region.getByRole("button", { name: "重新取得照片與資訊", exact: true }).click();
        await page.getByText("已重新取得照片與資訊").waitFor({ timeout: 30000 });
        fixed = "（舊資料按「重新取得」後修正）";
      }
      assert.strictEqual(await region.locator("h2").innerText(), title);
      const contactBox = region.getByRole("group", { name: "聯絡資訊" });
      await contactBox.locator('a[data-contact="tel"]').first().waitFor();
      await contactBox.locator('a[data-contact="line"]').first().waitFor();
      const size = await loadedImage(region.locator('img[data-photo-source="listing"]').first());
      const thumbs = await region.getByRole("list", { name: "照片縮圖" }).getByRole("listitem").count();
      await region.getByRole("button", { name: "關閉", exact: true }).click();
      const before = await cardCount(page);
      await paste(page, listing);
      await page.getByText("這個物件已經在倉庫裡").waitFor();
      assert.strictEqual(await cardCount(page), before);
      await search591(page, title, listing);
      return `591.to → ${listing}，標題「${title}」${fixed}、公開聯絡資訊有電話與 LINE 連結，照片 ${thumbs} 張（第一張 ${size.w}x${size.h}），再貼網頁版判定為重複，可用標題搜尋`;
    });
  }

  if (process.env.LOCAL_DATA) {
    await check("21 到期重檢：只在開啟倉庫時、只檢查超過 24 小時且非不考慮／回收桶的物件", async () => {
      const fs = require("fs");
      const file = process.env.LOCAL_DATA;
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const day = 24 * 60 * 60 * 1000;
      const old = new Date(Date.now() - 2 * day).toISOString();
      const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const linked = data.items.filter((i) => i.sourceUrl && !i.deletedAt && i.status !== "rejected");
      const [due, fresh, rejected, trashed] = linked.slice(0, 4);
      Object.assign(due, { health: "ok", healthAt: old, healthReason: "正常" });
      Object.assign(fresh, { health: "ok", healthAt: recent, healthReason: "正常" });
      Object.assign(rejected, { status: "rejected", health: "ok", healthAt: old, healthReason: "正常" });
      Object.assign(trashed, { deletedAt: recent, health: "ok", healthAt: old, healthReason: "正常" });
      fs.writeFileSync(file, JSON.stringify(data));
      // Nobody has the warehouse open: nothing may change.
      await page.goto("about:blank");
      await new Promise((r) => setTimeout(r, 3000));
      assert.strictEqual(fs.readFileSync(file, "utf8"), JSON.stringify(data), "沒人開倉庫時資料被改了");
      await page.goto(BASE);
      const byId = () => Object.fromEntries(JSON.parse(fs.readFileSync(file, "utf8")).items.map((i) => [i.id, i]));
      let after = byId();
      for (let t = 0; t < 40 && after[due.id].healthAt === old; t++) {
        await new Promise((r) => setTimeout(r, 250));
        after = byId();
      }
      assert.notStrictEqual(after[due.id].healthAt, old, "到期的物件沒有被重新檢查");
      assert.strictEqual(after[fresh.id].healthAt, recent, "未滿 24 小時的物件被重檢");
      assert.strictEqual(after[rejected.id].healthAt, old, "不考慮的物件被重檢");
      assert.strictEqual(after[trashed.id].healthAt, old, "回收桶的物件被重檢");
      assert.strictEqual(after[rejected.id].status, "rejected", "股東狀態被改了");
      return `到期物件已重檢（${after[due.id].health}：${after[due.id].healthReason}），其他三個未動`;
    });

    await check("26 不改租金就儲存：不是整百元的原值也不變，且不算手動修改", async () => {
      const fs = require("fs");
      const file = process.env.LOCAL_DATA;
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const target = data.items.find((i) => !i.deletedAt && i.status !== "rejected");
      Object.assign(target, { rent: 602140, manual: [] });
      fs.writeFileSync(file, JSON.stringify(data));
      await page.goto(`${BASE}/?item=${target.id}`);
      const region = page.getByRole("region", { name: "物件瀏覽" });
      await region.locator('[data-fact="rent"]').filter({ hasText: "60.21萬/月" }).waitFor();
      await region.getByRole("button", { name: "編輯", exact: true }).click();
      const d = page.getByRole("dialog", { name: "編輯物件" });
      assert.strictEqual(await d.getByLabel("月租金（萬元）", { exact: true }).inputValue(), "60.214");
      await d.getByRole("button", { name: "儲存", exact: true }).click();
      await d.waitFor({ state: "detached" });
      const saved = JSON.parse(fs.readFileSync(file, "utf8")).items.find((i) => i.id === target.id);
      assert.strictEqual(saved.rent, 602140);
      assert.ok(!saved.manual.includes("rent"), `manual: ${saved.manual}`);
      return "602,140 元顯示 60.21萬/月，編輯欄位 60.214，儲存後仍是 602,140 且不列入手動修改";
    });
  }

  await browser.close();
  internal.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(JSON.stringify({ listingId, manualId }));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
