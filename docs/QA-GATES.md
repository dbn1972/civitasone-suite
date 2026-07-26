# CivitasOne — Automated QA Gates

> Target state: a change cannot merge unless every automated gate passes.
> Manual effort collapses to **UAT acceptance sign-off + exploratory testing +
> compliance/go-no-go judgment** — nothing else.

## Gate status

| # | Gate | Status | Blocking in CI | How to run locally |
|---|------|--------|----------------|--------------------|
| 0 | Pre-commit (typecheck, lint, secret scan) | ✅ Exists | Yes | `pnpm typecheck && pnpm lint` |
| 1 | Unit | ✅ Exists | Yes | `pnpm test` |
| 2 | Integration / API / RLS | ✅ Exists | Yes | `pnpm test:integration` |
| **3** | **Contract (service↔service events)** | ✅ **Built** | **Yes** | `pnpm test:contract:events` |
| 4 | Persona E2E | ⬜ Not built | No | — |
| 5 | Data-integrity invariants | ✅ Exists | Yes | `vitest run tests/data-integrity` |
| 6 | SAST | ⚠️ Partial | Partial | `node scripts/ci/sql-injection-guard.mjs` |
| 7 | DAST | ⬜ Not built | No | — |
| 8 | Dependency / container | ⚠️ Partial | No | `pnpm audit` |
| **9** | **Accessibility (WCAG 2.2 AA)** | ✅ **Built** | **Yes** | `pnpm --filter @civitasone/web test:a11y` |
| 10 | Performance / load | ⚠️ Exists, not wired | No | k6 scripts |
| 11 | Mutation | ⬜ Not built | No | — |
| 12 | Visual regression | ⬜ Not built | No | — |
| 13 | Chaos / DR | ⚠️ DR drill only | Weekly | `.github/workflows/dr-drill.yml` |
| 14 | Synthetic monitoring | ⬜ Not built | No | — |
| 15 | SLO release gates | ⬜ Not built | No | — |

### Honest notes on the pre-existing gates

- **`scripts/ci/rtl-check.mjs` was a fake gate — now replaced.** Its failure
  condition was `if (logicalRatio < 0)`, mathematically impossible for a ratio of
  two non-negative counts, so it always exited 0 while printing "RTL-safe layout
  verified". It is now a real per-property ratchet.
- **`scripts/ci/wcag-audit.mjs` was real but insufficient — now deleted.** It
  regex-scanned `page.tsx` source and *could* fail, but never rendered a page, so
  it could not see violations from client components, shared DS primitives, or
  runtime states. Replaced by the axe-core gate.
- **Neither script was wired into any workflow.** Accessibility and RTL were
  *ungated*, not weakly gated. An earlier revision of this document claimed WCAG
  was blocking; that was wrong and is corrected above.
- **The test baseline is not green.** `location-service` fails 26 tests, and
  `apps/web` fails 19 test files / 1 test, on `main` before any change in this
  branch (verified with `git stash`). Gates are only trustworthy once the baseline
  is green — this should be fixed before Gate #5 declares the pipeline enforced.

---

## Gate #3 — Cross-service event contract

### What it catches

Defect classes that are invisible to every per-service test suite, because each
service's tests pass in isolation:

| Check | Defect | Blocking |
|-------|--------|----------|
| Dead subscription (declared) | Service declares it consumes `x.y.z`; nobody effectively produces it | Yes |
| Dead subscription (call site) | Code calls `subscribe()` on a topic nobody produces | Yes |
| Undeliverable dispatch | Service publishes into another service's command namespace; target doesn't handle it | Yes |
| Phantom consumption | `CONSUMED_EVENTS` declares a topic no code references | Yes |
| Unemitted event | `EVENTS` advertises a topic no code publishes | Yes |
| Orphan event | Produced with no consumer (publish-into-void) | Ratchet only |
| Invisible contract | A topic-shaped export the gate cannot classify | Yes |
| Stale baseline | A fixed defect still listed (could be reintroduced free) | Yes |
| Allowlist integrity | An exception without a categorised reason | Yes |
| Naming convention | Not lowercase `{service}.{entity}.{action}` | Yes |

### How it works

`tests/contract/lib/topic-registry.ts` parses all 38 `services/*/src/topics.ts`
with the **TypeScript compiler AST** (not regex) and cross-indexes producers
against consumers. Wiring is detected by **symbol-reference counting**, because
topic constants are routinely passed through helpers
(`emit(tx, msg, EVENTS.instanceCreated, …)` → `enqueue({topic: eventType})`);
literal matching at call sites produced 175 false "never emitted" reports.

