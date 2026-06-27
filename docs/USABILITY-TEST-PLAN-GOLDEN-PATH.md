# Usability Test Plan — Zero-Training Golden Path

**Product:** CivitasOne (gov-ERP)
**What we're testing:** can a real lower-level government clerk, with no training,
sign in and complete the golden path — set up their office and post a first real
transaction — unaided?
**North star:** Time-to-First-Real-Transaction (TTFRT). This test produces our
first *real* TTFRT readings and tells us exactly where offices get stuck.

---

## 1. Objectives

1. Measure **task success** (unaided / aided / failed) for each golden-path task.
2. Measure **TTFRT** per participant (sign-in → first posted transaction).
3. Find the **biggest drop-off** on the golden path and the reasons behind it.
4. Validate the **zero-training aids** built so far: setup wizard, plain-language
   labels, HelpTip tooltips, Help Centre, guided empty states, first-run tour,
   sample-data ("try it").
5. Capture **plain-language gaps** (words/labels/errors a clerk doesn't understand).

Out of scope: visual-design preference, performance/load, security testing.

---

## 2. Participants

**Target n = 5** (Nielsen: ~5 users surface ~85% of usability problems). Recruit
to the real persona, not colleagues who know the product:

| # | Profile | Why |
| --- | --- | --- |
| P1 | Junior clerk, district office, minimal IT exposure | Core persona |
| P2 | Clerk who uses only WhatsApp/basic apps | Lower digital-literacy bound |
| P3 | Section officer (approves work) | Maker-checker view |
| P4 | Clerk from a different domain (HR vs finance) | Cross-module generality |
| P5 | New joiner, first week | True "no prior context" |

Screening: no prior CivitasOne exposure; comfortable reading the UI language
(English/Hindi/Odia as deployed). Avoid anyone who helped build or spec it.

---

## 3. Environment (UAT)

- **Host:** the UAT box (this environment), fleet running in UAT mode
  (`RUNTIME_NODE_ENV=staging`, `JWT_ALGORITHM=HS256`, `ENABLE_DEV_LOGIN=true`,
  `SAMPLE_DATA_ENABLED=true`).
- **Access:** `/auth/dev` → sign in as `superadmin / Civitas@123`, entering the
  participant's **Office ID** in the optional field so each works in a fresh office.
  Provision the offices with `node scripts/dev/provision-uat-tenants.mjs 5` (prints
  a per-participant recipe with Office IDs). Do **not** share one office across
  participants; their funnels and setup state would collide.
- **Sample data:** available via Getting Started → "Add example offices" so a
  participant can explore safely; reset removes only `[SAMPLE]` rows.
- **Instrumentation:** the activation funnel records each step + first transaction.
  After each session, read `/tenant-admin/activation` (platform admin sees all
  offices) to corroborate observed behaviour with the funnel.
- **Recording:** screen + audio with consent; note-taker captures timestamps.

> Reminder: UAT lowers the auth posture (dev-login/HS256). Never run real citizen
> data here. Revert per the golden-path audit when testing is done.

---

## 4. Tasks (scenarios, in plain language to the participant)

Read each scenario aloud; do **not** name menus or buttons (no leading). Let the
participant think aloud. Stop a task at 8 minutes and mark it failed.

1. **Sign in & get oriented.** "You've just been given access. Sign in and tell me
   what you think this system is for and where you'd start." *(Tests first-run tour
   + dashboard clarity.)*
2. **Set up the office.** "Set up your office so it's ready to use." *(Tests the
   setup wizard: office details, branches, departments, invite a person, choose
   modules. Observe whether they understand each step and the progress.)*
3. **Explore safely.** "You're not sure what an 'office/branch' list looks like —
   try it without affecting anything real, then tidy up after." *(Tests sample-data
   add + clear, and whether the [SAMPLE] marking is understood.)*
