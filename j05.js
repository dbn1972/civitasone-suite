// J5 Payroll run create (uxtester) -> L1 approve (uxtester2) -> L2 disburse (uxtester3) -> payslip view
process.env.L2PART = process.env.L2PART || 'j05';
const L = require('./lib');
const { one, sql, lit, waitRow, sleep, go, act, mark, waitMut, TAG } = L;
const STRUCT = process.env.J5_STRUCT || '054d38d4-d016-4ed6-b5fd-aa5aba67f560';
// retest-20261105: months come from uat-retest-resolve.py (first free month of FY 2026-27; duplicate probe = latest disbursed month)
let J5M = process.env.J5_MONTH || '4', J5Y = process.env.J5_YEAR || '2027';
const J5DM = process.env.J5_DUP_MONTH || '3', J5DY = process.env.J5_DUP_YEAR || '2027';
// triage 2026-11-09: the Create Run form blocks any month that already has a run (CreatePayrollRunForm.tsx periodHasRun), and every J5 run consumes one month; all
// 12 months of FY 2026-27 are now used. If the configured month is taken, walk back to the latest month (2026-03 downwards) that has no run at all. A past FY is fine for
// create -> compute -> approve -> disburse (tax config exists, computes OK). SELECT only.
try {
  const taken = new Set(L.sql('payroll', "select distinct month::text m from payroll.payroll_runs where tenant_id=" + lit(L.TENANT)).map((r) => r.m));
  const key = (y, m) => y + '-' + String(m).padStart(2, '0');
  if (taken.has(key(J5Y, J5M))) {
    let y = 2026, m = 3, n = 0;
    while (taken.has(key(y, m)) && n++ < 36) { m--; if (m < 1) { m = 12; y--; } }
    L.log('J5 month ' + key(J5Y, J5M) + ' already has a run -> using free month ' + key(y, m));
    J5Y = String(y); J5M = String(m);
  }
} catch (e) { L.log('J5 free-month lookup failed: ' + e.message.split('\n')[0]); }
const J5LBL = J5Y + '-' + String(J5M).padStart(2, '0');

