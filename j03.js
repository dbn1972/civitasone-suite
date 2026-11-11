// J3 Leave apply (uxtester) -> manager uxtester2 approves; maker self-approve refused on screen
process.env.L2PART = process.env.L2PART || 'j03';
const L = require('./lib');
const { one, lit, waitRow, sleep, go, act, mark, waitMut, TAG } = L;
// retest-20261105: realistic non-admin pair seeded 2026-11-04 (testdata-20261104.md): employee UAT-EMP-01 applies, its direct manager UAT-MGR-01 approves
const E1 = process.env.J3_EMP_ID || '93bce026-57c1-451c-a6a2-6a419f0d38ae';
const EMP = process.env.J3_EMP || 'uat-emp-01', MGR = process.env.J3_MGR || 'uat-mgr-01';

async function selectLeaveType(p) {
  for (let i = 0; i < 20; i++) {
    const opts = await p.page.locator('#leave-type option').allInnerTexts().catch(() => []);
    // b14: Casual Leave balance is exhausted by earlier UAT runs (0 days); use a type that still has balance (Casual first if any)
    const bal = (o) => { const m = o.match(/\(([0-9.]+) days? balance/); return m ? parseFloat(m[1]) : 0; };
    const c = opts.find((o) => /casual/i.test(o) && bal(o) >= 1) || opts.find((o) => bal(o) >= 2);
    if (c) { await p.page.selectOption('#leave-type', { label: c }); return c; }
    await sleep(1000);
  }
  return null;
}
async function apply(j, p, dt, label, checks) {
  await go(p, '/hr/leave/apply');
  const cnt = () => one('hrms', 'select count(*)::int n from leave.hrms_leave_apps where employee_id=' + lit(E1)).n;
  if (checks) {
    await L.formEmpty(j, p, '/hr/leave/apply', () => L.clickBtn(p, 'Submit Leave Request'), cnt);
  }
  if (await p.page.getByRole('button', { name: 'Apply for myself' }).count()) await act(() => L.clickBtn(p, 'Apply for myself')); // form may now be shown directly (no mode switch) for non-manager users
  await sleep(2500);
  const lt = await selectLeaveType(p);
  if (!lt) { await j.step(p, '/hr/leave/apply', 'select leave type', 'no Casual Leave option after "Apply for myself"', false); return null; }
  if (checks) {
    await L.formInvalid(j, p, '/hr/leave/apply', 'To date before From date', async () => {
      await p.page.fill('#leave-from', '2027-02-10');
      await p.page.fill('#leave-to', '2027-02-08');
      await p.page.fill('#leave-reason', TAG + ' leave invalid-dates check');
    }, () => L.clickBtn(p, 'Submit Leave Request'), cnt, /date|before|after|range/i);
    await go(p, '/hr/leave/apply');
    if (await p.page.getByRole('button', { name: 'Apply for myself' }).count()) await act(() => L.clickBtn(p, 'Apply for myself')); // form may now be shown directly (no mode switch) for non-manager users
    await sleep(2500);
    await selectLeaveType(p);
  }
  const reason = TAG + ' leave ' + label + ' (UAT screen L2 test)';
  await act(async () => {
    await p.page.fill('#leave-from', dt);
    await p.page.fill('#leave-to', dt);
    await p.page.fill('#leave-reason', reason);
    await p.page.locator('#leave-reason').blur();
  });
  await sleep(3500);
  const pv = (await L.bodyText(p)).match(/(balance[^.\n]{0,80}|[0-9.]+ day[^.\n]{0,60})/gi) || [];
  await j.step(p, '/hr/leave/apply', 'fill leave ' + label + ' (' + lt + ', ' + dt + ')', 'preview: ' + JSON.stringify(pv.slice(0, 4)), true);
  const m = mark(p);
  await act(() => L.clickBtn(p, 'Submit Leave Request'));
  await sleep(1500);
  const dlg = L.dlg(p);
  if (await dlg.count()) { const b = dlg.getByRole('button', { name: /submit|confirm|apply|yes/i }); if (await b.count()) await act(() => b.last().click()); }
  const mu = await waitMut(p, m, /leave-requests(?!\/preview)|leave-applications/, 20000);
  // triage 2026-11-09: the apply is async (202 -> queue -> hrms worker). Poll the DB for the row for ~20 s; if it never appears the toast was a false positive,
  // so look the message up in the hrms worker error log and FAIL with the worker's reason (e.g. the unique violation that dead-letters it) instead of passing on the toast.
  const row = await waitRow('hrms', 'select id, status, from_date::text, created_by from leave.hrms_leave_apps where reason=' + lit(reason), null, 20000);
  const ui = await L.visibleErrors(p);
  let workerReason = '';
  if (!row) {
    let msgId = ''; try { msgId = (JSON.parse((mu.find((x) => x.s < 300) || {}).body || '{}')).id || ''; } catch (e) {}
    await sleep(3000);
    try { const fs = require('fs'); const f = '/var/log/civitasone/hrms-worker-error.log'; const sz = fs.statSync(f).size; const fd = fs.openSync(f, 'r'); const len = Math.min(sz, 3000000); const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, sz - len); fs.closeSync(fd);
      const hit = buf.toString('utf8').split('\n').filter((l) => msgId && l.includes(msgId) && l.includes('"err"')).pop();
      if (hit) { try { workerReason = JSON.parse(hit).err.split('\n')[0]; } catch (e) { workerReason = hit.slice(0, 200); } } } catch (e) {}
    workerReason = 'ASYNC APPLY FAILED (no row after 20 s; message ' + (msgId || '?') + ' worker reason: ' + (workerReason || 'not found in hrms-worker-error.log') + ')';
  }
  await j.step(p, '/hr/leave/apply', 'submit leave ' + label, 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.s >= 400 ? x.body : ''))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 3)) + ' db=' + JSON.stringify(row) + (workerReason ? ' ' + workerReason : ''), !!row);
  if (row) j.created('hrms leave application', row.id, reason);
  return row;
}
let USED = null;  // dates already covered by pending/approved leave of the employee: the apply form refuses overlaps, so pick a free working day
// triage 2026-11-09: also counts every row's from_date and to_date explicitly and tolerates inverted ranges (from > to), and uses the same status filter as the
// unique index ux_leave_apps_active (only rejected/cancelled rows free a date). The old version skipped an inverted row (from 2027-02-10 -> to 2027-02-08), the
// date looked free, and the async apply then dead-lettered on ux_leave_apps_active. Also fixed: the old query aliased its columns f/t, and lib.sql() wraps the query as
// `from (...) t`, so column t shadowed the row alias and every row came back as a bare string -> usedDates() silently returned an empty set (the date pick was pure luck).
function usedDates() { if (!USED) { USED = new Set(); try { for (const r of L.sql('hrms', "select from_date::text fd, to_date::text td from leave.hrms_leave_apps where employee_id=" + lit(E1) + " and status not in ('rejected','cancelled')")) { USED.add(r.fd); USED.add(r.td); const lo = r.fd < r.td ? r.fd : r.td, hi = r.fd < r.td ? r.td : r.fd; for (let d = new Date(lo + 'T00:00:00Z'); d <= new Date(hi + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) USED.add(d.toISOString().slice(0, 10)); } } catch (e) {} } return USED; }
function pickDate(off) { const u = usedDates(); const d = new Date(Date.UTC(2027, 0, 4 + off)); for (let g = 0; g < 200; g++) { if (![0, 6].includes(d.getUTCDay()) && !u.has(d.toISOString().slice(0, 10))) break; d.setUTCDate(d.getUTCDate() + 1); } const r = d.toISOString().slice(0, 10); u.add(r); return r; }

// Bundle 20: /hr/leave/approvals redirects to the unified inbox /approvals?module=leave. Inbox rows carry no unique text, so the leave is
// found by scanning the newest rows and matching its from-date in the decision panel (see inbox.js openLeave). Same intent as the old queue row.
async function decide(j, p, lid, reasonFrag, verb, label) {
  const IB = require('./inbox');
  const isSelf = /self-approve/.test(label);
  const fd = one('hrms', 'select from_date::text d from leave.hrms_leave_apps where id=' + lit(lid)).d;
  const rowTxt = await IB.openLeave(p, fd);
  const n = rowTxt ? 1 : 0;
  // for the maker's own leave the new inbox may simply not list it (refusal by omission): that is recorded as info, not as a failed locate
  await j.step(p, '/approvals?module=leave', label + ': locate leave item (unified inbox)', n ? rowTxt.slice(0, 220) : 'item not listed for ' + p.user, isSelf && !n ? null : n > 0);
  if (!n) return isSelf ? { refusedUi: true, ui: { msgs: ['item not offered to its own maker'] }, mu: [] } : null;
  const dec = await IB.decide(p, verb.toLowerCase(), TAG + ' ' + label + ' decision note');
  if (dec.disabled) { await j.step(p, '/approvals?module=leave', label + ': ' + verb + ' button', 'button disabled/absent; panel says: ' + (dec.sod || 'n/a'), null); return { refusedUi: true, ui: { msgs: dec.sod ? [dec.sod] : [] }, mu: [] }; }
  await j.step(p, '/approvals?module=leave', label + ': confirm step', (dec.dlgText || '').slice(0, 200), true, { shot: true });
  const mu = dec.mu;
  const ui = await L.visibleErrors(p);
  const toast = (await L.bodyText(p)).match(/(cannot|can't|not allowed|own|refused|denied|approved|rejected)[^\n]{0,120}/gi) || [];
  await j.step(p, '/approvals?module=leave', label + ': ' + verb, 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.s >= 400 ? (x.body || '').slice(0, 200) : ''))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 4)) + ' text=' + JSON.stringify(toast.slice(0, 3)), null);
  return { mu, ui, toast };
}

