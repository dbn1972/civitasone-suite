// Screen L2 shared helpers (Playwright, real Keycloak login per persona). Never prints secrets.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const HOME = process.env.HOME;
const REPO = HOME + '/CivitasOne/civitasone-suite';
const { chromium } = require(REPO + '/node_modules/.pnpm/playwright@1.61.0/node_modules/playwright');
const BASE = 'http://localhost:3000';
const PUBLIC = 'https://civitasone.65-2-205-201.nip.io';
const TENANT = '11111111-0000-0000-0000-000000000001';
const RUN = process.env.L2RUN || (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()); })();
const TAG = 'UAT-SCREEN-L2-' + RUN;
const OUT = HOME + '/orch-logs/uat-screens/l2-' + RUN;
fs.mkdirSync(OUT + '/shots', { recursive: true });
const T0 = process.env.L2T0 || new Date().toISOString();
const log = (...a) => { const s = new Date().toISOString().slice(11, 19) + ' ' + a.join(' '); console.log(s); fs.appendFileSync(OUT + '/run.log', s + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmo = (pr, ms, label) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + ms + 'ms: ' + label)), ms))]);

function password(user) {
  return execFileSync('python3', ['-c', "import sys;sys.path.insert(0,sys.argv[1]);import w7lib;sys.stdout.write(w7lib._password(sys.argv[2]))", HOME + '/orch/uat-db/w7', user], { encoding: 'utf8' });
}
function jwtPayload(tok) { try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); } catch (e) { return {}; } }

// Same approach as ~/orch/screen-l1/sweep.js login(): real Keycloak form; the public callback hop is re-pointed to localhost.
async function login(ctx, user) {
  const p = await ctx.newPage();
  let cbQuery = null;
  await p.route(/\/login-actions\/authenticate/, async (route) => {
    const resp = await route.fetch({ maxRedirects: 0 });
    const loc = resp.headers()['location'] || '';
    if (loc.includes('/api/auth/callback?')) { cbQuery = loc.split('?')[1]; return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>cb</body></html>' }); }
    return route.fulfill({ response: resp });
  });
  await ctx.clearCookies({ domain: new URL(PUBLIC).hostname });
  await p.goto(BASE + '/api/auth/login?next=/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 60 && cbQuery === null; i++) { if (await p.$('#username')) break; await p.waitForTimeout(500); }
  if (cbQuery === null) {
    await p.fill('#username', user);
    await p.fill('#password', password(user));
    await p.click('#kc-login, input[type=submit], button[type=submit]');
  }
  for (let i = 0; i < 60 && cbQuery === null; i++) await p.waitForTimeout(500);
  if (cbQuery === null) throw new Error('login ' + user + ': no callback');
  const cb = await ctx.newPage();
  await cb.route(PUBLIC + '/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>landed</body></html>' }));
  await cb.goto(BASE + '/api/auth/callback?' + cbQuery, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await cb.close();
  const ck = (await ctx.cookies(BASE)).find((c) => c.name === 'civitasone_at');
  if (!ck) throw new Error('login ' + user + ': no access cookie');
  await p.close();
  ctx.__user = user; ctx.__sub = jwtPayload(ck.value).sub;
  log('login OK', user);
}
async function ensureAuth(ctx) {
  const at = (await ctx.cookies(BASE)).find((c) => c.name === 'civitasone_at');
  if (!at || (jwtPayload(at.value).exp || 0) - Date.now() / 1000 < 180) await login(ctx, ctx.__user);
}

let browser = null;
const personas = {};
async function persona(user) {
  if (!browser) browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  if (!personas[user]) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
    ctx.setDefaultTimeout(30000);
    await login(ctx, user);
    const page = await ctx.newPage();
    const net = [];
    page.on('response', async (res) => {
      const req = res.request();
      const m = req.method();
      const u = res.url();
      if (!/localhost:(3000|8080)/.test(u) || /_next|favicon|\.(js|css|png|svg|woff2?)(\?|$)/.test(u)) return;
      const e = { t: Date.now(), m, u: u.replace(BASE, '').slice(0, 200), s: res.status() };
      if (m !== 'GET' || res.status() >= 400) { try { e.body = (await res.text()).slice(0, 600); } catch (x) {} try { e.req = (req.postData() || '').slice(0, 600); } catch (x) {} }
      net.push(e);
    });
    page.on('pageerror', (e) => net.push({ t: Date.now(), m: 'PAGEERROR', u: '', s: 0, body: String(e.message).slice(0, 300) }));
    page.on('dialog', async (d) => { net.push({ t: Date.now(), m: 'DIALOG', u: d.type(), s: 0, body: d.message().slice(0, 300) }); try { await d.accept(); } catch (x) {} });
    personas[user] = { ctx, page, net, user, sub: ctx.__sub };
  }
  await ensureAuth(personas[user].ctx);
  return personas[user];
}
async function closeAll() { if (browser) await browser.close(); }