async function runAction(j, p, rid, btnName, confirmRe, reason, label) {
  await go(p, '/hr/payroll/' + rid);
  await sleep(2000);
  const b = p.page.getByRole('button', { name: btnName });
  const n = await b.count();
  const dis = n ? await b.first().isDisabled() : null;
  const hint = (await L.bodyText(p)).match(/(You created this run[^\n]*|You approved this run[^\n]*)/)?.[0] || '';
  if (!n || dis) { await j.step(p, '/hr/payroll/[id]', label + ': "' + btnName + '" button', (n ? 'disabled' : 'absent') + (hint ? ' | hint: ' + hint : ''), null); return { blocked: true, dis, hint }; }
  const m = mark(p);
  await act(() => b.first().click());
  await sleep(1200);
  const d = L.dlg(p);
  const dt = (await d.innerText({ timeout: 5000 }).catch(() => 'no dialog')).replace(/\s+/g, ' ').slice(0, 300);
  const ta = d.locator('textarea, input[type=text]');
  if (await ta.count()) await ta.first().fill(TAG + ' ' + reason);
  await j.step(p, '/hr/payroll/[id]', label + ': confirm dialog', dt, true);
  await act(() => d.getByRole('button', { name: confirmRe }).last().click({ timeout: 15000 }));
  let mu = await waitMut(p, m, /payroll\/runs/, 20000);
  // triage 2026-11-09: since bundle 15 the server answers 409 ZERO_BASIC_SLIPS / ARREARS_REVIEW_REQUIRED / ... to the first approve and the dialog turns into a review step
  // (PayrollRunActions.tsx: per-employee "exclude" checkbox + one review note, then Approve again). A real L1 approver reviews the flagged slips, excludes the ones with
  // no basic pay with a note, and confirms again. This is recorded as an INFO step (not a pass), the final approve is still asserted below and in the DB. With clean
  // master data (every employee has a basic pay) this branch is not taken.
  const REVIEW = /ZERO_BASIC_SLIPS|ARREARS_REVIEW_REQUIRED|NET_PAY_NON_POSITIVE|UNRECORDED_FY_MONTHS_ESTIMATED|TDS_SHORTFALL_UNRECOVERABLE|EPS_ELIGIBILITY_UNRECORDED/;
  // The review can come in several rounds (ZERO_BASIC_SLIPS first, then e.g. UNRECORDED_FY_MONTHS_ESTIMATED = "N TDS item(s) need an acknowledgement"). Each round the approver
  // ticks the flagged items shown in the dialog (exclude / acknowledge), writes the review note and confirms again; max 4 rounds, every round is an INFO step.
  for (let round = 1; round <= 4; round++) {
    const rv = mu.find((x) => x.s === 409 && REVIEW.test(x.body || ''));
    if (!rv) break;
    await sleep(1500);
    const boxes = d.locator('input[type=checkbox]');
    const nb = await boxes.count(); const names = [];
    for (let k = 0; k < nb; k++) { const bx = boxes.nth(k); if (!(await bx.isChecked())) { await bx.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); await bx.evaluate((el) => el.click()); }  /* DOM click: with many flagged slips the checkbox can sit outside the dialog's viewport */ if (!(await bx.isChecked())) throw new Error('review checkbox ' + k + ' could not be ticked'); names.push((await bx.locator('xpath=ancestor::label[1]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 60)); }
    // the review note has its own label (reviewNoteLabel); the dialog also has the generic reason textarea, so .last() was not reliable
    const noteByLabel = d.getByLabel(/^review note/i);
    const note = (await noteByLabel.count()) ? noteByLabel.last() : d.locator('textarea').last();
    if (await note.count()) await note.fill('DEEP-triage-payroll: reviewed round ' + round + ' (' + ((rv.body.match(/"code":"(\w+)"/) || [])[1] || '?') + '); slips with no basic pay in the HRMS record are excluded from this run and flagged TDS estimates acknowledged; to be corrected before the next cycle.');
    await j.step(p, '/hr/payroll/[id]', label + ': review round ' + round + ' (INFO)', 'server said 409 ' + ((rv.body.match(/"code":"(\w+)"/) || [])[1]) + '; ticked ' + nb + ' item(s): ' + JSON.stringify(names.slice(0, 6)) + (names.length > 6 ? ' ...' : '') + ' body=' + (rv.body || '').slice(0, 160), null);
    const m2 = mark(p);
    const cb2 = d.getByRole('button', { name: confirmRe }).last();
    await cb2.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await act(() => cb2.click({ timeout: 8000 }).catch(() => cb2.evaluate((el) => el.click())));  // DOM-click fallback: the long review list can push the button out of the viewport
    mu = await waitMut(p, m2, /payroll\/runs/, 20000);
  }
  await sleep(3000);
  const ui = await L.visibleErrors(p);
  await j.step(p, '/hr/payroll/[id]', label, 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.s >= 400 ? (x.body || '').slice(0, 200) : ''))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 3)), mu.some((x) => x.s < 300));
  return { mu, ui };
}

