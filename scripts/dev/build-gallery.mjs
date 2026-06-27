#!/usr/bin/env node
/** Build docs/screenshots/index.html from results.json + prune orphan PNGs. */
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "docs", "screenshots");
const data = JSON.parse(readFileSync(join(DIR, "results.json"), "utf8"));

// Collect referenced files
const referenced = new Set();
for (const screens of Object.values(data.results)) {
  for (const s of screens) if (s.file) referenced.add(s.file.replace(/\\/g, "/"));
}

// Prune orphan PNGs not referenced by results.json
let pruned = 0;
for (const sub of readdirSync(DIR)) {
  const subPath = join(DIR, sub);
  if (!statSync(subPath).isDirectory()) continue;
  for (const f of readdirSync(subPath)) {
    if (!f.endsWith(".png")) continue;
    const rel = `${sub}/${f}`;
    if (!referenced.has(rel)) { unlinkSync(join(subPath, f)); pruned++; }
  }
}

const moduleCount = Object.keys(data.results).length;
const shotCount = referenced.size;

const nav = Object.keys(data.results)
  .map((m) => `<a href="#${m}">${m}</a>`)
  .join("");

const sections = Object.entries(data.results).map(([module, screens]) => {
  const cards = screens.filter((s) => s.file).map((s) => `
    <figure class="card">
      <a href="${s.file}" target="_blank" rel="noopener">
        <img src="${s.file}" alt="${module} — ${s.label}" loading="lazy">
      </a>
      <figcaption>
        <span class="lbl">${s.label}</span>
        <code>${s.path}</code>
      </figcaption>
    </figure>`).join("");
  return `
  <section id="${module}">
    <h2><span class="dot"></span>${module} <span class="count">${screens.filter((s) => s.file).length} screen(s)</span></h2>
    <div class="grid">${cards}</div>
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CivitasOne — DIC Trial · Application Screenshots</title>
<style>
  :root{--ink:#0f172a;--ink2:#475569;--line:#e2e8f0;--bg:#f8fafc;--brand:#4f46e5;--good:#16a34a}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
  header{background:linear-gradient(135deg,#15172b,#312e81);color:#fff;padding:28px 40px}
  header h1{font-size:24px;font-weight:800;letter-spacing:-.4px}
  header p{color:#c7d2fe;font-size:14px;margin-top:6px}
  header .meta{margin-top:14px;display:flex;gap:24px;flex-wrap:wrap;font-size:13px;color:#a5b4fc}
  header .meta b{color:#fff}
  .topnav{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid var(--line);padding:10px 40px;display:flex;gap:6px;flex-wrap:wrap;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .topnav a{font-size:12.5px;font-weight:600;color:var(--ink2);text-decoration:none;padding:5px 10px;border-radius:8px}
  .topnav a:hover{background:var(--bg);color:var(--brand)}
  main{padding:24px 40px 80px;max-width:1600px;margin:0 auto}
  section{margin-top:36px;scroll-margin-top:64px}
  section h2{font-size:18px;font-weight:750;display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:2px solid var(--line);margin-bottom:18px}
  section h2 .dot{width:10px;height:10px;border-radius:50%;background:var(--brand)}
  section h2 .count{font-size:12px;font-weight:600;color:var(--ink2);background:var(--bg);border:1px solid var(--line);padding:2px 9px;border-radius:999px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.06);transition:.18s}
  .card:hover{transform:translateY(-3px);box-shadow:0 18px 36px -18px rgba(16,24,40,.3)}
  .card img{width:100%;height:230px;object-fit:cover;object-position:top;display:block;border-bottom:1px solid var(--line);background:#fff}
  .card figcaption{padding:11px 14px;display:flex;flex-direction:column;gap:3px}
  .card .lbl{font-weight:680;font-size:14px}
  .card code{font-size:11.5px;color:var(--ink2);background:var(--bg);padding:2px 6px;border-radius:6px;width:fit-content}
  footer{padding:24px 40px;color:var(--ink2);font-size:12.5px;text-align:center;border-top:1px solid var(--line)}
</style>
</head>
<body>
<header>
  <h1>◈ CivitasOne Suite — Application Screenshots</h1>
  <p>Live desktop captures (1440×900) of the running application, module-wise, for functional review.</p>
  <div class="meta">
    <span>Tenant: <b>${data.tenant}</b></span>
    <span>Modules: <b>${moduleCount}</b></span>
    <span>Screens: <b>${shotCount}</b></span>
    <span>Captured: <b>${new Date(data.capturedAt).toLocaleString("en-IN")}</b></span>
    <span>Viewport: <b>Desktop 1440×900</b></span>
  </div>
</header>
<nav class="topnav">${nav}</nav>
<main>${sections}</main>
<footer>
  CivitasOne Suite · Functional Review Gallery · Data source: DIC trial dataset served via local gateway ·
  Click any screenshot to open full-size.
</footer>
</body>
</html>`;

writeFileSync(join(DIR, "index.html"), html);
console.log(`Gallery built: docs/screenshots/index.html`);
console.log(`  ${moduleCount} modules · ${shotCount} screens · pruned ${pruned} orphan PNG(s)`);