### Run it

```bash
pnpm test:contract:events      # the gate (fails on NEW defects)
pnpm test:contract:strict      # fails on the FULL inventory (burn-down check)
pnpm contract:baseline         # regenerate known-defects.json after a real fix
```

### Ratchet, not amnesty

`tests/contract/known-defects.json` records the inventory that existed when the
gate landed. The gate fails if any count grows, or if a fixed defect is left
stale in the baseline. It does **not** assert the existing defects are
acceptable — they are tracked debt, listed below.

### Verified genuine

Each blocking check was verified by injecting the defect and confirming failure:

| Injected | Result |
|----------|--------|
| New consumed topic with no producer (`crm-service`) | ❌ Fails, names the topic |
| **Existing** baselined dead topic newly consumed by another service (`theme-service`) | ❌ Fails (this was a real bypass before review) |
| Map written with `satisfies` instead of `as const` | ❌ Fails (was silently invisible before) |
| Malformed `topics.ts` | ❌ Fails loudly (was silently green before) |

---

## Tracked defect inventory (Gate #3, as of 2026-07-26)

| Class | Count | Severity |
|-------|------:|----------|
| Dead subscriptions (declared) | 28 | P1 |
| Dead subscriptions (call site) | 86 | P1 |
| Undeliverable dispatch | 1 | P1 |
| Phantom consumption | 9 | P1 |
| Unemitted events | 72 | P2 |
| Orphan events | 584 | P3 |

### P0 — eOffice decision callback loop is entirely dead

**No service publishes any `*.file_decided` topic.** Eight services subscribe to
decision callbacks that are never emitted:

`asset.disposal` · `contract.award` · `finance.sanction` · `finance.payment` ·
`finance.reappropriation` · `grant.disbursement` · `grant.scheme` ·
`hrms.transfer` · `hrms.promotion` · `hrms.disciplinary` ·
`hrms.leave_special` · `hrms.recruitment` · `inspection.plan` ·
`legal.opinion` · `procurement.po` · `procurement.award`

estab-service emits `estab.file.created` / `estab.file.moved` and **no decision
event at all**. Any entity submitted for eOffice approval enters
`pending_approval` and **stays there permanently**. Verified by exhaustive search:
`grep -rE "(publish|enqueue|topic:).*file_decided" services/*/src` returns nothing.

### P1 — topic-name mismatches causing silent data loss

| Consumer | Subscribes to | Producer actually emits | Consequence |
|----------|--------------|------------------------|-------------|
| analytics | `finance.payment.released` | `finance.payment.made` | Finance payment facts never reach analytics; money dashboards silently empty |
| analytics | `grants.release.processed` | `grant.disbursement.completed` | Wrong prefix *and* entity; grant facts never reach analytics |
| payroll | `hrms.claim.approved` | *(never emitted)* | Medical claim reimbursements never reach payroll |
| meeting | `hrms.employee.updated` | `hrms.employee.created` only | Committee membership never syncs on employee change |
| inspection | `hrms.leave.updated` | `hrms.leave.applied`/`approved` | Inspector availability never updates on leave change |
| payroll | `hrms.employee.created` | declared consumed, **never subscribed** | New employees get no payroll record |
| audit | `audit.event.ingest` | *(no publisher)* | Dead ingest path |
| admin | `admin.reconciliation.complete`, `admin.reconciliation.break_detected`, `admin.webhook.replay`, `admin.webhook.rotate.request/decide` | *(no publisher)* | Reconciliation and webhook rotation never fire |
| workflow | dispatches `estab.file.level_approved` | estab doesn't handle it | Approval level decisions dropped |

**These are product defects, not test-infrastructure issues.** They are recorded
in the baseline so the gate can block new ones, and must be burned down
separately.

### Fixed in this branch

- 4 camelCase topic names in `location-service` violating the documented
  convention (zero-impact — they had no consumers)
- `audit-service` `CONSUME_TOPICS` → `CONSUMED_EVENTS` so its contract is visible
  to the gate (332 audit tests still pass)

---

## The manual boundary

Everything above is automatable. These stay human:

| Activity | Why it cannot be automated |
|----------|---------------------------|
| UAT acceptance sign-off | Does the change meet **policy intent**? A business-owner judgment. |
| Exploratory testing of novel flows | By definition not yet scripted. |
| Compliance / legal interpretation | DPDP, CAG audit, GFR readings are accountability decisions with a named human owner. |
| Go / no-go release decision | Risk appetite, not a test result. |

