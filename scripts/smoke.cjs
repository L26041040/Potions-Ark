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
    if (route.request().resourceType() === "image") return route.fulfill({ status: 404, body: "" });
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

  await check("3 點卡片才開啟詳細面板，右側顯示原始網頁與開啟按鈕", async () => {
    await page.locator(`[data-item-id="${listingId}"]`).first().click();
    const region = page.getByRole("region", { name: "物件瀏覽" });
    await region.waitFor();
    const frame = region.locator("iframe");
    let detail = "伺服器判定不能嵌入，顯示開啟按鈕";
    if ((await frame.count()) > 0) {
      const src = await frame.getAttribute("src");
      assert.ok(src && src.includes("591.com.tw") && !src.includes("utm_source"), `iframe src = ${src}`);
      detail = `iframe src = ${src}`;
    } else {
      await region.getByRole("button", { name: "開啟原始網頁 ↗", exact: true }).first().waitFor();
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