async function main() {
  const j = new L.Journey(3, 'hrms-leave', 'Leave apply (' + EMP + ') -> manager ' + MGR + ' approves; maker self-approve refused on screen');
  const al = one('hrms', "select a.balance_days from leave.hrms_leave_allocs a join leave.hrms_leave_types t on t.id=a.leave_type_id where a.employee_id=" + lit(E1) + " and a.fy='2026-27' and t.name ilike 'casual%'");
  await j.step(null, 'DB', EMP + ' Casual Leave balance before', JSON.stringify(al), true);
  const u1 = await L.persona(EMP);
  const u2 = await L.persona(MGR);
  const off = Math.floor(Math.random() * 50);
  const A = await apply(j, u1, pickDate(off), 'A-manager-approve', true);
  const B = await apply(j, u1, pickDate(off + 3), 'B-self-approve-probe', false);
  if (!A) return j.done('FAIL', 'leave could not be applied on screen (see the submit step for the hrms worker reason)');
  for (const r of [A, B].filter(Boolean)) {
    const t = await L.waitRow('workflow', "select t.id, t.status, t.role_ref from workflow.tasks t join workflow.instances i on i.id=t.instance_id where i.ref_id=" + lit(r.id) + " and t.status='pending'", null, 60000);
    const st = one('hrms', 'select status from leave.hrms_leave_apps where id=' + lit(r.id));
    await j.step(null, 'DB', 'leave ' + r.id.slice(0, 8) + ' routed to approval task', JSON.stringify({ task: t, leave: st, inst: L.wfInstances(r.id) }), !!t && st.status !== 'routing_failed');
  }
  // maker self-approve attempt on screen (leave B)
  let selfOk = null;
  if (B) {
    const res = await decide(j, u1, B.id, 'B-self-approve-probe', 'Approve', 'maker self-approve (leave B)');
    // the old queue let the maker click Approve and show the server refusal; the new inbox may block it in the panel. Also attempt it directly (API) so the server-side refusal stays asserted.
    const tk0 = L.wfTasks(B.id).find((x) => x.status === 'pending');
    if (tk0) { const ar = await L.apiProxy(u1, 'POST', '/v1/workflow/tasks/' + tk0.id + '/complete', { decision: 'approve' }); await j.step(null, 'API', 'maker self-approve attempt on the workflow task', ar.status + ' ' + ar.text.slice(0, 160), ar.status === 403); if (res && res.mu && !res.mu.length) res.mu = [{ s: ar.status }]; }
    await sleep(15000);
    const st = one('hrms', 'select status, updated_by from leave.hrms_leave_apps where id=' + lit(B.id));
    const tk = L.wfTasks(B.id);
    selfOk = st.status !== 'approved' && tk.some((x) => x.status === 'pending');
    const http = res && res.mu ? res.mu.map((x) => x.s) : [];
    await j.step(u1, '/hr/leave/approvals', 'maker self-approve refused (leave not approved, task still open, refusal visible)', JSON.stringify({ leave: st, tasks: tk, http, uiMsgs: res && res.ui ? res.ui.msgs.slice(0, 3) : null, refusedUi: res && res.refusedUi }), selfOk);
    if (!selfOk) j.defect(st.status === 'approved' ? 'blocker' : 'major', '/hr/leave/approvals', 'uxtester applies leave for himself > Leave Approvals > Approve own leave > confirm', 'Self-approval refused with a readable message; leave stays pending with its approval task open', 'leave=' + JSON.stringify(st) + ' tasks=' + JSON.stringify(tk.map((x) => [x.status, x.decision, x.sod_override])) + ' http=' + JSON.stringify(http));
  }
  // manager approves leave A
  await decide(j, u2, A.id, 'A-manager-approve', 'Approve', 'manager approves leave A');
  const ap = await waitRow('hrms', 'select id, status, updated_by from leave.hrms_leave_apps where id=' + lit(A.id), (x) => ['approved', 'routing_failed', 'rejected'].includes(x.status), 60000);
  const tasks = L.wfTasks(A.id), inst = L.wfInstances(A.id);
  const ok = !!ap && ap.status === 'approved' && tasks.every((t) => t.status === 'completed') && inst.every((i) => i.status === 'completed');
  await j.step(null, 'DB', 'leave A approved by manager; task + instance closed', JSON.stringify({ leave: ap || one('hrms', 'select status, updated_by from leave.hrms_leave_apps where id=' + lit(A.id)), checker: u2.sub, tasks, inst }), ok);
  // employee sees status
  await go(u1, '/hr/leave/history');
  const ht = await L.bodyText(u1);
  await j.step(u1, '/hr/leave/history', 'maker sees leave A status', (ht.match(/Approved/g) || []).length + ' "Approved" labels', /approved/i.test(ht));
  await L.moneyDate(j, u1, '/hr/leave/history');
  // cleanup decision on B if still pending: manager rejects
  if (B) {
    const st = one('hrms', 'select status from leave.hrms_leave_apps where id=' + lit(B.id));
    if (st.status === 'pending' || st.status === 'submitted' || st.status === 'pending_approval') await decide(j, u2, B.id, 'B-self-approve-probe', 'Reject', 'cleanup: manager rejects leave B');
    await sleep(8000);
    await j.step(null, 'DB', 'leave B final', JSON.stringify({ leave: one('hrms', 'select status, updated_by from leave.hrms_leave_apps where id=' + lit(B.id)), tasks: L.wfTasks(B.id) }), null);
  }
  j.done(ok && selfOk !== false ? 'PASS' : 'FAIL');
}
main().catch((e) => { L.log('FATAL', e.stack); const j = L.J[L.J.length - 1]; if (j && !j.verdict) j.done('FAIL', 'driver exception: ' + e.message.split('\n')[0]); }).finally(() => L.closeAll());
