import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = join(__dirname, "../src/modules");

function routeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "routes.ts" || name.endsWith("-routes.ts") || name.endsWith("-route.ts")) out.push(p);
    }
  };
  walk(MODULES);
  return out;
}

const SYNC_WRITE = /\b(?:db|tx)\.(?:insert|update|delete|execute)\s*\(|\bdb\.transaction\s*\(|await\s+repo\.(?:insert|update|delete|create|save|upsert|attest|transition)\w*\s*\(/;

/**
 * Sites that are DELIBERATELY exempt from the sync-write scan below because
 * they are intentional, reviewed synchronous writes — not accidental F3
 * leftovers. Each entry pins exactly one `<module-relative-path>:<line>` (not
 * a whole file) so that a future refactor which moves the line re-triggers
 * this test and forces a fresh look, instead of silently carrying a stale
 * exemption forward. Add a new entry ONLY with a comment here explaining why
 * an async `publishF3Write` conversion is unsafe at that exact site, and
 * check the same reasoning is also written at the site itself.
 *
 * - recruitment/otp-verify-routes.ts:96 — `db.transaction(...)` wrapping the
 *   `SELECT ... FOR UPDATE` read + conditional `repo.markVerified` write,
 *   made synchronous by PR #912 to close a double-token-issuance race: two
 *   concurrent requests submitting the same correct OTP code could both pass
 *   `verifyOtp` before either write landed, and both get issued a "verified"
 *   response. The fix locks the challenge row and writes `verified = true`
 *   inside that same transaction, before the lock releases, so a second
 *   concurrent request blocks on the lock and then observes `verified =
 *   true` once it acquires it. Routing `markVerified` back through the
 *   async `publishF3Write` queue would reopen exactly this gap — the decide
 *   ("code is correct") and the durable write ("mark verified") would again
 *   happen in two separate steps with a window between them, which is the
 *   root cause PR #912 fixed. See the comment directly above the
 *   `db.transaction` call in that file for the full writeup.
 *
 * - recruitment/interview-comms-routes.ts:89 (the `db.transaction(...)` call)
 *   and :94 (`repo.insertComm(tx, ...)` inside it) — for the reschedule/
 *   cancel branch only (invite/reminder still publish via publishF3Write,
 *   unchanged). Same shape of gap as the OTP case above: rescheduleInterview/
 *   cancelInterview are optimistic-version-guarded writes whose whole POINT
 *   is to report a real 409 VERSION_CONFLICT back to the caller when the
 *   guard misses. MemoryQueue.publish() (see shared/f3-publish.ts) resolves
 *   before its consumer ever runs, so a version conflict discovered inside
 *   the async consumer can never reach the HTTP response that already went
 *   out — the decide and the durable write must happen in the same
 *   synchronous step for the 409 contract to mean anything
 *   (tests/interview-comms-route.test.ts "maps a version conflict on
 *   reschedule to 409" proved this empirically).
 * - recruitment/interview-recording-routes.ts:73 (the `db.transaction(...)`
 *   call) and :74 (`repo.insertRecording(tx, ...)` inside it). Same
 *   reasoning: a duplicate active storage key (partial unique index, 23505)
 *   must map to 409 DUPLICATE_RECORDING synchronously (the route's own error
 *   handler already does that translation) — via publishF3Write the
 *   violation is only ever thrown inside the async consumer, after the 201
 *   already went out.
 * - recruitment/interview-response-routes.ts:103 — `db.transaction(...)` for
 *   the HR-approve-reschedule-request path only (candidate-response and
 *   decline are unchanged, still async). Same reasoning again: approve
 *   applies the requester's slot under rescheduleInterview's version guard,
 *   and needs to report VERSION_CONFLICT synchronously for the same reason
 *   as interview-comms-routes.ts above.
 * - manpower-planning/routes.ts:176 — `db.transaction(...)` for
 *   PUT .../roster. Not a version-guard case like the three above: this is a
 *   plain delete+insert (replaceRoster) with nothing to guard, but the route
 *   immediately reads the roster back (repo.listRoster) to answer the
 *   request — via publishF3Write that read always ran before the consumer's
 *   write, returning the PRE-write (stale/empty) roster every time
 *   (tests/manpower-routes.test.ts's roster-count assertion caught this).
 *   Making the write itself synchronous is the only way the immediate
 *   read-back can observe what was just submitted.
 * - integration/routes.ts:75 (`db.transaction(...)` for POST
 *   /v1/hrms/integrations) and :92 (`db.transaction(...)` for POST
 *   /v1/hrms/integrations/:id/sync). SEC-010: employee.integrations /
 *   employee.integration_sync_log went from no RLS to FORCE RLS, so these
 *   two writes (previously bare `sqlPool.query()` calls, invisible to this
 *   scanner since sqlPool isn't a Drizzle/repo call) had to move behind
 *   wrapWithTenantGuc to still work at all — this scanner just started
 *   seeing writes that were already synchronous before the RLS fix, not new
 *   ones. Both are the same shape as the version-guard cases above: the
 *   create route echoes the row's own id/status back in its 201 body, and
 *   the sync route must answer 404 (not found) vs 422 (inactive) vs 202
 *   synchronously from that row's *current* state — through publishF3Write
 *   either would report success/200-family before the consumer confirms the
 *   row exists or is active, the same "decide and durable write must be one
 *   step" problem as the OTP case above. Re-architecting this module onto
 *   the async F3 pattern is a real option but out of scope for a same-file
 *   RLS migration; see the matching comment in integration/routes.ts itself.
 * - recruitment/screening-routes.ts:110 (`db.transaction(...)` wrapping
 *   `repo.insertEvent` inside the local `denyAsOverride` helper) — R-RA-0111
 *   TOCTOU fix (fix/hrms-screening-toctou): a denied re-decision, whether
 *   caught by the route's own sequential pre-check or by losing the atomic
 *   race below, must leave an audit trail in the SAME step as the 409 it
 *   returns. If this write moved back onto the async queue, publishF3Write
 *   would resolve (and the 409 go out) before its consumer ever ran, so a
 *   caller could receive the 409 with no corresponding `override_denied`
 *   event yet on record — reopening the exact "zero-trace override" gap this
 *   PR closes. See screening-decision-race.test.ts's audit-trail assertions.
 * - recruitment/screening-routes.ts:170 (`db.transaction(...)`) and :173
 *   (`repo.insertEvent(tx, ...)` inside it) — the same fix's core write: a
 *   first-time screening decision on a still-pending application. Same shape
 *   as the OTP case above: the decide ("is this still the first decision?")
 *   and the durable write (screening-repo.ts's setScreeningIfPending, a
 *   conditional `UPDATE ... WHERE screening_decision = 'pending'`) must be
 *   one atomic step, because two genuinely concurrent decisions on the same
 *   application both read 'pending' before either write lands (the proven
 *   bug this PR fixes) and the route's response — 200 isOverride:false for
 *   the winner, 409 OVERRIDE_VIA_MAKER_CHECKER for the loser — must reflect
 *   which one actually won the atomic UPDATE, not a queue-publish
 *   acknowledgment sent before either write happens. Routing this back
 *   through publishF3Write reopens exactly the race
 *   screening-decision-race.test.ts proves closed (10/10 real Promise.all
 *   runs, no artificial gate needed — see that file's header for why). See
 *   the comment directly above this db.transaction call in screening-routes.ts.
 * - recruitment/screening-override-routes.ts:156 (`db.transaction(...)` for
 *   POST .../approve) and :229 (`db.transaction(...)` for POST .../reject) —
 *   R-RA-0111 TOCTOU fix (fix/hrms-screening-override-toctou), the sibling gap
 *   the same audit that produced screening-routes.ts's fix above flagged in
 *   this file: the SoD/version checks ran synchronously, but the actual
 *   transition (and, for approve, applying the decision to the application)
 *   was still deferred to the fire-and-forget F3 queue via publishF3Write,
 *   whose consumer (f3-consumer.ts's now-removed
 *   "recruitment_screening_override_routes__1"/"__2" cases) re-fetched fresh
 *   rows but never re-checked isActionable/SoD/staleness before writing —
 *   identical shape to the screening-routes.ts gap. Two genuinely concurrent
 *   checker decisions on the same request (two approvals, or an approve
 *   racing a reject) both passed every pre-check before either write landed.
 *   Both routes now perform their write synchronously via
 *   screening-override-repo.ts's setRequestStatusIfPending — a conditional
 *   `UPDATE ... WHERE status = 'pending'` — and approve additionally guards
 *   the application side inside the SAME transaction via screening-repo.ts's
 *   existing version-guarded setScreening, so both sides win together or not
 *   at all. See the comment directly above each db.transaction call in
 *   screening-override-routes.ts, and
 *   screening-override-decision-race.test.ts (10/10 real Promise.all runs,
 *   same no-artificial-gate reasoning as screening-decision-race.test.ts).
 * - recruitment/screening-override-routes.ts:323 (`db.transaction(...)`
 *   inside the shared `recordOverrideDecisionDenied` helper) — the same fix's
 *   denial-audit write: a checker decision denied by losing the atomic race
 *   above (or by the route's own sequential pre-check) must leave a trace in
 *   the SAME step the 409 is decided in, for the identical reason as
 *   screening-routes.ts's `denyAsOverride` above — otherwise a caller could
 *   receive the 409 with no corresponding `override_denied` event yet on
 *   record, reopening the exact "zero-trace override" gap PR #1585 closed.
 *   Reuses hrms_screening_events' 'override_denied' action (already permitted
 *   by PR #1585's migration 0152 — no new migration needed here) with
 *   isOverride:true to distinguish it from that PR's own isOverride:false
 *   usage.
 */
const KNOWN_INTENTIONAL_SYNC_WRITES = new Set<string>([
  "recruitment/otp-verify-routes.ts:96",
  "recruitment/interview-comms-routes.ts:89",
  "recruitment/interview-comms-routes.ts:94",
  "recruitment/interview-recording-routes.ts:73",
  "recruitment/interview-recording-routes.ts:74",
  "recruitment/interview-response-routes.ts:103",
  "manpower-planning/routes.ts:176",
  "integration/routes.ts:75",
  "integration/routes.ts:92",
  "recruitment/screening-routes.ts:110",
  "recruitment/screening-routes.ts:170",
  "recruitment/screening-routes.ts:173",
  "recruitment/screening-override-routes.ts:156",
  "recruitment/screening-override-routes.ts:229",
  "recruitment/screening-override-routes.ts:323",
]);

/**
 * Blank WHOLE-LINE comments (`// ...`, `/* ... *\/` blocks and JSDoc bodies),
 * preserving line numbers, so prose that merely MENTIONS `db.transaction(`
 * (e.g. "must go through db.transaction() ...") is never mistaken for a call
 * site. Deliberately line-based, not character-based: a string literal that
 * contains `/*` or `//` can then never blank real code after it.
 */
function stripComments(src: string): string[] {
  let inBlock = false;
  return src.split("\n").map((line) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      return "";
    }
    if (t.startsWith("//")) return "";
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      return "";
    }
    return line;
  });
}

