// J14 Meeting schedule -> attendance
process.env.L2PART = process.env.L2PART || 'j14';
const L = require('./lib');
const { one, sql, lit, waitRow, sleep, go, act, mark, waitMut, TAG, TENANT } = L;

let CHAIR = null;
async function pickPerson(p, sel, q, re) {
  // the UAT personas are not in the identity user directory (q=ux / uxtester / 'UX Tester' -> {"data":[]}); use UATTEST directory users
  try {
    if (q === 'UX Tester One') { CHAIR = await L.pick(p, sel, 'UATTEST', null); return CHAIR; }
    const c = CHAIR; return await L.pick(p, sel, 'UATTEST', { test: (t) => !c || t !== c });
  } catch (e) { return 'PICK FAILED: ' + e.message.slice(0, 140); }
}
async function main() {
  const j = new L.Journey(14, 'meeting-attendance', 'Meeting schedule -> attendance');
  const u1 = await L.persona('uxtester');
  await go(u1, '/meeting/meetings/new');
  const f0 = await L.dumpForm(u1);
  await j.step(u1, '/meeting/meetings/new', 'open Schedule a meeting', 'fields=' + f0.fields.filter((f) => f.id.startsWith('nm-')).map((f) => f.id + (f.req ? '*' : '') + ':' + f.type).join(','), true);
  const title = TAG + ' review meeting J14';
  const cnt = () => one('meeting', 'select count(*)::int n from meeting.meetings where title=' + lit(title)).n;
  const submit = () => u1.page.locator('form button[type=submit]').last().click({ timeout: 10000 });
  await L.formEmpty(j, u1, '/meeting/meetings/new', submit, cnt);
  await act(() => u1.page.fill('#nm-title', title));
  await j.step(u1, '/meeting/meetings/new', 'Chairperson picker: search the UAT personas', 'GET /v1/identity/users/directory?q=ux | uxtester | UX Tester -> {"data":[]} ("No matching users"); the personas cannot be chosen as chair/secretary. Using UATTEST directory users instead.', null, { shot: false });
  const chair = await act(() => pickPerson(u1, '#nm-chair', 'UX Tester One', /One/));
  const sec1 = await act(() => pickPerson(u1, '#nm-secretary', 'UX Tester One', /One/));
  await L.formInvalid(j, u1, '/meeting/meetings/new', 'duration 0 minutes + secretary same as chairperson', async () => {
    await u1.page.fill('#nm-when', '2026-12-15T11:00');
    await u1.page.fill('#nm-duration', '0');
  }, submit, cnt, /duration|minutes|secretary|different|chair/i);
  const sec = await act(() => pickPerson(u1, '#nm-secretary', 'UX Tester Two', /Two/));
  await act(async () => { await u1.page.fill('#nm-duration', '60'); await u1.page.fill('#nm-venue', TAG + ' Conference Room 2'); });
  // triage 2026-11-09: quorum is committee-defined (maybeEstablishQuorum is a no-op without a committee, so a meeting with no committee can never reach in_progress:
  // MEETING_QUORUM_NOT_MET). Pick a committee with 4 active members (rule minMembers 1) in the optional Committee field, like a real convener would. (The picker only lists the first 7 committees, so the real Finance Committee, minMembers 2, is not selectable: product wart.)
  const cv = await u1.page.locator('#nm-committee option', { hasText: /^UATTEST-g6-mee-com-117131-upd/ }).first().getAttribute('value').catch(() => null);
  if (cv) await act(() => u1.page.selectOption('#nm-committee', cv));
  await j.step(u1, '/meeting/meetings/new', 'pick committee (UATTEST-g6-mee-com-117131-upd, quorum minMembers 1)', cv ? 'selected ' + cv : 'committee not offered in the list', !!cv);
  await j.step(u1, '/meeting/meetings/new', 'fill meeting (chair ' + chair + ', secretary ' + sec + ', 15-12-2026 11:00, 60 min)', 'chair-as-secretary pick for the invalid case: ' + sec1, true);
  const m = mark(u1);
  await act(submit);
  const mu = await waitMut(u1, m, /v1\/meeting/, 20000);
  await sleep(4000);
  const ui = await L.visibleErrors(u1);
  const mt = await waitRow('meeting', 'select id, status, scheduled_at, chairperson_id, secretary_id, created_by, meeting_number from meeting.meetings where title=' + lit(title), null, 60000);
  await j.step(u1, '/meeting/meetings/new', 'schedule meeting', 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u + ' ' + x.s + ' ' + (x.s >= 400 ? x.body : ''))) + ' ui=' + JSON.stringify(ui.msgs.slice(0, 3)) + ' url=' + u1.page.url().replace(L.BASE, '') + ' db=' + JSON.stringify(mt), !!mt);
  if (!mt) return j.done('FAIL', 'meeting not created');
  j.created('meeting', mt.id, title);
  await go(u1, '/meeting/meetings/' + mt.id);
  let t = await L.bodyText(u1);
  const f = await L.dumpForm(u1);
  const trans = f.buttons.filter((b) => /start|schedule|publish|convene|lock|adjourn|invite|participant|check in/i.test(b));
  const parts = sql('meeting', 'select employee_id, role, invitation_status from meeting.participants where meeting_id=' + lit(mt.id));
  await j.step(u1, '/meeting/meetings/[id]', 'meeting console (status ' + mt.status + ')', 'actions=' + JSON.stringify(trans) + ' attendance: ' + ((t.match(/Attendance & quorum[\s\S]{0,200}/) || [''])[0]).replace(/\s+/g, ' ') + ' | participants in DB=' + JSON.stringify(parts), true);
  await L.moneyDate(j, u1, '/meeting/meetings/[id]');
  // b14: lifecycle on the console: add agenda -> Schedule -> Lock agenda -> check in -> Start meeting
  const status = () => one('meeting', 'select status from meeting.meetings where id=' + lit(mt.id)).status;
  let lastAct = Date.now();  // time of the last mutation, for the stale-view evidence
  async function transition(label, toState) {
    // triage 2026-11-09: the console reads agenda/meeting data through a 15 s cache (meeting/_data/loaders.ts getAgenda revalidateSeconds: 15; router.refresh() does not bypass it),
    // so right after "Add agenda item" the Schedule button can stay disabled ("Add at least one agenda item") for up to ~30 s. Reload until the button is present AND enabled
    // (max 45 s), record the delay as evidence / a WARN step when > 5 s, then click as before. If it is still disabled after 45 s the step FAILs with the blockers (no 30 s click timeout).
    const re = new RegExp('^' + label + '$', 'i');
    const rs = await L.reloadUntil(u1, '/meeting/meetings/' + mt.id, async (pp) => { const bb = pp.page.getByRole('button', { name: re }); return (await bb.count()) > 0 && !(await bb.first().isDisabled()); }, { sinceTs: lastAct, maxMs: 45000 });
    await L.warnStale(j, u1, '/meeting/meetings/[id]', label + ' enabled', rs);
    const b = u1.page.getByRole('button', { name: re });
    const n = await b.count();
    if (n && (await b.first().isDisabled())) { await j.step(u1, '/meeting/meetings/[id]', label, 'button still disabled after ' + rs.secs + ' s (' + rs.tries + ' reloads); blockers=' + JSON.stringify(((await L.bodyText(u1)).match(/(Assign a chairperson|Add at least one agenda|Set a meeting date)[^\n]*/g) || [])), false); return false; }
    if (!n) { await j.step(u1, '/meeting/meetings/[id]', label, 'not offered (status ' + status() + ') blockers=' + JSON.stringify(((await L.bodyText(u1)).match(/(Assign a chairperson|Add at least one agenda|Set a meeting date)[^\n]*/g) || [])), false); return false; }
    const mm = mark(u1);
    await act(() => b.first().click());
    await sleep(1000);
    const d = L.dlg(u1);
    if (await d.count()) { const ta = d.locator('textarea'); if (await ta.count()) await ta.first().fill(TAG + ' ' + label); await act(() => d.getByRole('button').filter({ hasText: new RegExp(label.split(' ')[0] + '|confirm|yes', 'i') }).last().click({ timeout: 15000 })); }
    const mu = await waitMut(u1, mm, /transition|meeting/, 20000);
    const row = await waitRow('meeting', 'select status from meeting.meetings where id=' + lit(mt.id), (x) => x.status === toState, 45000);
    await j.step(u1, '/meeting/meetings/[id]', label, 'http=' + JSON.stringify(mu.map((x) => x.m + ' ' + x.u.slice(0, 80) + ' ' + x.s + ' ' + (x.s >= 400 ? (x.body || '').slice(0, 200) : ''))) + ' ui=' + JSON.stringify((await L.visibleErrors(u1)).msgs.slice(0, 3)) + ' status=' + (row ? row.status : status()), !!row);
    if (row) lastAct = Date.now();
    return !!row;
  }
  // add agenda item (required to schedule)
  const at = u1.page.locator('#mtg-agenda-title');
  if (await at.count()) {
    const ma = mark(u1);
    await act(() => at.fill(TAG + ' agenda: review of works'));
    await act(() => L.clickBtn(u1, 'Add agenda item'));
    const mua = await waitMut(u1, ma, /agenda/, 20000);
    const ag = await waitRow('meeting', 'select count(*)::int n from meeting.agenda_items where meeting_id=' + lit(mt.id), (x) => x.n > 0, 45000).catch(() => null);
    lastAct = Date.now();
    await j.step(u1, '/meeting/meetings/[id]', 'add agenda item', JSON.stringify(mua.map((x) => x.m + ' ' + x.u.slice(0, 80) + ' ' + x.s + (x.s >= 400 ? ' ' + (x.body || '').slice(0, 160) : ''))) + ' db=' + JSON.stringify(ag), mua.some((x) => x.s < 300));
  } else await j.step(u1, '/meeting/meetings/[id]', 'add agenda item', 'no agenda form on console', false);
  let ok = await transition('Schedule meeting', 'scheduled');
  if (ok) ok = await transition('Lock agenda', 'agenda_locked');
  // triage 2026-11-09: SETUP via the API. The console has an Attendance panel ("Invited participants ... will appear here") but no screen to invite anyone, and creating a meeting
  // with a committee does not add its members, so "No participants recorded" and "Check in" never appears. The convener's invite step therefore cannot be done on screen: it is
  // recorded as a DEFECT (major) and done through the web app's own authenticated API proxy (POST /v1/meeting/:id/participants), noted as setup evidence, so the check-in /
  // quorum / start steps below can still be asserted on screen exactly as before.
  const prr = await u1.ctx.request.fetch(L.BASE + '/api/proxy/v1/meeting/' + mt.id + '/participants', { method: 'POST', data: { participants: [{ employeeId: mt.chairperson_id, role: 'chairperson', isMandatory: true }, { employeeId: mt.secretary_id, role: 'secretary', isMandatory: true }] }, headers: { 'content-type': 'application/json', 'x-idempotency-key': require('crypto').randomUUID() }, failOnStatusCode: false });
  const pr = { status: prr.status(), text: (await prr.text().catch(() => '')).slice(0, 300) };
  await sleep(6000); lastAct = Date.now() - 6000;
  const pdb = sql('meeting', 'select employee_id, role, invitation_status from meeting.participants where meeting_id=' + lit(mt.id));
  await j.step(u1, '/meeting/meetings/[id]', 'SETUP via API (no invite screen): add chairperson + secretary as participants', 'POST participants -> ' + pr.status + ' ' + pr.text.slice(0, 120) + ' db=' + JSON.stringify(pdb), null);
  j.defect('major', '/meeting/meetings/[id]', 'Convener opens the meeting console and looks for a way to invite participants', 'An "Invite / add participants" action on the console (the attendance panel says invited participants will appear there; POST /v1/meetings/:id/participants exists)', 'No participant can be added on screen and a committee does not seed its members, so the roster stays empty, nobody can check in and the meeting can never reach quorum / start');
  // attendance
  // triage 2026-11-09: quorum for the committee in use, so check in up to two participants; the committee in use needs minMembers 1, so the second check-in is optional (INFO) but is tried.
  let att = []; let screenCheckInFailed = false;
  for (let k = 0; k < 2; k++) {
    // reload until a "Check in" button is offered (the attendance roster is also served from cache; delay recorded as evidence / WARN > 5 s)
    const rci = await L.reloadUntil(u1, '/meeting/meetings/' + mt.id, async (pp) => (await pp.page.getByRole('button', { name: /^check in$/i }).count()) > 0, { sinceTs: lastAct, maxMs: k === 0 ? 60000 : 15000 });
    await L.warnStale(j, u1, '/meeting/meetings/[id]', 'participants added -> Check in offered', rci);
    const ci = u1.page.getByRole('button', { name: /^check in$/i });
    if (await ci.count()) {
      const m3 = mark(u1);
      await act(() => ci.first().click());
      const mu3 = await waitMut(u1, m3, /attendance/, 20000);
      await sleep(4000);
      att = sql('meeting', 'select participant_id, status, check_in_at from meeting.attendance_records where meeting_id=' + lit(mt.id));
      await j.step(u1, '/meeting/meetings/[id]', 'check in participant ' + (k + 1), JSON.stringify(mu3.map((x) => x.s + ' ' + (x.s >= 400 ? (x.body || '').slice(0, 160) : ''))) + ' db=' + JSON.stringify(att), att.length > k);
      lastAct = Date.now();
      if (att.length <= k) {
        // PRODUCT DEFECT: the console's Check in sends { participantId, mode? } (meeting/_data/client.ts attendanceCheckIn) but POST .../attendance/check-in requires `method`
        // (meeting-service attendance/validators.ts attendanceCheckInSchema), so every on-screen check-in is a 400 and nobody can ever check in or reach quorum. The journey
        // stays FAIL. To still exercise quorum + Start meeting, the check-in is repeated through the API as setup (method manual); that is evidence only, never a pass.
        j.defect('blocker', '/meeting/meetings/[id]', 'Convener clicks Check in on a participant in the attendance panel', 'The participant is checked in (attendance row created, quorum evaluated)', 'POST /v1/meeting/:id/attendance/check-in -> 400 VALIDATION_FAILED fieldErrors[method]: the console omits the required "method" field (apps/web/src/app/(app)/meeting/_data/client.ts:223-225 vs services/meeting-service/src/modules/attendance/validators.ts:37)');
        screenCheckInFailed = true;
        const parts = sql('meeting', 'select id from meeting.participants where meeting_id=' + lit(mt.id) + ' order by role');
        const out = [];
        for (const pt of parts.slice(0, 2)) { const rr = await u1.ctx.request.fetch(L.BASE + '/api/proxy/v1/meeting/' + mt.id + '/attendance/check-in', { method: 'POST', data: { participantId: pt.id, method: 'manual', mode: 'in_person' }, headers: { 'content-type': 'application/json', 'x-idempotency-key': require('crypto').randomUUID() }, failOnStatusCode: false }); out.push(rr.status()); }
        await sleep(8000);
        att = sql('meeting', 'select participant_id, status, check_in_at from meeting.attendance_records where meeting_id=' + lit(mt.id));
        await j.step(u1, '/meeting/meetings/[id]', 'SETUP via API after the on-screen check-in failed (INFO, not a pass)', 'POST check-in method=manual -> ' + JSON.stringify(out) + ' db=' + JSON.stringify(att), null);
        lastAct = Date.now();
        break;
      }
    } else { await j.step(u1, '/meeting/meetings/[id]', 'Check in participant ' + (k + 1), 'no Check in button (status ' + status() + ')', k === 0 ? false : null); break; }
  }
  let started = false;
  if (ok) started = await transition('Start meeting', 'in_progress');
  if (!ok) j.defect('major', '/meeting/meetings/[id]', 'Schedule a meeting, add an agenda item, then Schedule meeting / Lock agenda', 'The console moves the meeting draft -> scheduled -> agenda_locked', 'Stopped at status ' + status());
  j.done(att.length && ok && !screenCheckInFailed ? 'PASS' : 'FAIL', 'lifecycle draft->scheduled->agenda_locked=' + ok + ' start=' + started + ' attendance rows=' + att.length + ' final status=' + status());
}
main().catch((e) => { L.log('FATAL', e.stack); const j = L.J[L.J.length - 1]; if (j && !j.verdict) j.done('FAIL', 'driver exception: ' + e.message.split('\n')[0]); }).finally(() => L.closeAll());