4. **Do a first real piece of work — Finance.** "Record and post a simple journal
   entry / a bill." *(This is the TTFRT moment. Tests jargon: voucher, debit/credit,
   double-entry, and whether HelpTip/Help Centre rescue them.)*
5. **Use help when stuck.** If they stall, observe whether they *find* help
   (HelpTip "?", "How this works", Help Centre) on their own before you intervene.
6. **(If time) Cross-module.** "Apply for leave" (HR) or "raise a request to buy
   something" (Procurement) — tests generality of the patterns.

---

## 5. Metrics & instruments

**Per task**
- Success: **Unaided / Aided (hint given) / Failed**.
- Time on task (start at scenario read-end → task completion).
- Errors & wrong turns (count + where).
- Help usage: did they open a HelpTip / How-this-works / Help Centre? Did it help?
- **Single Ease Question (SEQ):** "How easy or hard was that task?" 1 (very hard) – 7 (very easy), asked right after each task.

**Per session**
- **TTFRT:** sign-in → first posted transaction (from observation AND the
  activation dashboard; reconcile the two).
- **SUS** (System Usability Scale, 10 items) at the end.
- Top 3 confusing words/labels/messages (verbatim quotes).

**Targets (provisional, to refine after baseline)**
- ≥ 4/5 complete office setup unaided.
- ≥ 3/5 post a first transaction unaided.
- Median TTFRT ≤ 20 minutes.
- Median SEQ ≥ 5; SUS ≥ 70.

---

## 6. Moderator script (skeleton)

- **Intro (2 min):** purpose ("we're testing the software, not you"), think-aloud,
  no right/wrong, you can stop anytime, consent to record.
- **Warm-up (2 min):** role, devices they use day-to-day.
- **Tasks (35–40 min):** read scenario, stay silent, only nudge after a genuine
  stall (and record that as "aided"). Neutral prompts only: "What are you trying to
  do?", "What did you expect to happen?", "What would you do next?"
- **Debrief (10 min):** SUS, hardest moment, confusing words, one thing to change.

Rule: never point at the screen or say a feature name. Silence is data.

---

## 7. Reset between participants

- Preferred: a **fresh office per participant** — run
  `node scripts/dev/provision-uat-tenants.mjs 5` once before the sessions and give
  each participant their own Office ID (cleanest funnel).
- If reusing an office: clear sample data (Getting Started → "Clear example
  offices"); note that real records created during a session remain (don't delete
  them ad hoc — provision a fresh office instead).
- Use a fresh browser profile/incognito per participant so the first-run tour
  (which is `localStorage`-gated) shows every time.

---

## 8. Analysis & feedback loop

1. Tabulate success/time/SEQ per task; compute TTFRT, SUS.
2. Rank issues by **severity** (1 cosmetic → 4 task-blocker) × frequency.
3. Cross-check the observed drop-off against the activation funnel's biggest drop.
4. The **single biggest blocker becomes the next build** — close it, then re-test.
5. Log verbatim word/label confusions into the glossary / labels backlog
   (`glossary.ts`, `labels.ts`) and plain-language review.

Deliverable after the sessions: a short findings report (top 5 issues, TTFRT,
SUS, the one fix to do next) appended to the golden-path audit.

---

## 9. Logistics & ethics

- Consent form; recordings stored access-controlled, deleted after analysis.
- Use placeholder/synthetic data only — never real citizen PII on UAT.
- Offer the session in the participant's working language.
- Accessibility: include at least one participant who relies on keyboard or larger
  text if possible, to sanity-check the WCAG work on the new help/wizard UI.

---

## 10. Schedule (indicative)

| Day | Activity |
| --- | --- |
| 1 | Recruit & screen; provision 5 fresh tenants; dry-run with 1 pilot |
| 2 | Sessions P1–P3 (60 min each) |
| 3 | Sessions P4–P5; start analysis |
| 4 | Findings report + ranked fixes; pick the next build |
