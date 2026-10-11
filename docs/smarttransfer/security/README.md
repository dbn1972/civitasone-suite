# SmartTransfer OS — Security & Privacy docs

Deliverable 15 of spec §19 (Security and privacy architecture), delivered incrementally per
milestone. Platform baseline: [`docs/SECURITY.md`](../../SECURITY.md).

| Doc | Scope | Status |
|---|---|---|
| [`threat-model.md`](threat-model.md) | STRIDE over the SmartTransfer data flows (portal/command centre → gateway → smarttransfer-service → `applyPosting` → payroll; eOffice loop-back; solver/policy sidecars; evidence store) and the trust boundaries | M01; independent review PENDING |
| [`privacy-impact-assessment.md`](privacy-impact-assessment.md) | Data inventory of personal fields, purpose, retention, access, DPDP Act 2023 considerations | M01 (facts recorded); legal/DPO review PENDING |

These are living documents (SECURITY.md §5): every PR that adds a data flow, a personal field, or a
new consumer updates them. They do not certify compliance — the builder never certifies its own
security work (spec §P09) and legal items are routed to Legal/the DPO.
