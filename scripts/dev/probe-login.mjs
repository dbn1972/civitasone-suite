import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pw = await import(join(ROOT, "node_modules/.pnpm/playwright@1.61.0/node_modules/playwright/index.js"));
const chromium = pw.chromium ?? pw.default.chromium;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on("console", (m) => console.log("  [console]", m.text().slice(0, 120)));
page.on("response", (r) => { if ([301,302,303,307,308].includes(r.status())) console.log(`  [redirect ${r.status()}] ${r.url().slice(0,100)} -> ${r.headers()["location"]?.slice(0,100) ?? ""}`); });

console.log("1. goto /api/auth/login");
await page.goto(`${BASE}/api/auth/login`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("  goto err:", e.message));
await page.waitForTimeout(2000);
console.log("   landed:", page.url());
console.log("   title:", await page.title());
const html = await page.content();
console.log("   has #username:", html.includes('id="username"') || html.includes('name="username"'));
console.log("   body snippet:", (await page.locator("body").innerText().catch(() => "")).slice(0, 300).replace(/\n+/g, " | "));
await browser.close();
