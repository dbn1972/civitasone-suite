// J6 Journal voucher post (uxtester) -> approve (uxtester2) on Journal approvals -> GL shows it; second JV -> reject on screen (b14)
process.env.L2PART = process.env.L2PART || 'j06';
const L = require('./lib');
const { one, sql, lit, waitRow, sleep, go, act, mark, waitMut, TAG } = L;
const APPR = '/finance/accounting/journal-approvals';

// triage 2026-11-09: since bundle 20 the account <select> ("Account code, line N") is a searchable ARIA combobox "Head of account, line N" (AccountCombobox.tsx):
// click, type the code, pick the role=option. Debit/credit labels ("Debit amount, line N" / "Credit amount, line N") are unchanged.
async function lineSel(p, i) { return p.page.getByRole('combobox', { name: 'Head of account, line ' + i, exact: true }); }
async function setAcct(p, i, code) {
  const c = await lineSel(p, i);
  await c.focus({ timeout: 30000 }); await c.fill(''); await c.pressSequentially(code, { delay: 40 });
  const o = p.page.getByRole('option').filter({ hasText: code }).first();
  await o.waitFor({ state: 'visible', timeout: 15000 });
  await o.click({ timeout: 10000 });
}
// focus()+fill() instead of click(): the layout shifts while validation messages appear ("element is not stable"), which made click() time out
async function clearAcct(p, i) { const c = await lineSel(p, i); await c.focus({ timeout: 30000 }); await c.fill(''); await c.press('Tab'); }
async function listAccts(p) {
  const c = await lineSel(p, 1);
  await c.focus({ timeout: 30000 }); await c.fill(''); await sleep(800);
  const r = await p.page.getByRole('option').evaluateAll((os) => os.map((o) => o.textContent.replace(/\s+/g, ' ').trim()).map((t) => [t.split(' · ')[0].trim(), t]).filter((x) => x[0]));
  await c.press('Escape');
  return r;
}
const cnt = () => one('finance', "select count(*)::int n from gl.finance_journals where lines::text like " + lit('%' + TAG + '%')).n;

async function postJV(j, u1, narr, withChecks, amt) {
  await go(u1, '/finance/accounting/vouchers/new');
  await j.step(u1, '/finance/accounting/vouchers/new', 'open New Journal Voucher', (await L.bodyText(u1)).match(/No period record[^\n]*|period[^\n]{0,60}closed[^\n]*/i)?.[0] || 'ok', true);
  let C = null; try { cnt(); C = cnt; } catch (e) { try { one('finance', "select count(*)::int n from gl.finance_journals where lines::text like 'x'"); C = () => one('finance', "select count(*)::int n from gl.finance_journals where lines::text like " + lit('%' + TAG + '%')).n; } catch (e2) {} }
  if (withChecks) await L.formEmpty(j, u1, '/finance/accounting/vouchers/new', async () => { await clearAcct(u1, 1); await clearAcct(u1, 2); await L.clickBtn(u1, 'Post Journal Entry'); }, C);
  const opts = await listAccts(u1);
  const a1 = opts.find((o) => /UT3CASH|cash/i.test(o[1])) || opts[0];
  const a2 = opts.find((o) => o[0] !== a1[0] && /1100|bank/i.test(o[1])) || opts.find((o) => o[0] !== a1[0]);
  await j.step(u1, '/finance/accounting/vouchers/new', 'choose accounts', 'Dr ' + a1[1] + ' / Cr ' + a2[1] + ' (' + opts.length + ' accounts offered)', true, { shot: false });
  if (withChecks) {
    await L.formInvalid(j, u1, '/finance/accounting/vouchers/new', 'negative debit amount', async () => {
      await u1.page.fill('#jv-narration', narr);
      await setAcct(u1, 1, a1[0]);
      await setAcct(u1, 2, a2[0]);
      await u1.page.getByLabel('Debit amount, line 1').fill('-' + amt);
      await u1.page.getByLabel('Credit amount, line 2').fill('-' + amt);
    }, () => L.clickBtn(u1, 'Post Journal Entry'), C, /amount|negative|positive|valid|greater/i);
    await L.formInvalid(j, u1, '/finance/accounting/vouchers/new', 'unbalanced entry', async () => {
      await u1.page.getByLabel('Debit amount, line 1').fill(String(amt));
      await u1.page.getByLabel('Credit amount, line 2').fill(String(amt - 500));
    }, () => L.clickBtn(u1, 'Post Journal Entry'), C, /balance|equal|debit|credit/i);
  } else {
    await act(async () => { await u1.page.fill('#jv-narration', narr); await setAcct(u1, 1, a1[0]); await setAcct(u1, 2, a2[0]); await u1.page.getByLabel('Debit amount, line 1').fill(String(amt)); });
  }
  await act(() => u1.page.getByLabel('Credit amount, line 2').fill(String(amt)));
  await sleep(800);
  if (withChecks) await L.moneyDate(j, u1, '/finance/accounting/vouchers/new (filled)');
  const m = mark(u1);
  await act(() => L.clickBtn(u1, 'Post Journal Entry'));
  await sleep(1500);
  const d = L.dlg(u1);
  const dt = (await d.innerText({ timeout: 5000 }).catch(() => 'no dialog')).replace(/\s+/g, ' ').slice(0, 300);
  const ta = d.locator('textarea, input[type=text]');
  if (await ta.count()) await ta.first().fill(TAG + ' maker posting note');
  await j.step(u1, '/finance/accounting/vouchers/new', 'Post -> confirm dialog', dt, true);
  await act(() => d.getByRole('button', { name: /post entry|post|confirm/i }).last().click({ timeout: 15000 }));
  const mu = await waitMut(u1, m, /finance\/journals/, 20000);
  await sleep(3000);
  const ui = await L.visibleErrors(u1);
  let jid = null; for (const x of mu) { try { jid = JSON.parse(x.body).id || jid; } catch (e) {} }
  const Q = (id) => 'select id, voucher_no, type, status, created_by, updated_by, rejection_reason, lines::text lines from gl.finance_journals where id=' + lit(id);
  let jr = null;
  if (jid) { try { jr = await waitRow('finance', Q(jid), null, 60000); } catch (e) { jr = await waitRow('finance', 'select id, voucher_no, type, status, created_by, updated_by, lines::text lines from gl.finance_journals where id=' + lit(jid), null, 60000); } }
  if (jr) { const stored = jr.lines || ''; if (!stored.includes(TAG)) j.defect('major', '/finance/accounting/vouchers/new', 'Post a JV with narration "' + narr + '"', 'The narration typed on the form is stored with the journal', 'Journal ' + jid + ' has no narration stored (lines=' + String(jr.lines).slice(0, 200) + ').'); }
  await j.step(u1, '/finance/accounting/vouchers/new', 'post journal', 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.s >= 400 ? x.body : (x.body || '').slice(0, 150)))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 3)) + ' db=' + JSON.stringify(jr && { id: jr.id, status: jr.status, narrStored: String(jr.lines).includes(TAG), created_by: jr.created_by }), !!jr);
  if (jr) j.created('finance journal', jr.id, narr);
  return jr;
}

