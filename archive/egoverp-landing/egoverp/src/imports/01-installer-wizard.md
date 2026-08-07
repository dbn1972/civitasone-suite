# Platform — Installer Wizard

**SPRINT:** 1 (stages 1–3), Sprint 3 (stages 4–10)
**ROUTE:** `/install`
**EDITION:** All (installer is the same regardless of edition)
**PRIMARY ROLE:** Installation Operator

---

## Figma Make prompt

```
Generate the Installation Wizard for CivitasOne Suite.

PURPOSE: Guide an installer through 10 stages from "fresh server" to "production-ready
with readiness score ≥ 85". Source of truth: Vol 11 §5.

LAYOUT: InstallerShell — left rail with stepper, right pane with current step content

STAGES (left rail):
1. Deployment mode (AWS managed | On-premises Kubernetes | On-premises VMs)
2. Architecture sizing (Small | Medium | Enterprise | HA — calculator with org-size inputs)
3. Adapter selection (DB, storage, cache, queue, CDN — each with options)
4. Environment validation (run connectivity tests for every adapter)
5. Secrets and security baseline (entry of credentials, TLS, password policy)
6. Initial admin creation (super-admin account, MFA enrolment forced)
7. Service bootstrap (one-click — shows live log + per-service status pills)
8. Health verification (every service /health green, replica counts met)
9. Enterprise Readiness Score (gauge 0–100, breakdown by category, must reach ≥ 85)
10. Go-live handoff (download install report, runbook, credentials envelope)

EACH STAGE LAYOUT:
- Step number + name (text.h2)
- Short purpose paragraph (text.body)
- Form / interactive content for the step
- Inline help drawer trigger ("What is this?" link)
- Action footer: Back, Save and continue, Skip (only where allowed)

STATES:
- Pending (step in left rail, neutral)
- Active (step in left rail, intent.primary, with progress dot)
- Complete (step in left rail, intent.success with checkmark)
- Error (step in left rail, intent.danger with X icon)
- Blocked (step in left rail, intent.warning with lock icon — explains why)

VALIDATION FAILURE PATTERN (Vol 11 §11):
- Stop immediately
- Show ErrorState with: what failed, why it failed (plain language),
  remediation steps (numbered), retry button, "show technical details" expand
- Never advance past a failed validation

READINESS SCORE PRESENTATION (stage 9):
- Large gauge widget (0–100)
- Color: <70 danger, 70–84 warning, ≥85 success
- Breakdown table: category | score | weight | contribution
  Categories: Security, Reliability, Observability, Backup/DR, Performance,
              Documentation, Operational Hygiene
- Each row expandable to show checks performed and their result
- Primary action only enabled when score ≥ 85

STATES + RESPONSIVE:
- Mobile: left rail collapses to top accordion (one stage visible at a time)
- All states from master template required

ACCESSIBILITY:
- Stepper has role="navigation" aria-label="Installation stages"
- Each stage has aria-current="step" when active
- Live log in stage 7 uses aria-live="polite"
- Readiness gauge has aria-valuenow, aria-valuemin=0, aria-valuemax=100

OUT OF SCOPE:
- Multi-region deployment topology (Phase 2)
- Air-gapped install offline package (Phase 2 — separate prompt)
```
