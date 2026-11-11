// J10 Contract draft -> submit -> approve -> activate (screens)
process.env.L2PART = process.env.L2PART || 'j10';
const L = require('./lib');
const { one, sql, lit, waitRow, sleep, go, act, mark, waitMut, TAG, RUN } = L;
const VENDOR = '8c3a147e-3f69-4607-b9b2-21277c50c473';

let tApprove = 0;
async function main() {
  const j = new L.Journey(10, 'contract-lifecycle', 'Contract draft -> submit -> approve -> activate');
  const u1 = await L.persona('uxtester');
  const vend = one('procurement', 'select name from vendor.procurement_vendors where id=' + lit(VENDOR));
  const cno = 'L2-CT-' + RUN;
  const title = TAG + ' contract J10 annual maintenance';
  let c = null;
  if (process.env.J10_CONTRACT) { c = one('contract', 'select id, contract_no, status, value_minor, created_by from contracts.contract_contracts where id=' + lit(process.env.J10_CONTRACT)); j.created('contract', c.id, cno + ' ' + title + ' (screen-created in attempt 1)'); }
  else {
  await go(u1, '/contracts/new');
  const cnt = () => one('contract', 'select count(*)::int n from contracts.contract_contracts where contract_no=' + lit(cno)).n;
  await L.formEmpty(j, u1, '/contracts/new', () => L.clickBtn(u1, 'Create Contract'), cnt);
  await act(async () => {
    await u1.page.getByLabel('Contract No').fill(cno);
    await u1.page.getByLabel('Title').fill(title);
  });
  const vt = await act(() => L.pick(u1, 'input[aria-label="Vendor"]', vend.name.slice(0, 12), null));
  await L.formInvalid(j, u1, '/contracts/new', 'expiry date before start date + negative value', async () => {
    await u1.page.getByLabel('Start Date').fill('2026-12-01');
    await u1.page.getByLabel('Expiry Date').fill('2026-06-30');
    await u1.page.getByLabel('Value (₹)').fill('-100000');
  }, () => L.clickBtn(u1, 'Create Contract'), cnt, /expiry|after|before|date|value|amount|positive/i);
  await act(async () => {
    await u1.page.getByLabel('Expiry Date').fill('2027-11-30');
    await u1.page.getByLabel('Value (₹)').fill('100000');
  });
  const m = mark(u1);
  await act(() => L.clickBtn(u1, 'Create Contract'));
  await sleep(1500);
  if (await L.dlg(u1).count()) { const b = L.dlg(u1).getByRole('button', { name: /create|confirm|submit|yes/i }); if (await b.count()) await act(() => b.last().click()); }
  const mu = await waitMut(u1, m, /contract\/contracts/, 20000);
  c = await waitRow('contract', 'select id, contract_no, status, value_minor, created_by from contracts.contract_contracts where contract_no=' + lit(cno), null, 60000);
  const ui = await L.visibleErrors(u1);
  await j.step(u1, '/contracts/new', 'create contract (vendor ' + vt + ', ₹1,00,000)', 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.s >= 400 ? x.body : ''))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 3)) + ' url=' + u1.page.url().replace(L.BASE, '') + ' db=' + JSON.stringify(c), !!c);
  if (!c) return j.done('FAIL', 'contract not created');
  j.created('contract', c.id, cno + ' ' + title);
  }
  // detail: available actions
  await go(u1, '/contracts/' + c.id);
  const f = await L.dumpForm(u1);
  const acts = f.buttons.filter((b) => /submit|approve|activate|raise|close|terminate/i.test(b));
  await j.step(u1, '/contracts/[id]', 'contract detail actions (status ' + c.status + ')', JSON.stringify(acts), true);
  await L.moneyDate(j, u1, '/contracts/[id]');
  let file = null;
  if (process.env.J10_CONTRACT) {
    file = one('estab', "select id, file_no, status, current_with, created_by from files.estab_files where source_ref_id=" + lit(c.id) + " order by created_at desc limit 1");
    j.created('estab eOffice file', file.id, file.file_no + ' contract award note (raised on screen in attempt 1)');
    await j.step(null, 'note', 'driver restart: attempt 1 raised the eOffice file on screen; the file page offers only "Sign note (green)", so the decision is taken from Establishment > Approvals', JSON.stringify({ contract: c, file }), true);
  } else {
  // submit = Raise for approval (eOffice note)
  const raise = u1.page.getByRole('button', { name: 'Raise for approval' });
  if (!(await raise.count())) { await j.step(u1, '/contracts/[id]', 'Raise for approval', 'button not present', false); return j.done('FAIL', 'no submit action'); }
  await act(() => raise.first().click());
  await sleep(1000);
  let fwd = null;
  try { fwd = await act(() => L.pick(u1, 'input[placeholder^="Search by name or employee"]', 'UX Tester Two', /Two|UXT-0002/)); } catch (e) { try { fwd = await act(() => L.pick(u1, 'input[placeholder^="Search by name or employee"]', 'UXT-0002', null)); } catch (e2) { fwd = 'picker failed: ' + e2.message.slice(0, 120); } }
  await act(() => u1.page.locator('textarea[placeholder^="Justification"]').fill(TAG + ' contract award note for approval'));
  await j.step(u1, '/contracts/[id]', 'fill eOffice raise form (forward to ' + fwd + ')', 'ok', true);
  let m2 = mark(u1);
  await act(() => L.clickBtn(u1, 'Submit to eOffice'));
  const mu2 = await waitMut(u1, m2, /estab|eoffice|submit-approval|files/, 25000);
  await sleep(8000);
  const ui2 = await L.visibleErrors(u1);
  const c2 = await waitRow('contract', 'select id, status, updated_by from contracts.contract_contracts where id=' + lit(c.id), (x) => x.status === 'pending_approval', 60000);
  file = one('estab', "select id, file_no, status, current_with, created_by from files.estab_files where source_ref_id=" + lit(c.id) + " order by created_at desc limit 1") || null;
  await j.step(u1, '/contracts/[id]', 'Submit to eOffice (submit for approval)', 'http=' + JSON.stringify(mu2.map((x) => x.m + ' ' + x.u.slice(0, 80) + ' ' + x.s + ' ' + (x.s >= 400 ? (x.body || '').slice(0, 160) : ''))) + ' ui=' + JSON.stringify(ui2.msgs.slice(0, 3)) + ' contract=' + JSON.stringify(c2) + ' file=' + JSON.stringify(file), !!c2);
  if (file) j.created('estab eOffice file', file.id, (file.file_no || '') + ' contract award note');
  }
  // b14: maker is not offered Approve; checker approves on the contract screen (ContractLifecycleActions)
  await go(u1, '/contracts/' + c.id);
  const mt = await L.bodyText(u1);
  const makerApprove = await u1.page.getByRole('button', { name: /approve contract/i }).count();
  await j.step(u1, '/contracts/[id]', 'maker: no Approve contract on own contract', 'approveButtons=' + makerApprove + ' makerNote=' + /a different officer must approve/.test(mt), makerApprove === 0);
  const u2 = await L.persona('uxtester2');
  await go(u2, '/contracts/' + c.id);
  const ab = u2.page.getByRole('button', { name: /approve contract/i });
  await j.step(u2, '/contracts/[id]', 'checker sees Approve contract (status ' + one('contract', 'select status from contracts.contract_contracts where id=' + lit(c.id)).status + ')', 'buttons=' + JSON.stringify((await L.dumpForm(u2)).buttons.filter((x) => /approve|activate|terminate|close/i.test(x))), (await ab.count()) > 0);
  let approvedOk = false;
  if (await ab.count()) {
    const m3 = mark(u2);
    await act(() => ab.first().click());
    await sleep(1200);
    const d = L.dlg(u2);
    const ta = d.locator('textarea'); if (await ta.count()) await ta.first().fill(TAG + ' contract approved by checker');
    await act(() => d.getByRole('button', { name: /yes, approve/i }).last().click({ timeout: 15000 }));
    const mu3 = await waitMut(u2, m3, /contract/, 20000);
    tApprove = Date.now();
    await sleep(4000);
    await j.step(u2, '/contracts/[id]', 'checker approves contract', 'http=' + JSON.stringify(mu3.map((x) => x.m + ' ' + x.u.slice(0, 90) + ' ' + x.s + ' ' + (x.s >= 400 ? (x.body || '').slice(0, 200) : ''))) + ' ui=' + JSON.stringify((await L.visibleErrors(u2)).msgs.slice(0, 3)), mu3.some((x) => x.s < 300));
    const c3 = await waitRow('contract', 'select id, status, updated_by from contracts.contract_contracts where id=' + lit(c.id), (x) => x.status === 'approved', 60000);
    approvedOk = !!c3;
    await j.step(null, 'DB', 'contract approved (approver = uxtester2)', JSON.stringify({ contract: c3 || one('contract', 'select status, updated_by from contracts.contract_contracts where id=' + lit(c.id)), file: file ? one('estab', 'select status, current_with from files.estab_files where id=' + lit(file.id)) : null }), approvedOk);
  }
  // activate
  // triage 2026-11-09: the contract page is served from a 30 s data cache (apps/web/src/app/_data/loaders.ts getContractById revalidateSeconds: 30), so the maker can still
  // see "Pending Approval" (and no Activate button) right after the checker approved. Reload until the Activate action shows (max 45 s), record the delay as evidence and
  // as a WARN step when > 5 s, then assert exactly as before (the Activate button must exist and the contract must end active).
  const rs = await L.reloadUntil(u1, '/contracts/' + c.id, async (p) => (await p.page.getByRole('button', { name: /activate contract/i }).count()) > 0, { sinceTs: tApprove || Date.now(), maxMs: 45000 });
  await L.warnStale(j, u1, '/contracts/[id]', 'contract approved -> Activate action', rs);
  const f2 = await L.dumpForm(u1);
  const actB = u1.page.getByRole('button', { name: /activate contract/i });
  const nAct = await actB.count();
  await j.step(u1, '/contracts/[id]', 'look for Activate action (status ' + one('contract', 'select status from contracts.contract_contracts where id=' + lit(c.id)).status + '; visible after ' + rs.secs + ' s, ' + rs.tries + ' load(s))', 'buttons=' + JSON.stringify(f2.buttons.filter((b) => /activ|approve|close|terminat|submit/i.test(b))) + ' stale_view_secs=' + rs.secs, nAct > 0);
  if (!nAct) j.defect('blocker', '/contracts/[id]', 'Contract detail (draft / pending_approval / approved)', 'Approve and Activate actions on the contract (POST /contracts/:id/approve, /activate exist)', 'The contract screen offers only "Raise for approval" (eOffice note), milestone and bond actions. No Approve, Activate, Close or Terminate button anywhere in the web app; the web app never calls /approve or /activate. An approved contract cannot be activated on screen.');
  else {
    const m4 = mark(u1);
    await act(() => actB.first().click());
    await sleep(1000);
    if (await L.dlg(u1).count()) await act(() => L.dlg(u1).getByRole('button', { name: /yes, activate/i }).last().click());
    await waitMut(u1, m4, /activate/, 20000);
  }
  const fin = await waitRow('contract', 'select id, status, updated_by from contracts.contract_contracts where id=' + lit(c.id), (x) => x.status === 'active', nAct ? 60000 : 2000);
  j.done(fin ? 'PASS' : 'FAIL', fin ? '' : 'contract ends ' + one('contract', 'select status from contracts.contract_contracts where id=' + lit(c.id)).status + '; activation has no screen');
}
main().catch((e) => { L.log('FATAL', e.stack); const j = L.J[L.J.length - 1]; if (j && !j.verdict) j.done('FAIL', 'driver exception: ' + e.message.split('\n')[0]); }).finally(() => L.closeAll());