// ------------------------------------------------------------ DB (read-only SELECT via docker exec psql)
function sql(db, q) {
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error('SELECT only');
  const wrapped = "BEGIN READ ONLY; select coalesce(jsonb_agg(t),'[]'::jsonb) from (" + q.replace(/;\s*$/, '') + ') t; COMMIT;';
  const out = execFileSync('docker', ['exec', '-i', 'civitasone-postgres', 'psql', '-U', 'civitas_admin', '-d', 'civitas_' + db, '-At', '-v', 'ON_ERROR_STOP=1'], { input: wrapped, encoding: 'utf8', maxBuffer: 1 << 26 });
  for (const l of out.split('\n')) if (l.trim().startsWith('[')) return JSON.parse(l.trim());
  return [];
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
function one(db, q) { const r = sql(db, q); return r[0] || null; }
async function waitRow(db, q, pred, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let rows = []; try { rows = sql(db, q); } catch (e) {}
    const r = rows.find((x) => !pred || pred(x));
    if (r) return r;
    if (Date.now() > end) return null;
    await sleep(2500);
  }
}
function wfInstances(ref) { return sql('workflow', 'select i.id, i.status, d.code def_code, i.created_by, i.updated_by from workflow.instances i left join workflow.definitions d on d.id=i.definition_id where i.ref_id=' + lit(ref) + ' order by i.created_at'); }
function wfTasks(ref) { return sql('workflow', 'select t.id, t.status, t.decision, t.completed_by, t.sod_override, t.role_ref from workflow.tasks t join workflow.instances i on i.id=t.instance_id where i.ref_id=' + lit(ref) + ' order by t.created_at'); }
function auditRows(ref) { return sql('audit', "select payload->>'service' svc, payload->>'action' action, actor->>'actorId' actor, created_at from events.events where created_at > " + lit(T0) + ' and target=' + lit(ref) + ' order by created_at'); }

