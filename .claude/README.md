# Claude Code Prompts — CivitasOne Suite

This directory holds every reusable Claude Code prompt for backend (and full-stack) work.

**Read first:** [`/CLAUDE.md`](../CLAUDE.md) — always-on rules.

## Directory layout

```
.claude/
├── README.md                       (this file)
├── prompts/                        (workflow prompts — one per task type)
│   ├── 01-build-endpoint.md
│   ├── 02-build-screen.md
│   ├── 03-write-migration.md
│   ├── 04-write-event-handler.md
│   ├── 05-write-rbac-rule.md
│   ├── 06-write-installer-step.md
│   ├── 07-code-review.md
│   └── 08-release-gate.md
└── skills/                         (long-form domain knowledge)
    ├── 01-finance-double-entry.md
    ├── 02-procurement-workflows.md
    ├── 03-rbac-policy-language.md
    ├── 04-audit-event-spec.md
    ├── 05-multi-tenant-isolation.md
    ├── 06-installer-readiness-score.md
    ├── 07-queue-message-design.md
    ├── 08-accessibility-wcag-22.md
    └── 09-localisation-i18n.md
```

## How to use

1. Open the GitHub issue assigned to you.
2. Identify task type → open the matching `prompts/*.md` file.
3. Identify domain → open the matching `skills/*.md` file (often more than one).
4. Copy the workflow prompt template, fill placeholders with issue details.
5. Reference the skill file(s) in your prompt with `@.claude/skills/0X-name.md`.
6. Submit prompt to Claude Code. Iterate until tests pass.
7. Open PR. The `07-code-review.md` prompt runs as a GitHub Action review on every PR.
8. After sprint, `08-release-gate.md` runs to produce the sprint report.

## Rule

> Never write a freeform prompt. If your task does not fit any prompt here, add a new one to this directory in the same PR.