async function main() {
  const j = new L.Journey(5, 'payroll-run', 'Payroll run create -> L1 approve -> L2 disburse -> payslip view');
  const u1 = await L.persona('uxtester');
  await go(u1, '/hr/payroll');
  await j.step(u1, '/hr/payroll', 'open Create Payroll Run', 'ok', true);
  const runNo = TAG + '-RUN';
  const cnt = () => one('payroll', "select count(*)::int n from payroll.payroll_runs where tenant_id=" + lit(L.TENANT)).n;
  // empty: clear Run No and submit
  await L.formEmpty(j, u1, '/hr/payroll (Create Run)', async () => { await u1.page.getByLabel('Run No.').fill(''); await L.clickBtn(u1, 'Create Run'); }, cnt);
  // invalid: a month that already has a disbursed run (2027-03)
  await go(u1, '/hr/payroll');
  await L.formInvalid(j, u1, '/hr/payroll (Create Run)', 'month already disbursed (2027-03, duplicate period)', async () => {
    await u1.page.getByLabel('Month').selectOption(J5DM);
    await u1.page.getByLabel('Year').selectOption(J5DY);
    await u1.page.getByLabel('Run No.').fill(TAG + '-DUP');
    await u1.page.getByLabel('Pay Structure').selectOption(STRUCT);
  }, () => L.clickBtn(u1, 'Create Run'), cnt, /exist|already|duplicate|period|month/i);
  await sleep(5000);
  const dupRow = one('payroll', 'select id, status from payroll.payroll_runs where run_no=' + lit(TAG + '-DUP'));
  if (dupRow) { j.created('payroll run', dupRow.id, TAG + '-DUP (2027-03 duplicate-period probe; accepted by the server)'); j.defect('major', '/hr/payroll (Create Run)', 'Create Run for 2027-03 (a month that already has a disbursed run)', 'Refused with a readable message, no run created', 'Run created: ' + JSON.stringify(dupRow)); }
  // valid run (month from env) (2027-01 used by baseline)
  await go(u1, '/hr/payroll');
  await act(async () => {
    await u1.page.getByLabel('Month').selectOption(J5M);
    await u1.page.getByLabel('Year').selectOption(J5Y);
    await u1.page.getByLabel('Run No.').fill(runNo);
    await u1.page.getByLabel('Pay Structure').selectOption(STRUCT);
  });
  const m = mark(u1);
  await act(() => L.clickBtn(u1, 'Create Run'));
  await sleep(1500);
  if (await L.dlg(u1).count()) { const b = L.dlg(u1).getByRole('button', { name: /create|confirm|yes|run/i }); if (await b.count()) await act(() => b.last().click()); }
  const mu = await waitMut(u1, m, /payroll\/runs/, 20000);
  let row = await waitRow('payroll', 'select id, run_no, month, status, created_by, approved_by, last_error from payroll.payroll_runs where run_no=' + lit(runNo), null, 60000);
  const ui = await L.visibleErrors(u1);
  await j.step(u1, '/hr/payroll', 'Create Run ' + J5LBL, 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.s >= 400 ? x.body : ''))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 3)) + ' db=' + JSON.stringify(row), !!row);
  if (!row) return j.done('FAIL', 'run not created');
  j.created('payroll run', row.id, runNo + ' ' + J5LBL);
  row = await waitRow('payroll', 'select id, run_no, month, status, created_by, approved_by, last_error, total_gross_minor, total_net_minor from payroll.payroll_runs where id=' + lit(row.id), (x) => !['draft', 'processing', 'computing', 'queued'].includes(x.status), 240000)
    || one('payroll', 'select id, run_no, month, status, last_error from payroll.payroll_runs where id=' + lit(row.id));
  await j.step(null, 'DB', 'run computed', JSON.stringify(row), row.status !== 'failed');
  const rid = row.id;
  await go(u1, '/hr/payroll/' + rid);
  await j.step(u1, '/hr/payroll/[id]', 'maker views run', (await L.bodyText(u1)).replace(/\s+/g, ' ').match(/Payroll Actions[\s\S]{0,200}/)?.[0] || '', true);
  await L.moneyDate(j, u1, '/hr/payroll/[id]');
  if (row.status === 'failed') return j.done('BLOCKED-MASTER-DATA', 'run computed to failed: ' + row.last_error);
  // maker self-approve refused on screen
  const s1 = await runAction(j, u1, rid, 'Approve Run', /approve run/i, 'maker self-approve probe', 'maker self-approve');
  await sleep(5000);
  const st1 = one('payroll', 'select status, approved_by from payroll.payroll_runs where id=' + lit(rid));
  await j.step(null, 'DB', 'maker self-approve refused (run not approved)', JSON.stringify({ st1, ui: s1 }), st1.status !== 'approved');
  // L1 approve
  const u2 = await L.persona('uxtester2');
  await runAction(j, u2, rid, 'Approve Run', /approve run/i, 'L1 approve', 'L1 approve (uxtester2)');
  const a = await waitRow('payroll', 'select status, approved_by from payroll.payroll_runs where id=' + lit(rid), (x) => x.status === 'approved', 60000);
  await j.step(null, 'DB', 'run approved_by = uxtester2', JSON.stringify(a), !!a && a.approved_by === u2.sub);
  if (!a) return j.done('FAIL', 'L1 approve did not apply');
  // L1 cannot disburse
  const s2 = await runAction(j, u2, rid, 'Disburse Run', /disburse now/i, 'L1 disburse probe', 'L1 approver tries to disburse');
  await sleep(5000);
  const st2 = one('payroll', 'select status from payroll.payroll_runs where id=' + lit(rid));
  await j.step(null, 'DB', 'L1 approver cannot disburse', JSON.stringify({ st2, ui: s2 && s2.hint }), st2.status !== 'disbursed');
  // L2 disburse
  const u3 = await L.persona('uxtester3');
  await runAction(j, u3, rid, 'Disburse Run', /disburse now/i, 'L2 disburse', 'L2 disburse (uxtester3)');
  const d = await waitRow('payroll', 'select status, approved_by, updated_by from payroll.payroll_runs where id=' + lit(rid), (x) => x.status === 'disbursed', 60000);
  await j.step(null, 'DB', 'run disbursed', JSON.stringify(d), !!d);
  // payslip view
  // triage 2026-11-09: the run page no longer links to slips (it only offers "Register", and the register page has no slip links either); payslips are reached from
  // /hr/payroll/salary-slips. The old step looked for a[href*="/slips/"] on the run page and then queried a table (payroll.salary_slips) that does not exist. Same intent kept:
  // the payslip of THIS run must open and show net/gross. A slip id of this run is read from the DB (SELECT) and opened at its salary-slips URL; whether the run page links to
  // it is recorded as an INFO step (product navigation gap).
  await go(u3, '/hr/payroll/' + rid);
  const runLinks = await u3.page.locator('a[href*="/slips/"], a[href*="salary-slips/"]').count();
  await j.step(u3, '/hr/payroll/[id]', 'run page links to payslips (INFO)', runLinks ? runLinks + ' slip link(s)' : 'no slip links on the run page (only Register); payslips are reached from /hr/payroll/salary-slips', null);
  const sl = one('payroll', 'select id from payroll.payroll_slips where run_id=' + lit(rid) + ' and basic_minor > 0 order by id limit 1') || one('payroll', 'select id from payroll.payroll_slips where run_id=' + lit(rid) + ' order by id limit 1');
  let slipOk = false;
  if (sl) {
    const href = '/hr/payroll/salary-slips/' + sl.id;
    await go(u3, href);
    const t = await L.bodyText(u3);
    slipOk = /net|gross|earnings|deductions/i.test(t);
    await j.step(u3, '/hr/payroll/salary-slips/[id]', 'open payslip of this run', 'url=' + href + ' net/gross shown=' + slipOk, slipOk);
    await L.moneyDate(j, u3, 'payslip');
  } else {
    await j.step(u3, '/hr/payroll/[id]', 'payslip of this run', 'no slip rows in payroll.payroll_slips for the run', false);
  }
  const ok = !!d && slipOk && st1.status !== 'approved' && st2.status !== 'disbursed';
  j.done(ok ? 'PASS' : 'FAIL');
}
main().catch((e) => { L.log('FATAL', e.stack); const j = L.J[L.J.length - 1]; if (j && !j.verdict) j.done('FAIL', 'driver exception: ' + e.message.split('\n')[0]); }).finally(() => L.closeAll());
