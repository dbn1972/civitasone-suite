# Court Management Service — Prompt Suite

This folder contains the **execution prompts** for building the CivitasOne Court Management Service
as a world-class, national-scale adjudication platform. It is designed to be run by Claude Code (or
any capable coding agent) as a **virtual expert team**.

## Contents
| File | Role | Standard |
|---|---|---|
| `00-master.md` | **Master orchestrator** — run this first | — |
| `01-cto-google.md` | CTO — strategy, standards, phase gates G0–G5, final sign-off | Google |
| `02-product-manager-apple.md` | Product Manager — stories, acceptance criteria, prioritization | Apple |
| `03-solution-architect.md` | Solution Architect — bounded contexts, config engine, data/events/APIs | — |
| `04-cloud-architect.md` | Cloud Architect — tenancy, scale, HA/DR, observability, security infra | — |
| `05-engineering-google.md` | Staff Engineers — implement modules (CQRS), APIs, integrations, tests | Google |
| `06-designer-figma.md` | Designer — screens, dashboards, a11y, multilingual, config-driven UI | Figma |
| `07-qa-microsoft.md` | QA Lead — invariant suite, security/a11y/perf/DR/UAT, release gate | Microsoft |

Sibling references (one level up):
- `../REQUIREMENTS.md` — the 59-section product specification (source of truth).
- `../EVALUATION.md` — architecture evaluation, ERP reuse map, risks, phasing.

The working code foundation lives at `services/court-service/` (chassis + core schema with `FORCE`
RLS + a `case-registry` working slice).

## How to run
1. **Start with `00-master.md`.** It defines the team, the six phases (0–5), the phase gates, and the
   non-negotiable house rules every role inherits.
2. For each phase, invoke the role prompts **in the master's order** as specialist agents, feeding each
   `REQUIREMENTS.md` + `EVALUATION.md` + the prior role's output.
3. Do **not** advance a phase until its **CTO gate** passes (each gate is a concrete checklist in `01`).
4. All work happens on the git branch **`court-management-service`** (isolated — never touch `main`).

## The three ideas that make this world-class (and hard)
1. **Nothing hardcoded (spec §47/§57.19).** Court types, case types, lifecycles, fees, limitation,
   hierarchy, templates are versioned *configuration* in a metadata/rule engine — built **before** any
   domain module. This is what makes it a platform, not an app.
2. **Reuse the ERP; own only court logic (§4.1).** Integrate with the real identity/policy, workflow
   (BPMN/DMN), estab/eOffice, notification, finance, audit services and the shared packages — don't
   rebuild them.
3. **Verify, then claim.** Every deliverable ships with a test that failed before and passes after, run
   as the least-privileged `court_svc` role so tenant-isolation failures are actually visible. This is
   the antidote to "green while broken."

## Guardrails carried by every role
`ENABLE`+`FORCE` RLS + tenant-scoped-transaction GUC on every table · money = BigInt paise · PII =
`encryptedText()` · immutable audit on every §41 action · CQRS 7-file module anatomy · AI assists but
**never issues a final order** (§35.5) · human authority, due process, and evidentiary integrity are
non-negotiable (§59).