// ------------------------------------------------------------ journey bookkeeping
const J = [];
const CREATED = [];
const DEFECTS = [];
let shotN = 0;
class Journey {
  constructor(n, key, title) { this.n = n; this.key = key; this.title = title; this.steps = []; this.forms = []; this.verdict = null; this.notes = []; this.records = {}; this.t0 = Date.now(); J.push(this); log('=== J' + n, key, title); }
  async shot(p, name) {
    const f = path.join(OUT, 'shots', 'j' + String(this.n).padStart(2, '0') + '-' + String(++shotN).padStart(3, '0') + '-' + name.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) + '.png');
    try { await tmo(p.page.screenshot({ path: f, fullPage: true, timeout: 20000 }), 25000, 'shot'); } catch (e) { try { await tmo(p.page.screenshot({ path: f, timeout: 10000 }), 15000, 'shot2'); } catch (e2) { return null; } }
    return path.relative(OUT, f);
  }
  async step(p, screen, action, result, ok, extra = {}) {
    const s = { as: p ? p.user : null, screen, action, result: String(result).slice(0, 700), ok: ok === undefined ? null : !!ok, ...extra };
    if (p && extra.shot !== false) s.shot = await this.shot(p, action);
    this.steps.push(s);
    log('  [' + (p ? p.user : '-') + '] ' + screen + ' | ' + action + ' -> ' + (ok === true ? 'OK' : ok === false ? 'FAIL' : 'INFO') + ' | ' + String(result).slice(0, 220));
    return ok;
  }
  form(screen, check, ok, detail) { this.forms.push({ screen, check, result: ok === null ? 'n/a' : ok ? 'pass' : 'fail', detail: String(detail).slice(0, 500) }); log('  FORM ' + screen + ' | ' + check + ' -> ' + (ok === null ? 'N/A' : ok ? 'pass' : 'FAIL') + ' | ' + String(detail).slice(0, 200)); }
  defect(sev, screen, steps, expected, actual) { const d = { journey: this.n, sev, screen, steps, expected, actual }; DEFECTS.push(d); log('  DEFECT[' + sev + '] ' + screen + ' | ' + actual.slice(0, 200)); }
  created(kind, id, label) { CREATED.push({ journey: this.n, kind, id, label }); this.records[kind] = id; log('  CREATED ' + kind + ' ' + id + ' ' + label); }
  done(verdict, note) { this.verdict = verdict; if (note) this.notes.push(note); this.secs = Math.round((Date.now() - this.t0) / 1000); log('=== J' + this.n + ' ' + verdict + (note ? ' | ' + note : '')); save(); }
  toJSON() { return { n: this.n, key: this.key, title: this.title, verdict: this.verdict, notes: this.notes, records: this.records, steps: this.steps, forms: this.forms, secs: this.secs }; }
}
function save() {
  const f = OUT + '/results-' + (process.env.L2PART || 'main') + '.json';
  const all429 = R429.slice();
  for (const u of Object.keys(personas)) for (const e of personas[u].net) if (e.s === 429 && !all429.some((x) => x.ts === new Date(e.t).toISOString() && x.call === e.m + ' ' + e.u)) all429.push({ ts: new Date(e.t).toISOString(), as: u, page: null, call: e.m + ' ' + e.u });
  fs.writeFileSync(f, JSON.stringify({ run: RUN, tag: TAG, t0: T0, journeys: J, created: CREATED, defects: DEFECTS, http429: all429 }, null, 1));
}