async function decide(j, p, jr, narr, kind) {
  await go(p, APPR);
  const t = await L.bodyText(p);
  const card = p.page.locator('section, article, [class*=card], div').filter({ hasText: narr }).filter({ has: p.page.getByRole('button', { name: kind === 'approve' ? /approve and post/i : /^reject$/i }) }).last();
  const listed = t.includes(narr);
  const n = await card.count();
  await j.step(p, APPR, (p.user === 'uxtester' ? 'maker' : 'checker') + ' opens Journal approvals', 'journal ' + (listed ? 'listed' : 'NOT listed') + '; ' + kind + ' button in its card: ' + n + (/You drafted this journal/.test(t) ? ' | own-journal note shown' : ''), listed);
  if (!listed || !n) return { ok: false, listed, btn: n };
  const m = mark(p);
  await act(() => card.getByRole('button', { name: kind === 'approve' ? /approve and post/i : /^reject$/i }).first().click());
  await sleep(1200);
  const d = L.dlg(p);
  const dt = (await d.innerText({ timeout: 5000 }).catch(() => 'no dialog')).replace(/\s+/g, ' ').slice(0, 300);
  if (kind === 'reject') {
    const ta = d.locator('textarea, input[type=text]');
    // short reason first: must be refused on screen (>= 10 chars)
    if (await ta.count()) {
      await ta.first().fill('too short');
      const cb = d.getByRole('button', { name: /reject journal/i });
      const dis = await cb.isDisabled().catch(() => false);
      if (!dis) { await act(() => cb.click()); await sleep(1500); }
      const mu0 = await waitMut(p, m, /journals\/.*\/reject/, 3000);
      const e0 = await L.visibleErrors(p);
      j.form(APPR, 'reject reason < 10 chars refused', dis || (!mu0.some((x) => x.s < 300)), dis ? 'confirm disabled' : JSON.stringify(e0.msgs.slice(0, 3)) + ' muts=' + JSON.stringify(mu0.map((x) => x.s)));
      await ta.first().fill(TAG + ' checker rejects: wrong head');
    }
  }
  await j.step(p, APPR, kind + ' -> confirm dialog', dt, true);
  await act(() => d.getByRole('button', { name: kind === 'approve' ? /approve journal/i : /reject journal/i }).last().click({ timeout: 15000 }));
  const mu = await waitMut(p, m, new RegExp('journals/.*/' + kind), 20000);
  await sleep(2500);
  const ui = await L.visibleErrors(p);
  const ok = mu.some((x) => x.s < 300);
  await j.step(p, APPR, 'checker ' + kind + 's journal', JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + (x.s >= 400 ? ' ' + x.body : ''))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 3)), ok);
  return { ok, listed, btn: n };
}