---

## Gate #9 — Accessibility (WCAG 2.2 AA)

### What it catches

Loads each route in real Chromium as a real persona and runs axe-core against the
**rendered DOM**, so violations in client components, shared DS primitives and
runtime states are visible — none of which the previous source-scanning script
could see.

| Check | Blocking | Notes |
|-------|----------|-------|
| axe `violations` at critical/serious | Yes | Zero-tolerance: baseline is empty |
| axe `incomplete` at critical/serious | Yes (ratchet) | Undecided checks are *not* passes |
| Landed URL == requested URL | Yes | Prevents auditing a redirect target |
| Page heading visible, skeletons resolved | Yes | Prevents auditing a shell |
| Data actually loaded (list routes) | Yes (ratchet) | Prevents auditing an empty state |
| Manifest not collapsed; every route reached axe | Yes | Prevents a shrunken/errored run reading clean |
| Design-token contrast (unit test, no browser) | Yes | Catches the commonest root cause in seconds |
| RTL physical-property ratchet | Yes | Count may not grow |

### Run it

```bash
pnpm --filter @civitasone/web test:a11y          # curated 52 routes
pnpm --filter @civitasone/web test:a11y:full     # all ~410 routes (pre-release)
pnpm --filter @civitasone/web exec vitest run tests/a11y/design-tokens.test.ts
node scripts/ci/rtl-check.mjs                    # RTL ratchet
node scripts/ci/rtl-check.mjs --report           # worst RTL offenders
```

Requires the web app running with a reachable gateway. `A11Y_BASELINE_WRITE=1` is
refused in CI — it skips the assertion, which would launder new violations.

### Verified genuine

| Injected defect | Result |
|---|---|
| `--mut` reverted to the non-compliant `#98a2b3` | Fails, reports the measured 2.58:1 |
| Route pointed at a persona lacking the role | Fails: "REDIRECTED to /dashboard" |
| +5 RTL physical properties | Fails: "grew from 658 to 663" |
| Malformed RTL baseline (`physicalCount` instead of `physical`) | Fails (previously exited 0 "PASSED") |

### Violations found and fixed: 51 → 0

| # | Defect | Scope | Fix |
|---|--------|-------|-----|
| 1 | `--mut` = `#98a2b3`, 2.58:1 on white | **50 of 52 routes** (sidebar is on every page) | `#667085`, 4.97:1 |
| 2 | `Chart.tsx` legend `#94a3b8`, 2.56:1 | Every chart/dashboard | `#667085` |
| 3 | Roundness slider label not associated (`label`, **critical**) | `/settings/branding` | `htmlFor`/`id` + `aria-describedby` |
| 4 | `text-gray-400` `#9ca3af`, 2.54:1 | `/settings/branding` | `text-gray-500`, 4.83:1 |
| 5 | Accent preview hardcoded `color:#fff`, 2.14:1 on amber | `/settings/branding` | Foreground derived from background luminance |

One design token accounted for 50 of the 51 findings.

### Residual state — recorded honestly

| Bucket | Count | Meaning |
|--------|------:|---------|
| Definite violations | **0** | Zero-tolerance gate, empty baseline |
| axe-undecidable (critical/serious) | **47** | Text over CSS gradients, and decorative glyphs (`◈`, emoji). axe cannot compute these; they need **human contrast verification** and sit in the manual-judgment bucket. |
| Not certified | **4** | `/approvals`, `/finance/payments`, `/finance/budget/allocation`, `/finance/accounting/general-ledger` render the data-unavailable state, so the DataTable and its controls are absent. These are **unmeasured, not clean** — a separate defect to fix. |

### Separate bug found by reading the rendered DOM

`/finance/dashboard` displayed **"Remaining: Infinity"**. `BudgetChart` computed
`utilized * ((100 - utilisationPct) / utilisationPct)` guarded with `|| 0`, which
does not catch `Infinity` because `Infinity` is truthy. `utilisationPct` is `0`
whenever nothing has been spent — normal at the start of a financial year. Fixed.

### RTL state

606 → **658** RTL-unsafe physical properties once the detector stopped being blind
to Tailwind arbitrary values, against **2** logical ones. The app is effectively
RTL-incapable; the old gate reported "RTL-safe layout verified". Ratcheted rather
than hard-failed, because failing outright would force either a mass refactor or a
disabled gate.