/**
 * Index just past the `)` that balances the `(` at `open`, or -1. String- and
 * template-literal aware so a paren inside a string cannot unbalance it.
 */
function balancedEnd(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** The full `db.transaction( ... )` call that opens on `lines[start]`, or null. */
function transactionCall(lines: string[], start: number): string | null {
  const text = lines.slice(start, start + 120).join("\n");
  const at = text.indexOf("db.transaction(");
  if (at === -1) return null;
  const end = balancedEnd(text, at + "db.transaction".length);
  return end === -1 ? null : text.slice(at, end);
}

/** `text` with every balanced `name( ... )` call (and a leading `await`) removed. */
function removeCalls(text: string, name: string): string {
  const re = new RegExp(`(?:\\bawait\\s+)?\\b${name}\\s*\\(`);
  let out = text;
  for (;;) {
    const m = re.exec(out);
    if (!m) return out;
    const end = balancedEnd(out, m.index + m[0].length - 1);
    if (end === -1) return out;
    out = out.slice(0, m.index) + out.slice(end);
  }
}

/**
 * ALLOW-LIST (fails closed). A `db.transaction(cb)` is exempt only when it is a
 * pure read-audit wrapper: after deleting every balanced auditLog(...) /
 * emitAudit(...) call from the callback body, NOTHING executable may remain --
 * so the tx parameter (whatever it is named) is never used elsewhere, no other
 * call takes it, and no side-channel write (sqlClient.unsafe, a helper, a
 * destructured repo method, a tagged template, ...) can sit beside the audit
 * call. Such a wrapper exists only because wrapWithTenantGuc intercepts
 * db.transaction() to set app.tenant_id; it defers/races no business write.
 * Anything unrecognised is NOT exempt.
 */
function isAuditOnlyTransaction(call: string): boolean {
  const arrow = call.indexOf("=>");
  if (arrow === -1) return false;
  const sig = /^db\.transaction\(\s*(?:async\s*)?(?:\(\s*(\w+)\s*(?::[^)]*)?\)|(\w+))\s*=>/.exec(call);
  if (!sig) return false; // function-expression callbacks etc. are not recognised
  const param = sig[1] ?? sig[2]!;
  const body = call.slice(sig[0].length);
  if (!/\b(?:auditLog|emitAudit)\s*\(/.test(body)) return false;
  const rest = removeCalls(removeCalls(body, "auditLog"), "emitAudit");
  if (new RegExp(`\\b${param}\\b`).test(rest)) return false;
  // Only punctuation / await / return may be left (closing parens, braces, `;`).
  return rest.replace(/\b(?:await|return)\b/g, "").replace(/[\s{}();,]/g, "") === "";
}

/** 1-based line numbers of sync Drizzle / repo writes in one route file's source. */
function findSyncWrites(src: string): number[] {
  const lines = stripComments(src);
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/await\s+repo\.(?:insert|update|delete|create|save|upsert|attest|transition)\w*\s*\(/.test(line)) {
      hits.push(i + 1);
      continue;
    }
    if (/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/.test(line)) {
      hits.push(i + 1);
      continue;
    }
    if (/\bdb\.transaction\s*\(/.test(line) && !isAuditOnlyTransaction(transactionCall(lines, i) ?? "")) {
      hits.push(i + 1);
    }
  }
  return hits;
}

describe("F3 leftover hrms CQRS route boundary", () => {
  it("all module routes have zero sync Drizzle / repo writes (excluding disclosed exceptions above)", () => {
    const offenders: string[] = [];
    for (const file of routeFiles()) {
      // Allow scopedRead((tx) => tx.execute(SELECT...)) analytics reads and
      // read-audit-only transactions -- only flag writes.
      for (const lineNo of findSyncWrites(readFileSync(file, "utf8"))) {
        offenders.push(`${file.replace(MODULES + "/", "")}:${lineNo}`);
      }
    }
    const unexpected = offenders.filter((o) => !KNOWN_INTENTIONAL_SYNC_WRITES.has(o));
    expect(unexpected).toEqual([]);

    // Guard against a stale allowlist entry (e.g. the line moved after a
    // refactor) silently hiding a *different* sync write that happens to
    // land on the same file:line.
    const stale = [...KNOWN_INTENTIONAL_SYNC_WRITES].filter((entry) => !offenders.includes(entry));
    expect(stale).toEqual([]);
  });

  describe("scanner precision (findSyncWrites)", () => {
    it("ignores whole-line comments that merely mention db.transaction( / db.insert(", () => {
      const src = [
        "// must go through db.transaction() (not a bare db.insert()) so RLS applies",
        "/**",
        " * db.transaction(async (tx) => tx.insert(x))",
        " */",
        "/* db.update( */",
      ].join("\n");
      expect(findSyncWrites(src)).toEqual([]);
    });

    it("a string containing /* or // does not blank the code after it", () => {
      const src = ['const g = "/*";', "await db.insert(table).values(v);", 'const u = "http://x";'].join("\n");
      expect(findSyncWrites(src)).toEqual([2]);
    });

    it("exempts a pure read-audit transaction (any tx param name, arrow forms)", () => {
      const src = [
        "await db.transaction((tx) => auditLog(tx, {",
        "  action: 'read_detail', note: 'a (b) c',",
        "}));",
        "await db.transaction(async (t) => {",
        "  await emitAudit(t, ctx, 'hrms.x.list_viewed', 'x', id, { count: rows.length });",
        "});",
        "await db.transaction(async trx => { await auditLog(trx, {}); });",
      ].join("\n");
      expect(findSyncWrites(src)).toEqual([]);
    });

    const flagged = (body: string[]) =>
      expect(findSyncWrites(["await db.transaction(async (tx) => {", ...body, "});"].join("\n"))).toContain(1);

    it("still flags a real write beside auditLog, however it is spelled", () => {
      flagged(["  await tx.insert(table).values(v);", "  await auditLog(tx, {});"]);
      flagged(["  await tx.execute(sql`DELETE FROM x`);", "  await auditLog(tx, {});"]); // execute
      flagged(["  await tx`UPDATE x SET y = 1`;", "  await auditLog(tx, {});"]); // tagged template on tx
      flagged(["  await sqlClient.unsafe('UPDATE x SET y = 1');", "  await auditLog(tx, {});"]); // side channel, tx unused
      flagged(["  await createThing(tx, row);", "  await auditLog(tx, {});"]); // helper not named *repo
      flagged(["  await repository.update(tx, id, patch);", "  await auditLog(tx, {});"]);
      flagged(["  const { insertThing } = repo;", "  await insertThing(tx, row);", "  await auditLog(tx, {});"]); // destructured
      flagged(["  await auditLog(tx, {});", "  await helper(async () => otherWrite(tx));"]); // nested helper
    });

    it("flags a renamed tx param used for a write beside the audit call", () => {
      expect(findSyncWrites("await db.transaction(async (t) => { await t.execute(q); await auditLog(t, {}); });")).toEqual([1]);
      expect(findSyncWrites("await db.transaction(async (trx) => { await trx.insert(x).values(v); await emitAudit(trx, c, 'a', 'b', i, {}); });")).toContain(1);
    });

    it("still flags repo transactions, bare db.insert, and unrecognised callbacks", () => {
      expect(findSyncWrites("await db.transaction((tx) => repo.insertThing(tx, row));")).toEqual([1]);
      expect(findSyncWrites("await db.insert(table).values(v);")).toEqual([1]);
      expect(findSyncWrites("await db.transaction(async function (tx) { await auditLog(tx, {}); });")).toEqual([1]);
    });
  });

  it("leave cancel publishes via sendAccepted", () => {
    const src = readFileSync(join(MODULES, "leave/cancel-route.ts"), "utf8");
    expect(src).toContain("sendAccepted");
    expect(src).toContain("commands.cancelLeave");
    expect(src).not.toContain("db.transaction");
  });

  it("f3 leftover consumers are registered", () => {
    const worker = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");
    expect(worker).toContain("registerF3LeftoverAll");
    const topics = readFileSync(join(__dirname, "../src/topics.ts"), "utf8");
    expect(topics).toContain("f3RouteWrite");
    expect(topics).toContain("leaveCancel");
  });

  it("claims / disciplinary / service-book / rti residuals publish via queue", () => {
    const claims = readFileSync(join(MODULES, "claims/routes.ts"), "utf8");
    expect(claims).toContain('claims_routes__4');
    expect(claims).toContain('claims_routes__5');
    expect(claims).not.toMatch(/repo\.insertLtc|repo\.insertCea/);
    const disc = readFileSync(join(MODULES, "disciplinary/routes.ts"), "utf8");
    expect(disc).toContain("disciplinary_routes__3");
    expect(disc).not.toMatch(/repo\.insertSuspension/);
    const sb = readFileSync(join(MODULES, "service-book/routes.ts"), "utf8");
    expect(sb).not.toMatch(/repo\.updateEntryDescription|repo\.attestEntry/);
    const rti = readFileSync(join(MODULES, "rti/routes.ts"), "utf8");
    expect(rti).not.toMatch(/repo\.transitionRti/);
  });

  /**
   * pay-matrix annual-increment (fix/hrms-paymatrix-async-conversion): the
   * last 2 sites this guard test used to flag are now genuinely converted,
   * not just disclosed. routes.ts computes the exact per-employee increment
   * plan synchronously and forwards it verbatim via `pay_matrix_routes__0`;
   * f3-consumer.ts applies that plan exactly (never re-deriving a pay level
   * or re-walking PAY_MATRIX — that independent re-derivation is what made
   * the two earlier, reverted attempts at this conversion double-apply a
   * 7th-CPC increment). The double-submit race that a plain publish+consume
   * conversion would reopen (two concurrent requests both deciding to
   * increment the same employee before either consumer has written) is
   * closed at the DB layer by a partial unique index — see
   * migrations/0132_pay_matrix_increment_idempotency.sql and the
   * insert-first/conflict-checked write in f3-consumer.ts.
   */
  it("pay-matrix annual-increment forwards an exact plan; consumer applies it without re-deriving anything", () => {
    const routes = readFileSync(join(MODULES, "pay-matrix/routes.ts"), "utf8");
    expect(routes).toContain("pay_matrix_routes__0");
    expect(routes).toContain("plan");
    expect(routes).not.toMatch(SYNC_WRITE);

    const consumer = readFileSync(join(MODULES, "pay-matrix/f3-consumer.ts"), "utf8");
    expect(consumer).toContain("pay_matrix_routes__0");
    // Applies the precomputed toMinor verbatim...
    expect(consumer).toContain("BigInt(toMinor)");
    // ...and never re-derives a level from ENTRY_PAY_PAISE/basicMinor, which
    // is exactly what made the earlier reverted attempts double-apply.
    expect(consumer).not.toMatch(/ENTRY_PAY_PAISE/);
    // DB-layer idempotency: insert is conflict-checked before any pay write.
    expect(consumer).toContain("onConflictDoNothing");
  });
});