// ------------------------------------------------------------ page helpers
const R429 = [];
async function go(p, url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(1500 + attempt * 20000);
    const m0 = p.net.length;
    await tmo(p.page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 }), 65000, 'goto ' + url);
    try { await tmo(p.page.waitForLoadState('networkidle', { timeout: 12000 }), 15000, 'idle'); } catch (e) {}
    await p.page.waitForTimeout(800);
    const hits = p.net.slice(m0).filter((e) => e.s === 429);
    if (!hits.length) return;
    hits.forEach((h) => R429.push({ ts: new Date(h.t).toISOString(), as: p.user, page: url, call: h.m + ' ' + h.u, attempt }));
    let failed = false;
    try { failed = /couldn.t load|we couldn.t|try again|something went wrong/i.test(await p.page.evaluate(() => document.body.innerText)); } catch (e) {}
    log('  429 on ' + url + ' (' + hits.length + ' calls, attempt ' + attempt + (failed ? ', page shows load error -> slow retry' : '') + ')');
    if (!failed) return;
  }
}
async function act(fn) { await sleep(1800); const r = await fn(); await sleep(400); return r; }
function mark(p) { return p.net.length; }
function since(p, m, filt) { return p.net.slice(m).filter((e) => !filt || filt(e)); }
function mutations(p, m) { return since(p, m, (e) => e.m !== 'GET' && e.m !== 'HEAD' && e.m !== 'OPTIONS'); }
async function waitMut(p, m, re, ms = 20000) { const end = Date.now() + ms; for (;;) { const x = mutations(p, m).filter((e) => !re || re.test(e.u)); if (x.length) return x; if (Date.now() > end) return []; await sleep(500); } }
async function visibleErrors(p) {
  return evalT(p, () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const sel = '[role=alert], [aria-invalid=true] ~ *, .text-destructive, .text-red-500, .text-red-600, .text-red-700, .text-danger, [data-sonner-toast], [id$="-error"], [id*="error"], .error, .field-error, p[class*=error], span[class*=error], [aria-live]';
    const out = [];
    for (const el of document.querySelectorAll(sel)) { if (!vis(el)) continue; const t = (el.innerText || '').trim(); if (t && t.length < 400 && !out.includes(t) && !/See what.s new|^₹[\d.,]+$|^Loading|^Was this helpful/.test(t)) out.push(t); }
    const inv = [...document.querySelectorAll('[aria-invalid=true]')].map((e) => e.getAttribute('name') || e.id || e.getAttribute('aria-label')).filter(Boolean);
    const native = [...document.querySelectorAll('input,select,textarea')].filter((e) => e.willValidate && !e.checkValidity()).map((e) => (e.name || e.id) + ':' + e.validationMessage);
    return { msgs: out.slice(0, 20), invalid: inv, native: native.slice(0, 20) };
  });
}
function readable(msgs) {
  // raw code / JSON / stack heuristics
  const bad = msgs.filter((m) => /^\s*[\[{]|"(code|message|error)"\s*:|\b[A-Z][A-Z0-9]+(_[A-Z0-9]+){1,}\b|ZodError|TypeError|at [\w.]+ \(|undefined|null|\[object Object\]|Internal Server Error|status code \d{3}/.test(m));
  return { ok: bad.length === 0, bad };
}
function evalT(p, fn, arg) { return tmo(p.page.evaluate(fn, arg), 20000, 'evaluate'); }
async function bodyText(p) { return evalT(p, () => document.body.innerText); }
function inrIndian(s) { return /₹\s?\d{1,2}(,\d{2})*,\d{3}(\.\d{2})?|₹\s?\d{1,3}(\.\d{2})?\b/.test(s); }
function inrWestern(s) { return /₹\s?\d{1,3}(,\d{3}){2,}/.test(s); }
async function moneyDateCheck(p) {
  const t = await bodyText(p);
  const rupee = (t.match(/₹\s?[\d,]+(\.\d+)?/g) || []).slice(0, 12);
  const western = rupee.filter((x) => /₹\s?\d{1,3}(,\d{3}){2,}/.test(x));
  const isoDates = (t.match(/\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}[:\d.Z+-]*)?\b/g) || []).slice(0, 8);
  const readableDates = (t.match(/\b\d{1,2}[ -](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ -,]+\d{4}\b|\b\d{2}\/\d{2}\/\d{4}\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/g) || []).slice(0, 8);
  const rawMinor = (t.match(/\b\d{6,}\b(?!-)/g) || []).slice(0, 5);
  return { rupee, western, isoDates, readableDates, rawMinor };
}
async function dumpForm(p) {
  return evalT(p, () => {
    const lab = (el) => { if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.innerText.trim(); } const pl = el.closest('label'); if (pl) return pl.innerText.trim(); return el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''; };
    const f = [...document.querySelectorAll('input,select,textarea,[role=combobox]')].map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name, id: e.id, label: lab(e).slice(0, 60), req: e.required || e.getAttribute('aria-required') === 'true', val: (e.value || '').slice(0, 40), opts: e.tagName === 'SELECT' ? [...e.options].slice(0, 12).map((o) => o.value + '=' + o.text.slice(0, 30)) : undefined }));
    const b = [...document.querySelectorAll('button,a[role=button],[role=tab]')].map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40)).filter(Boolean);
    return { url: location.pathname, h1: [...document.querySelectorAll('h1,h2')].map((h) => h.innerText.trim()).slice(0, 5), fields: f, buttons: [...new Set(b)].slice(0, 60) };
  });
}

module.exports = { tmo, evalT, BASE, TENANT, RUN, TAG, OUT, T0, log, sleep, persona, closeAll, sql, one, lit, waitRow, wfInstances, wfTasks, auditRows, Journey, J, CREATED, DEFECTS, save, go, act, mark, since, mutations, waitMut, visibleErrors, readable, bodyText, moneyDateCheck, dumpForm, inrWestern };

