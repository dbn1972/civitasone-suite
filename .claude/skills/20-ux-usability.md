# Skill — UX / Usability

**When to load:** Building or reviewing any `apps/web` screen, before claiming a page is "done" from a user's perspective, or when asked whether the product is usable — not accessible (skill 8 covers WCAG compliance separately; a screen can pass every axe-core check and still be unusable).

---

## The rule

> A screen that renders without error is not the same as a screen that tells its user the truth. The most damaging UX bug class in this codebase's real history is not "ugly" or "confusing" — it's a UI confidently displaying a healthy/complete/correct state when the underlying data never actually loaded, was never actually checked, or was silently wrong.

## 1. Design system — real vs. adopted (check before assuming consistency)

`packages/ui-kit/` — the shared, cross-app design-system package — exports exactly two components (`Button`, `AppShell`) and is imported by exactly **one** file in the whole web app. Out of ~2,945 `.tsx` files under `apps/web/src`, **510** use a raw `<button>` element instead of any shared component. The design system that's actually maintained and used lives locally, trapped inside one app: `apps/web/src/app/_components/ds/` (`EmptyState`, `ErrorState`, `HelpTip`, `PageHeader`, `Term`, `DataTable`, `ConfirmDialog`) plus `ModuleHub`/`PageShell`. Even this local library has narrow adoption relative to app size — `DataTable` in 1 file, `PageHeader` in 3, against 827 `page.tsx` files and 114 files still using a raw `<table>`.

**Before assuming a new or existing screen follows the established design language, check which of these two libraries (or neither) it actually imports from.** The shared `@civitasone/ui-kit` package being nearly unused is itself a governance gap worth flagging if you're asked to plan a second frontend or a mobile-web surface — the reusable piece isn't where the reuse actually happened.

## 2. The "UI fabricating a healthy state" bug class

This is the single most important, most repeated finding from real UX audit work on this codebase — a screen doesn't crash and doesn't look broken, it just **confidently states something false**, because the code path that would have surfaced the real state was never actually wired:

- **`DataSourceBadge` across 57 files, 60 call sites** (Cluster-B HR/payroll pages): the shared data-fetch helper never returns cached data on a fetch failure — it always returns an empty result with `source: "error"`. Every call site rendered the default "Showing saved information" badge on top of an empty list on a genuine fetch failure, telling the officer nothing was wrong when nothing had actually loaded.
- **Salary-slip detail screen rendering `Rs.NaN` for Net Pay** — the raw DB row has `netPayMinor`; the frontend read `slip.netMinor` (a field that doesn't exist on that shape), divided `undefined` by 100, and rendered `NaN` on the one screen whose entire purpose is confirming an employee's take-home pay. This is exactly the failure mode skill 16 §6 already names as forbidden ("a UI that renders a money amount... as blank/undefined/NaN instead of erroring loudly") — it happened anyway, on a real shipped screen, because nothing enforced it at the frontend/API boundary.
- **SLA Queue dashboard cards structurally always reading zero breaches** — the stat cards filtered an already-filtered list a second time (guaranteeing zero), and a separate unfiltered ticket-list endpoint never set the `slaStatus` field at all, so the dashboard always reported "0 breaches / 100% healthy" regardless of the real breach state.
- **Dead keyboard-shortcut and voice-nav quick actions** pointing at stale routes (`/finance/vouchers/new` when the real path had moved to `/finance/accounting/vouchers/new`) — a command that looks like it should work, silently 404s.

**When reviewing a screen, don't just check that it renders — check what it renders when the underlying fetch fails, returns empty, or the field it reads doesn't exist on the actual API response shape.** A screen with no visible error state today may just mean no one has fed it a failure yet.

## 3. The government-staff-first design methodology already defined — use it, don't reinvent it

`.kiro/specs/zero-training-ux-uplift/requirements.md` is a genuinely detailed, already-adopted UX spec worth reading before designing any new screen, not a theoretical ideal: it names the actual target user explicitly ("a lower-level government office clerk who has received no formal training and has no IT background"), defines a glossary of domain-specific terms to **explain, not rename** (PPO, DDO, DBT, ESI, PT, IRN, UTR, NEFT/RTGS, BE/RE, CPC, MOM, KRA, DAK, GPF/NPS, APAR, TA-DA, RFQ/GRN/EMD/BG/GeM), and mandates plain-language subtitles, contextual `HelpTip`s, honest (never-fabricated) progress indicators, human-readable error messages with zero HTTP-status or stack-trace leakage, and a Sample Data "try it" mode. The real, shipped mechanisms are `apps/web/src/lib/labels.ts`, `messages.ts` (`toHumanError()`), `moduleVisibility.ts`, and `setupSteps.ts`/`progress.ts` — reuse these rather than writing a new error-copy or terminology convention per module.

**Adoption caveat**: the spec's own scope was one retrofitted "primary/home screen" per each of 9 Major Modules, not the app broadly. Don't assume a screen outside that specific set already follows this methodology — check whether it actually imports `toHumanError()`/the `ds/` components before crediting it.

## 4. Error message quality — the backend half is solid, frontend adoption is the open question

`financeErrorHandler` (and its equivalents in other services) returns structured errors — `code`, `message`, `correlationId`, `retryable`, field-level Zod errors — rather than a generic 500, and was itself fixed once already for a real bug (`retryable: true` on a 400, which a well-behaved client would retry forever). `toHumanError()` on the frontend is the intended translation layer from this structured error into clerk-facing "what happened / what to do next" copy. **Check both ends when reviewing an error path**: a well-structured backend error is only as good as the frontend code that actually reads its `code`/`fieldErrors` instead of falling back to a generic "Something went wrong."

## 5. Loading / empty / error states

The `ds/EmptyState` and `ds/ErrorState` components exist and are correctly built where wired (per the zero-training-ux-uplift requirements), but adoption is narrow (§1) — most pages outside each module's one retrofitted flagship screen likely still assume happy-path data with no explicit handling for "the list is empty" vs. "the fetch failed" vs. "still loading." Don't assume a screen distinguishes these three states just because it doesn't currently show a visible bug — see §2's DataSourceBadge example, which looked fine until a real failure was fed to it.

## Forbidden patterns

- A data-fetch failure that silently renders as an empty/default success state instead of a visible error.
- Reading a field name on the frontend that doesn't match the actual API/DB response shape without a type check that would have caught the mismatch at build time.
- A dashboard stat/count computed by filtering an already-filtered dataset, guaranteeing a constant (often zero) result regardless of real data.
- A quick-action, shortcut, or nav link pointing at a route that no longer exists.
- Introducing a new component pattern without checking `apps/web/src/app/_components/ds/` first for an existing one that already does the job.

## Known gaps — not covered by this skill

- **No systematic usability testing or user research methodology exists** — the real UX fixes cited in §2 came from ad hoc audit-and-fix passes over specific modules, not a repeatable usability-testing process with real government-staff participants.
- **Design-system consolidation is unresolved** — `@civitasone/ui-kit` vs. the local `apps/web/_components/ds/` library (§1) is a real architectural fork, not a stylistic quibble; a second frontend surface would currently have almost nothing to reuse.
- **Most of the ~827 pages have not been through the zero-training-ux-uplift pass** — only one flagship screen per Major Module was in scope; treat any other page as unaudited by this methodology until checked.
- Accessibility (WCAG 2.2 AA compliance) is covered separately by skill 8 — a page can pass this skill's usability bar and still fail that one, or vice versa; check both.
