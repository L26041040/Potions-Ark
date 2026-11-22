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

async function check(name, fn) {
  try {
    const detail = await fn();
    step(name, true, detail || "");
  } catch (e) {
    step(name, false, e.message.split("\n")[0]);
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
  page.on("dialog", (d) => d.accept());
  let listingId = null;
  let manualId = null;

  await check("1 開啟網址直接進入網站，不需登入", async () => {
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Potions 二店選址倉庫" }).waitFor();
    assert.strictEqual(await page.getByLabel("貼上網址", { exact: true }).isVisible(), true);
  });

  await check("2 貼上 591 連結建立收藏（第一次會詢問暱稱），收藏後留在倉庫", async () => {
    const before = await cardIds(page);
    await paste(page, `看看這間 ${LISTING}?utm_source=line`);
    const nickField = page.getByLabel("暱稱", { exact: true });
    const asked = await nickField.waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (asked) {
      await nickField.fill(`測試員${stamp}`);
      await page.getByRole("dialog", { name: "你的暱稱" }).getByRole("button", { name: "確定", exact: true }).click();
    }
    await page.getByText(/^已收藏|這個物件已經在倉庫裡/).waitFor({ timeout: 25000 });
    const existed = await page.getByText("這個物件已經在倉庫裡").isVisible();
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
    const name = await page.locator(`[data-item-id="${listingId}"]`).first().innerText();
    const longest = name.split("\n").sort((x, y) => y.length - x.length)[0];
    return `名稱：${longest.slice(0, 30)}${existed ? "（先前已收藏）" : ""}`;
  });

  await check("3 點卡片才開啟；右側是本站原生預覽（照片、資訊），iframe 預設關閉可選配", async () => {
    await page.locator(`[data-item-id="${listingId}"]`).first().click();
    const region = page.getByRole("region", { name: "物件瀏覽" });
    await region.waitFor();
    assert.strictEqual(await region.locator("iframe").count(), 0, "預設就嵌入了 iframe");
    let detail;
    if (REAL) {
      const main = region.locator('img[data-photo-source="listing"]').first();
      const size = await loadedImage(main);
      const thumbs = await region.getByRole("list", { name: "照片縮圖" }).getByRole("listitem").count();
      assert.ok(thumbs >= 2, `只有 ${thumbs} 張照片`);
      const second = region.getByRole("list", { name: "照片縮圖" }).getByRole("listitem").nth(1);
      await second.click();
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
      detail = `591 照片 ${thumbs} 張，第一張 ${size.w}x${size.h}、第二張 ${size2.w}x${size2.h} 已在瀏覽器載入`;
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
    await region.getByRole("button", { name: "關閉", exact: true }).click();
    await region.waitFor({ state: "detached" });
    return detail;
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
    await page.locator(`[data-item-id="${listingId}"]`).waitFor();
  });

  await check("17 手機：全螢幕檢視、開啟原始網頁、改狀態、留言", async () => {
    const mobile = await browser.newContext({ ...devices["iPhone 13"] });
    await stubExternal(mobile);
    await mobile.addInitScript((n) => localStorage.setItem("potions-nickname", n), `手機${stamp}`);
    const m = await mobile.newPage();
    await m.goto(BASE);
    await m.locator(`[data-item-id="${listingId}"]`).click();
    await m.getByRole("button", { name: "開啟原始網頁 ↗", exact: true }).waitFor();
    assert.strictEqual(await m.locator("iframe").count(), 0, "手機不該嵌入");
    await m.getByRole("button", { name: "確定考慮", exact: true }).click();
    await m.getByText(/改為「確定考慮」/).waitFor();
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
    await region.getByLabel("選擇照片", { exact: true }).setInputFiles({ name: "現場照.png", mimeType: "image/png", buffer: png });
    const uploaded = region.locator('img[data-photo-source="upload"]');
    const size = await loadedImage(uploaded);
    // Survives a reload and shows on another device.
    await page.reload();
    await loadedImage(page.getByRole("region", { name: "物件瀏覽" }).locator('img[data-photo-source="upload"]'));
    const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await stubExternal(other);
    const p2 = await other.newPage();
    await p2.goto(`${BASE}/?item=${listingId}`);
    const r2 = p2.getByRole("region", { name: "物件瀏覽" });
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
    await r.getByRole("button", { name: "刪除這張照片", exact: true }).click();
    await r.locator('img[data-photo-source="upload"]').waitFor({ state: "detached" });
    await r.getByRole("button", { name: "關閉", exact: true }).click();
    return `上傳後 ${size.w}x${size.h} 已載入（原本 ${before}）；超過 4 MB、偽裝檔、不存在與回收桶物件都被拒${cap}${refetch}`;
  });

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
