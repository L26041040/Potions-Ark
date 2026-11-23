/* eslint-disable @typescript-eslint/no-require-imports -- the preinstalled Playwright can only be loaded with require */
// Reads every item's rent, area, floor, 商圈／區域 and tags from the gallery
// cards, the list rows and the detail panel, and reports any disagreement.
// Read-only: it only opens pages, and the background link check a visit would
// start is blocked, so nothing is written. Browser requests to other sites are
// refused except 591's photo hosts.
// Usage: node scripts/check-views.cjs <base-url> [out.json]   (SHARE_URL for a protected preview)
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
  const out = process.argv[3];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (process.env.SHARE_URL) {
    const p0 = await ctx.newPage();
    await p0.goto(process.env.SHARE_URL);
    await p0.close();
  }
  let blockedWrites = 0;
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/api/recheck") {
      blockedWrites++;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, error: "read-only check" }) });
    }
    if (u.host === new URL(BASE).host || /^img\d*\.591\.com\.tw$/.test(u.host)) return r.continue();
    return r.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const filters = page.getByRole("group", { name: "狀態篩選" });
  const defaultFilter = await filters.locator('button[aria-pressed="true"]').innerText();
  const read = (sel) =>
    page.locator(sel).evaluateAll((els) =>
      els.map((el) => ({
        id: el.dataset.itemId,
        name: el.querySelector("[data-name]")?.textContent.trim(),
        flags: el.querySelector("[data-flags]")?.getAttribute("data-flags") || "",
        ...Object.fromEntries([...el.querySelectorAll("[data-fact]")].map((f) => [f.dataset.fact, f.textContent.trim()])),
      })),
    );
  // 全部 leaves out 不考慮, so those and the recycle bin are read separately.
  const rows = {};
  for (const label of ["全部", "不考慮", "回收桶"]) {
    await filters.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await page.waitForTimeout(300);
    for (const c of await read("[data-item-id]")) rows[c.id] = { ...(rows[c.id] || {}), card: c, filter: label };
    await page.getByRole("button", { name: "列表", exact: true }).click();
    for (const c of await read("ul [data-item-id]")) rows[c.id].list = c;
    await page.getByRole("button", { name: "圖庫", exact: true }).click();
  }
  for (const id of Object.keys(rows)) {
    await page.goto(`${BASE}/?item=${id}`);
    const region = page.getByRole("region", { name: "物件瀏覽" });
    const facts = region.locator('[aria-label="物件資訊"]');
    await facts.waitFor();
    rows[id].detail = {
      ...(await facts.evaluate((el) => Object.fromEntries([...el.querySelectorAll("[data-fact]")].map((f) => [f.dataset.fact, f.textContent.trim()])))),
      name: (await region.locator("h2").innerText()).trim(),
      tags: await region.locator("[data-tag]").evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label")}:${e.dataset.state}`)),
      flags: (await region.locator("[data-flag-record]").evaluateAll((els) => els.map((e) => e.dataset.flagRecord))).join("、"),
    };
  }
  const table = Object.entries(rows).map(([id, r]) => {
    const diff = ["name", "rent", "area", "floor", "zone", "flags"].filter((k) => r.card[k] !== r.list?.[k] || r.card[k] !== r.detail[k]);
    const confirmed = r.detail.tags.filter((t) => t.endsWith(":yes")).map((t) => t.split(":")[0]).join("");
    if ((r.card.tags || "") !== (r.list?.tags || "") || (r.card.tags || "") !== confirmed) diff.push("tags");
    return { id, filter: r.filter, name: r.card.name, rent: r.card.rent, area: r.card.area, floor: r.card.floor, zone: r.card.zone, flags: r.card.flags, tags: r.detail.tags.join(" "), diff };
  });
  if (out) fs.writeFileSync(out, JSON.stringify(table, null, 1));
  const mismatched = table.filter((t) => t.diff.length);
  const zeros = table.filter((t) => /^0(萬|坪)/.test(t.rent) || /^0(萬|坪)/.test(t.area));
  console.log(JSON.stringify({ defaultFilter, items: table.length, mismatched: mismatched.length, zeros: zeros.length, blockedWrites }));
  for (const m of mismatched) console.log("MISMATCH", m.id, m.diff.join(","));
  await browser.close();
  process.exit(mismatched.length || zeros.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
