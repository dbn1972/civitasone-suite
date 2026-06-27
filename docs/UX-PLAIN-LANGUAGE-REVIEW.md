# Plain-Language Review — CivitasOne for a No-Training Audience

**Audience:** a lower-level government office clerk setting up and using the system for the
first time, with no training and no IT background.

**Question this doc answers:** *Can a lower-level government office implement CivitasOne
without training?* — see the honest verdict at the end.

The guiding rule throughout: **write for a clerk, not an engineer.** If a word needs a
glossary, it needs a rewrite or a tooltip.

---

## 1. Words to change (UI term → plain-language replacement)

These are terms that show up in screens, labels, and buttons that a first-time clerk will
not understand. Replace them, or hide them entirely.

| Technical term (today) | Say this instead | Why |
| --- | --- | --- |
| Tenant | Your office / your organisation | "Tenant" means nothing to a clerk. They work in *an office*. |
| Entity / Record entity | Record (a bill, a file, a person) | Name the actual thing where possible. |
| Maker-checker | Submit for approval / Send for approval | Describes the action, not the pattern name. |
| RBAC / Roles / Policy | What people can do | Frame it as permissions in plain words. |
| Module enablement | Turn on the parts you use | "Enablement" is jargon. |
| Outbox / DLQ / Dead-letter queue | *(hide from users entirely)* | Internal plumbing. Never show to a clerk. |
| Readiness score / Production gates | Setup health / Is everything ready? | Reframe as a friendly status. |
| Sanction | **Keep** | Established government term; clerks know it. |
| Indent | **Keep**, add tooltip "a request to buy something" | Familiar in govt, but help the new joiner. |
| GRN | Goods received note (delivery check) | Spell it out at least once per screen. |
| UC / Utilisation Certificate | **Keep**, add tooltip "proof the money was spent correctly" | Known term, but clarify. |
| Empanelment | On our approved list | Plainer and clearer. |
| Beneficiary / Grantee | The person or group receiving the grant | Say who it is. |
| Revalidate / Idempotent / CQRS | *(hide — engineering only)* | Must never appear in the UI. |
| Disbursement | Payment / money released | Plainer synonym. |
| Org hierarchy | Your offices and branches | Describe what it is. |
| Breakglass access | Emergency access | Plain and self-explanatory. |

---

## 2. Recommendations (apply to every primary screen)

1. **One-line plain description under every title.** Each primary screen should say, in one
   warm sentence, what it is for and who it helps — e.g. "Add the people who will use the
   system and choose what each person can do." Avoid "API-backed list view" style copy.
2. **Every empty state says what to do next.** Don't just say "No records found." Say
   "No bills yet — add your first bill to get started" with a button to do it. An empty
   screen is the scariest moment for a new user; turn it into a friendly nudge.
3. **Every destructive action confirms in plain words.** Spell out what will happen and
   whether it can be undone — e.g. "This will archive this office. Archived offices are
   hidden and can't be picked for new records." Avoid "Confirm operation".
4. **Name the real thing, not the pattern.** "Send for approval", not "trigger maker-checker".
5. **Examples beside inputs.** Show a real example ("e.g. District Industries Centre,
   Bhubaneswar") so the clerk knows exactly what to type.
6. **Keep one known term + tooltip** rather than inventing new words for established govt
   terms (Sanction, Indent, UC). Familiarity beats cleverness.

---

## 3. What already does this well vs. what still uses jargon

**Doing it well**
- **Register Vendor form** (`/procurement/vendors/new`) — clear title and a plain subtitle
  ("Add a new vendor to the procurement directory").
- **Apply for leave** (HR) — task-named action in everyday language.
- **Locations / offices** (`/locations/list`, archive confirmation in `LocationActions`) —
  the archive confirmation now explains the consequence in plain words.
- **Dashboard "Command Center"** — modules are described in plain terms ("Budgets, bills,
  payments, GL"), though "GL" should be spelled out.
- **New: Getting Started wizard** (`/setup`) — plain, warm, step-by-step, skippable.

**Still using jargon (needs attention)**
- **Tenant Admin** screens — "Tenant", "Modules enablement", "Readiness score",
  "Production gates", "Breakglass". Reframe with the table above.
- **Finance** — "GL", "double-entry", "sanction/UC" without explanation. Needs a help layer.
- **Procurement** — "Indent", "GRN", "RFQ", "empanelment" appear without tooltips.
- **Operations / Admin** — "Outbox", "DLQ", "schedulers", "workers" leak internal plumbing
  into the UI. These should be hidden from ordinary office users.
- **Some list pages** still use developer copy like "Read-only list loaded from the Locations
  service API" as the description — rewrite for humans.

---

## 4. Assessment — Can a lower-level government office implement this without training?

Honest verdict, area by area:

| Area | Verdict | Notes |
| --- | --- | --- |
| **Onboarding / first-run setup** | **Yes** (with the new `/setup` wizard) | Step-by-step, plain language, examples, "do it later", visible progress. A clerk can get a workspace stood up unaided. |
| **Everyday data entry forms** | **Mostly yes** | Labels are largely plain (vendor, leave, locations). Needs consistent one-line descriptions and friendly empty states everywhere. |
| **Specialist modules (Finance double-entry, Procurement tender/RFQ)** | **Not yet — needs a help layer** | The concepts are genuinely specialised. Inline tooltips and short "what is this?" help are required before a non-specialist can operate them confidently. |
| **Admin / Operations** | **Not for ordinary clerks** | Exposes internal plumbing (outbox, queues, readiness gates). Fine for IT admins; hide or simplify for office users. |

**Overall:** A clerk can now *set up* the workspace and handle *routine* data entry without
training. They cannot yet safely run the *specialist* finance and procurement workflows
without a help layer. We are roughly 70% of the way to true zero-training.

### Top 5 things still needed for true zero-training

1. **Inline help tooltips** on every specialist term (Sanction, Indent, GRN, UC, GL) — a
   small "?" that explains the word in one plain sentence.
2. **A `/help/{module}` link** on every module — a short, plain-language "how this works"
   page reachable from the screen the clerk is on.
3. **Guided empty states** everywhere — every blank list should explain the next action and
   offer a button, not just say "no data".
4. **A sample-data toggle** — let a new office switch on safe example records to explore and
   learn, then clear them with one click.
5. **A short in-app tour** — a 4–5 step coach-mark walkthrough on first login for each major
   module, building on the `/setup` wizard.
