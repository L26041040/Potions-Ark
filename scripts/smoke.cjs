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

// When the server cannot read the page, the edit dialog opens for manual input.
async function dismissEdit(page) {
  await page.waitForTimeout(400);
  const dialog = page.getByRole("dialog", { name: "編輯物件" });
  if (!(await dialog.isVisible())) return false;
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  return true;
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

  await check("2 貼上 591 連結建立收藏（第一次會詢問暱稱）", async () => {
    const before = await cardCount(page);
    await paste(page, `看看這間 ${LISTING}?utm_source=line`);
    const nickField = page.getByLabel("暱稱", { exact: true });
    const asked = await nickField.waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (asked) {
      await nickField.fill(`測試員${stamp}`);
      await page.getByRole("dialog", { name: "你的暱稱" }).getByRole("button", { name: "確定", exact: true }).click();
    }
    await page.getByRole("region", { name: "物件瀏覽" }).waitFor({ timeout: 20000 });
    listingId = new URL(page.url()).searchParams.get("item");
    assert.ok(listingId, "網址沒有帶 ?item=");
    const existed = !asked;
    if (existed) {
      // The listing was saved by an earlier run, so no nickname was needed yet.
      await page.getByRole("button", { name: "設定暱稱", exact: true }).click();
      await nickField.fill(`測試員${stamp}`);
      await page.getByRole("dialog", { name: "你的暱稱" }).getByRole("button", { name: "確定", exact: true }).click();
    }
    const manual = existed ? false : await dismissEdit(page);
    assert.strictEqual(await cardCount(page), before + (existed ? 0 : 1));
    const title = await page.getByRole("region", { name: "物件瀏覽" }).locator("h2").innerText();
    const how = existed ? "（先前已收藏，直接開啟既有物件）" : manual ? "（伺服器讀不到網頁，已跳出補填視窗）" : "（已自動帶入）";
    return `名稱：${title.slice(0, 30)}${how}`;
  });

  await check("3 右側顯示原始網頁（iframe）與開啟原始網頁按鈕", async () => {
    const frame = page.getByRole("region", { name: "物件瀏覽" }).locator("iframe");
    if ((await frame.count()) === 0) {
      await page.getByRole("button", { name: "開啟原始網頁 ↗", exact: true }).first().waitFor();
      return "伺服器判定不能嵌入，顯示開啟按鈕";
    }
    const src = await frame.getAttribute("src");
    assert.ok(src && src.includes("591.com.tw"), `iframe src = ${src}`);
    assert.ok(!src.includes("utm_source"), "追蹤參數沒有清掉");
    assert.ok((await frame.getAttribute("sandbox")).includes("allow-scripts"));
    return `iframe src = ${src}`;
  });

  await check("4 同一網址（加追蹤參數）再貼一次不會重複建立", async () => {
    const before = await cardCount(page);
    await paste(page, `${LISTING}?fbclid=abc`);
    await page.getByText("這個物件已經在倉庫裡").waitFor();
    assert.strictEqual(await cardCount(page), before);
  });

  await check("5 內部位址：照樣建立物件，但伺服器不去讀它", async () => {
    const before = await cardCount(page);
    await paste(page, `http://127.0.0.1:4599/secret-${stamp}`);
    await page.getByRole("dialog", { name: "編輯物件" }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await paste(page, `http://localhost:4599/secret-${stamp}`);
    await page.getByRole("dialog", { name: "編輯物件" }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.strictEqual(await cardCount(page), before + 2);
    assert.strictEqual(internalHits, 0, `內部伺服器被讀了 ${internalHits} 次`);
    return "內部伺服器被讀取 0 次";
  });

  await check("6 手動新增物件並出現 Google Maps 連結", async () => {
    await page.getByRole("button", { name: "手動新增", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "手動新增物件" });
    await dialog.getByLabel("名稱（必填）", { exact: true }).fill(`手動測試物件${stamp}`);
    await dialog.getByLabel("地址（填了才會出現 Google Maps 連結）", { exact: true }).fill("台北市信義區市府路1號");
    await dialog.getByRole("button", { name: "新增", exact: true }).click();
    await page.getByRole("region", { name: "物件瀏覽" }).locator("h2").filter({ hasText: `手動測試物件${stamp}` }).waitFor();
    manualId = new URL(page.url()).searchParams.get("item");
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