async function main() {
  const j = new L.Journey(6, 'finance-journal', 'Journal voucher post -> approve -> general ledger shows it; second voucher rejected on screen');
  const u1 = await L.persona('uxtester');
  const narr = TAG + ' JV cash to bank transfer';
  const jr = await postJV(j, u1, narr, true, 2500);
  if (!jr) return j.done('FAIL', 'journal not recorded');
  // maker must not be offered Approve on own journal
  await go(u1, APPR);
  const tm = await L.bodyText(u1);
  const ownBtn = await u1.page.locator('div').filter({ hasText: narr }).getByRole('button', { name: /approve and post/i }).count();
  await j.step(u1, APPR, 'maker sees own journal: no Approve offered', 'listed=' + tm.includes(narr) + ' approveButtons=' + ownBtn + ' ownNote=' + /You drafted this journal/.test(tm), tm.includes(narr) && ownBtn === 0);
  const u2 = await L.persona('uxtester2');
  const r = await decide(j, u2, jr, narr, 'approve');
  if (!r.listed || !r.btn) j.defect('blocker', APPR, 'uxtester posts a JV; uxtester2 opens Journal approvals', 'The pending journal is listed with Approve and post / Reject', 'listed=' + r.listed + ' buttons=' + r.btn);
  const ap = await waitRow('finance', 'select id, voucher_no, status, created_by, updated_by from gl.finance_journals where id=' + lit(jr.id), (x) => x.status === 'posted', 60000);
  await j.step(null, 'DB', 'journal posted after approval (approver = uxtester2)', JSON.stringify(ap || one('finance', 'select status, updated_by from gl.finance_journals where id=' + lit(jr.id))), !!ap && ap.updated_by !== jr.created_by);
  let shown = false;
  if (ap) {
    // triage 2026-11-09: the General Ledger list is served from a data cache, so the freshly posted voucher can be missing for a while (screenshot j06-011: search applied,
    // voucher not listed, "256 entries"). Reload + search until the voucher shows (max 45 s); the delay is recorded as evidence / WARN > 5 s; the assertion is unchanged.
    const tPost = Date.now();
    const rs = await L.reloadUntil(u1, '/finance/accounting/general-ledger', async (p) => {
      const sb = p.page.locator('#gl-search');
      if (await sb.count()) { await sb.fill(ap.voucher_no || TAG); await L.clickBtn(p, 'Search', { exact: true }); await sleep(3000); }
      return (await L.bodyText(p)).includes(ap.voucher_no || '@@@');
    }, { sinceTs: tPost, maxMs: 45000 });
    await L.warnStale(j, u1, '/finance/accounting/general-ledger', 'journal approved -> ledger lists voucher', rs);
    const t = await L.bodyText(u1);
    shown = t.includes(ap.voucher_no || '@@@');
    await j.step(u1, '/finance/accounting/general-ledger', 'ledger shows voucher ' + ap.voucher_no, (shown ? 'shown after ' + (rs ? rs.secs : '?') + ' s since approval check' : 'not shown after 45 s of reloads'), shown);
    await L.moneyDate(j, u1, '/finance/accounting/general-ledger');
  }
  // reject path
  const narr2 = TAG + ' JV to be rejected';
  const jr2 = await postJV(j, u1, narr2, false, 1200);
  let rj = null, rr = { ok: false };
  if (jr2) {
    rr = await decide(j, u2, jr2, narr2, 'reject');
    rj = await waitRow('finance', 'select id, status, rejection_reason, updated_by from gl.finance_journals where id=' + lit(jr2.id), (x) => x.status === 'rejected', 60000).catch(() => null);
    await j.step(null, 'DB', 'rejected journal is final (status rejected, reason stored, no voucher)', JSON.stringify(rj || one('finance', 'select status from gl.finance_journals where id=' + lit(jr2.id))), !!rj);
    await go(u2, APPR);
    const t2 = await L.bodyText(u2);
    await j.step(u2, APPR, 'rejected journal shown read-only under Rejected journals', /Rejected journals/.test(t2) && t2.includes(narr2) ? 'shown with reason=' + t2.includes('wrong head') : 'not shown', /Rejected journals/.test(t2) && t2.includes(narr2));
  }
  const pass = r.ok && !!ap && shown && rr.ok && !!rj;
  j.done(pass ? 'PASS' : 'FAIL', pass ? '' : 'approve ok=' + r.ok + ' posted=' + !!ap + ' gl=' + shown + ' reject ok=' + rr.ok + ' rejected=' + !!rj);
}
main().catch((e) => { L.log('FATAL', e.stack); const j = L.J[L.J.length - 1]; if (j && !j.verdict) j.done('FAIL', 'driver exception: ' + e.message.split('\n')[0]); }).finally(() => L.closeAll());