// ------------------------------------------------------------ form-check helpers
async function formEmpty(j, p, screen, clickFn, countFn) {
  const c0 = countFn ? countFn() : null;
  const m = mark(p);
  let disabled = false;
  try { await act(clickFn); } catch (err) { if (/DISABLED/.test(err.message)) disabled = true; else throw err; }
  await sleep(3000);
  const e = await visibleErrors(p);
  if (disabled) {
    const reqd = await evalT(p, () => [...document.querySelectorAll('[aria-required=true],[required]')].length);
    await j.step(p, screen, 'submit empty form', 'submit button is DISABLED while mandatory fields are empty; required-marked fields=' + reqd + ' messages=' + JSON.stringify(e.msgs.slice(0, 4)), true);
    j.form(screen, 'empty submit shows mandatory-field messages', null, 'submit disabled until mandatory fields are filled (no messages on empty submit); required-marked fields=' + reqd);
    j.form(screen, 'empty submit creates nothing', true, 'submit disabled');
    return { e, muts: [], created: false, shown: false, disabled };
  }
  const muts = mutations(p, m).filter((x) => !/\/(telemetry|analytics|log|events|feedback|metrics|rum|vitals)/i.test(x.u));
  const c1 = countFn ? countFn() : null;
  const msgs = e.msgs.concat(e.native);
  const shown = msgs.length > 0 || e.invalid.length > 0;
  const created = countFn ? c1 !== c0 : muts.some((x) => x.s >= 200 && x.s < 300);
  const rd = readable(e.msgs);
  await j.step(p, screen, 'submit empty form', 'messages=' + JSON.stringify(e.msgs.slice(0, 6)) + ' native=' + JSON.stringify(e.native.slice(0, 6)) + ' invalid=' + JSON.stringify(e.invalid) + ' mutations=' + JSON.stringify(muts.map((x) => x.m + ' ' + x.u + ' ' + x.s)) + ' dbCount ' + c0 + '->' + c1, shown && !created);
  j.form(screen, 'empty submit shows mandatory-field messages', shown, JSON.stringify(msgs.slice(0, 8)));
  j.form(screen, 'empty submit creates nothing', !created, 'db ' + c0 + '->' + c1 + ' muts=' + muts.length);
  j.form(screen, 'error text readable (no raw codes/JSON)', rd.ok, rd.ok ? 'ok' : JSON.stringify(rd.bad));
  return { e, muts, created, shown };
}
async function formInvalid(j, p, screen, what, fillFn, clickFn, countFn, expectRe) {
  const c0 = countFn ? countFn() : null;
  await act(fillFn);
  const m = mark(p);
  let disabledNote = '';
  if (clickFn) { try { await act(clickFn); } catch (err) { if (/DISABLED/.test(err.message)) disabledNote = ' (submit button disabled)'; else throw err; } }
  await sleep(3000);
  const e = await visibleErrors(p);
  const muts = mutations(p, m);
  const c1 = countFn ? countFn() : null;
  const msgs = e.msgs.concat(e.native);
  const hit = expectRe ? msgs.filter((x) => expectRe.test(x)) : msgs;
  const created = countFn ? c1 !== c0 : muts.some((x) => x.s >= 200 && x.s < 300);
  const rd = readable(e.msgs);
  const ok = (hit.length > 0 || e.invalid.length > 0) && !created;
  await j.step(p, screen, 'invalid value: ' + what, 'messages=' + JSON.stringify(e.msgs.slice(0, 6)) + ' native=' + JSON.stringify(e.native.slice(0, 4)) + ' invalid=' + JSON.stringify(e.invalid) + ' mutations=' + JSON.stringify(muts.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.body || '').slice(0, 160))) + ' db ' + c0 + '->' + c1, ok);
  j.form(screen, 'invalid value (' + what + ') -> field error shown, nothing created', ok, JSON.stringify(hit.slice(0, 4)) + ' invalid=' + JSON.stringify(e.invalid) + ' created=' + created + disabledNote);
  if (e.msgs.length) j.form(screen, 'invalid-value error text readable', rd.ok, rd.ok ? 'ok' : JSON.stringify(rd.bad));
  return { e, muts, created, ok };
}
async function moneyDate(j, p, screen) {
  const md = await moneyDateCheck(p);
  const okM = md.rupee.length ? md.western.length === 0 : null;
  j.form(screen, 'amounts in ₹ with Indian grouping', okM, JSON.stringify(md.rupee.slice(0, 6)) + (md.western.length ? ' WESTERN=' + JSON.stringify(md.western) : ''));
  const okD = md.isoDates.length === 0 ? (md.readableDates.length ? true : null) : false;
  j.form(screen, 'dates readable (not raw ISO)', okD, 'readable=' + JSON.stringify(md.readableDates.slice(0, 4)) + ' iso=' + JSON.stringify(md.isoDates.slice(0, 4)));
  return md;
}
async function clickBtn(p, name, opts = {}) {
  const loc = p.page.getByRole('button', { name, exact: !!opts.exact });
  const n = await loc.count();
  if (!n) throw new Error('button not found: ' + name);
  if (await loc.nth(opts.nth || 0).isDisabled().catch(() => false)) throw new Error('DISABLED button: ' + name);
  await loc.nth(opts.nth || 0).click({ timeout: 15000 });
}
async function apiProxy(p, method, path, body) {
  // through the web app's own authenticated proxy (same cookie as the screens); used only for setup/probes noted in evidence
  const r = await p.ctx.request.fetch(BASE + '/api/proxy' + path, { method, data: body, headers: { 'content-type': 'application/json' }, failOnStatusCode: false });
  let t = ''; try { t = await r.text(); } catch (e) {}
  return { status: r.status(), text: t.slice(0, 800) };
}
function dlg(p) { return p.page.locator('[role=dialog]:visible, [role=alertdialog]:visible'); }
module.exports.dlg = dlg; module.exports.formEmpty = formEmpty; module.exports.formInvalid = formInvalid; module.exports.moneyDate = moneyDate; module.exports.clickBtn = clickBtn; module.exports.apiProxy = apiProxy;
async function pick(p, inputSel, query, matchRe) {
  const inp = p.page.locator(inputSel).first();
  await inp.click({ timeout: 15000 });
  await inp.fill('');
  await inp.pressSequentially(query, { delay: 60 });
  for (let i = 0; i < 25; i++) {
    await sleep(800);
    const opts = p.page.locator('[role=option]:visible');
    const n = await opts.count();
    for (let k = 0; k < n; k++) {
      const t = (await opts.nth(k).innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (!matchRe || matchRe.test(t)) { await opts.nth(k).click({ timeout: 10000 }); return t; }
    }
  }
  const lst = await p.page.locator('[role=listbox]:visible').innerText().catch(() => '');
  throw new Error('picker ' + inputSel + ' no option for "' + query + '" (listbox: ' + lst.replace(/\s+/g, ' ').slice(0, 150) + ')');
}
module.exports.pick = pick;

// triage 2026-11-09: stale-view helper. The web app serves several detail pages from a 15-30 s data cache (loaders.ts revalidateSeconds), so right after a mutation the
// screen can still show the old state. reloadUntil reloads `url` until testFn(p) is truthy (up to maxMs, default 45 s) and returns the seconds from `sinceTs` (the action
// time) until the new state was visible. The assertion that follows stays as strict as before; the delay is recorded as evidence and, if > 5 s, as a WARN step.
async function reloadUntil(p, url, testFn, opts = {}) {
  const sinceTs = opts.sinceTs || Date.now(); const maxMs = opts.maxMs || 45000; let tries = 0;
  for (;;) {
    await go(p, url); tries++;
    let ok = false; try { ok = await testFn(p); } catch (e) {}
    const secs = Math.round((Date.now() - sinceTs) / 100) / 10;
    if (ok) return { ok: true, secs, tries };
    if (Date.now() - sinceTs > maxMs) return { ok: false, secs, tries };
    await sleep(3000);
  }
}
async function warnStale(j, p, screen, what, r) {
  if (r && r.secs > 5) await j.step(p, screen, 'WARN stale view ' + r.secs + ' s after action (' + what + ')', 'new state ' + (r.ok ? 'visible' : 'NOT visible') + ' after ' + r.secs + ' s and ' + r.tries + ' reload(s); page data cache is stale after a mutation (product UX issue, evidence for the report)', null);
}
module.exports.reloadUntil = reloadUntil; module.exports.warnStale = warnStale;
