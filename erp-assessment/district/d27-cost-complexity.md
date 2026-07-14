# D27 — Cost & Complexity Estimate

**Lane L10 · Review Board Chair · 2026-07-13 · Branch: court-management-service**

> Effort bands are in engineer-sprints (2-week sprints, 1 sprint = 1 senior engineer for 2 weeks). Sizing: XS=<0.5 sprint, S=0.5–1, M=1–2, L=2–4, XL=4–8, XXL=8+. Cost assumes ₹80,000/sprint senior full-stack engineer loaded cost (on-shore govt vendor rate in 2026). All figures are rough-order-of-magnitude (±40%).

---

## Workstream Summary Table

| # | Workstream | T-Shirt | Sprint Estimate | ₹ Estimate | Complexity | Biggest Risk | Phase |
|---|---|---|---|---|---|---|---|
| 1 | **Org model (offices/positions/postings/hierarchy migration)** | **XL** | 8–12 | ₹6.4–9.6L | Architecture-critical; cascades to all services | Scope creep from state-specific hierarchy variants | P0 |
| 2 | **Security hardening (Wave 2 RLS, route-writes, BYPASSRLS, DB ownership)** | **L** | 4–6 | ₹3.2–4.8L | Mechanical but high-blast-radius | Regression on 38 services; must run full test suite | P0 |
| 3 | **Backup / PITR per cell** | **M** | 2–4 | ₹1.6–3.2L | Infra (IaC), not application code | WAL archiving config per PG version; DR drill schedule | P0 |
| 4 | **Cell registry + tenant-router wiring (38 services)** | **XL** | 6–10 | ₹4.8–8.0L | Large but mechanical; every service touched | DB connection pool management under load | P0 |
| 5 | **Coordination-service (DM↔SP workflows, disaster, force-requisition)** | **XXL** | 10–16 | ₹8.0–12.8L | Domain-complex; 7 new L2 modules, 16 workflows, 10 event topics | Getting DM + SP business-process alignment before coding | P0 |
| 6 | **Scheme-registry + ministry authority model** | **L** | 4–6 | ₹3.2–4.8L | Domain-complex (central scheme rules); involves PFMS API | Per-ministry data-sharing agreement negotiation | P0/P1 |
| 7 | **Police-admin service (hierarchy + duty-roster + deployment + arms-register)** | **XXL** | 12–18 | ₹9.6–14.4L | New domain with security constraints; CERT-In compliance | Police hierarchy configuration varies by state (commissionerate vs non-commissionerate) | P1 |
| 8 | **Police/Treasury dedicated cells (infra + provisioning + migration)** | **XL** | 6–10 | ₹4.8–8.0L | Infrastructure-heavy (Terraform + Ansible + Helm) | CERT-In network security compliance validation | P1 |
| 9 | **Identity federation (Keycloak per-cell realm + state IdP)** | **L** | 3–5 | ₹2.4–4.0L | Keycloak realm federation is well-understood but fiddly | Keycloak upgrade compatibility; SAML protocol quirks with NIC SSO | P1 |
| 10 | **Config-engine expansion (metadata-service + vocabulary migration)** | **XXL** | 10–16 | ₹8.0–12.8L | Touches 32/38 services; high regression risk | Vocabulary migration correctness; metadata-service must be production-stable before migrating all enum references | P1 |
| 11 | **Gov-adapters expansion** (CPGRAMS, CCTNS, ICJS, LGD, land-records, IFMS, DigiLocker, PFMS-inbound) | **L** | 4–8 | ₹3.2–6.4L | Each adapter is M effort; protocol variance per state | CCTNS/ICJS statutory access approval timeline (MHA); state IFMS API availability | P0/P1 |
| 12 | **Event envelope + 45 new event topics** | **M** | 3–4 | ₹2.4–3.2L | Additive envelope change is safe; new topics need cross-team coordination | Consumer chain testing for all 45 new topics | P0 |
| 13 | **Government Integration Gateway (classification, purpose, mTLS, schema validation)** | **L** | 4–6 | ₹3.2–4.8L | Cross-cutting; touches gateway + policy-service | mTLS certificate management between cells | P0 |
| 14 | **Analytics / District + State dashboards** | **M** | 3–5 | ₹2.4–4.0L | Requires coordination-service events to exist first | Cross-cell aggregation performance at 640 districts × 10 departments | P1/P2 |
| 15 | **Operational readiness (DR drill, monitoring, alerting, runbooks)** | **L** | 3–5 | ₹2.4–4.0L | Process + tooling; not application code | DR drill process needs buy-in from hosting partner | P0/P1 |

---

## Phased Cost Summary

| Phase | Primary Workstreams | Sprint Total | ₹ Estimate | Calendar Time (6-engineer team) |
|---|---|---|---|---|
| **Phase-0** | Org model + security hardening + backup + cell registry + event envelope + GIG + CPGRAMS + coordination-service skeleton | **40–65 sprints** | **₹32–52L** | **8–12 months** |
| **Phase-1** | Collectorate ERP configuration + JWT enrichment + cert issuance + analytics dashboard | **12–18 sprints** | **₹9.6–14.4L** | **3–4 months** (overlaps P0 tail) |
| **Phase-2** | SDM/Tehsil + revenue recovery + land-records adapter + licensing-service + disaster SDM | **18–26 sprints** | **₹14.4–20.8L** | **4–6 months** |
| **Phase-3** | Police hierarchy + police-admin service + Police cell + coordination full build | **30–46 sprints** | **₹24–36.8L** | **6–8 months** |
| **Phase-4** | RD/Panchayat + scheme-registry + PFMS inbound + BDO/GP configuration | **15–22 sprints** | **₹12–17.6L** | **3–5 months** |
| **Phase-5** | metadata-service + 8 line dept configurations + automated onboarding | **25–36 sprints** | **₹20–28.8L** | **5–7 months** |
| **Phase-6** | State control plane + pool→silo migration + state reporting chains + 30 district rollouts | **35–55 sprints** | **₹28–44L** | **8–12 months** |
| **Phase-7** | Ministry adapters + DSA + national dashboards + DigiLocker/UMANG/NeSDA | **25–40 sprints** | **₹20–32L** | **6–10 months** |
| **TOTAL** | | **200–308 sprints** | **₹160–246L** | **36–48 months** |

---

## Top-5 Biggest Items (Flag for Architect Attention)

| Rank | Item | Why Big | Mitigation |
|---|---|---|---|
| 1 | **Coordination-service** (10–16 sprints) | 7 new L2 modules; 16 complex statutory workflows; DM + SP domain alignment required | Start with disaster + force-requisition only; add election + L&O in Phase-3 |
| 2 | **Police-admin service** (12–18 sprints) | New domain; CERT-In compliance; commissionerate topology variance; arms-register security requirements | Run in parallel with Police cell infra; start with HR-only (cadre, transfers, payroll config) |
| 3 | **Config-engine / metadata-service migration** (10–16 sprints) | 32/38 services must be refactored; high regression risk; must be stable before multi-state rollout | Build metadata-service first; migrate 1 service at a time in background |
| 4 | **State control plane + 30 district rollouts** (35–55 sprints) | One cell per state (~36 cells); provisioning automation; per-state hierarchy seed data; training | Automate district onboarding to <4 hours using install-wizard; hire state-specific field teams |
| 5 | **Org model** (8–12 sprints) | Cascades into every service; misbuilt org model = 12 months of rework; must be right first time | Spend 2 sprints on org model design review before implementation; get 3 state hierarchy domain experts to validate |

---

## Infrastructure Cost (Annual, Production)

| Component | Per Shared District Cell | Per Police/Treasury Silo Cell | State Control Plane | Notes |
|---|---|---|---|---|
| RDS PostgreSQL 16 Multi-AZ | ₹3–6L/year | ₹4–8L/year (larger) | ₹2–4L/year | db.r6g.xlarge → db.r6g.2xlarge |
| ElastiCache Redis 7 | ₹1.5–3L/year | ₹1.5–3L/year | ₹1L/year | 2 shards, 1 replica |
| ECS Fargate (38 services) | ₹4–8L/year | ₹3–5L/year (fewer services) | ₹2–4L/year | 0.5 vCPU / 1 GB per task |
| S3 + WAL archiving | ₹0.5–1L/year | ₹0.5–1L/year | ₹0.5L/year | 7-year retention |
| Keycloak + networking | ₹0.5–1L/year | ₹0.5L/year | ₹0.5L/year | — |
| **Per cell total** | **₹9.5–19L/year** | **₹9.5–17.5L/year** | **₹6–10L/year** | — |
| **National total (36 states, ~6 shared cells/state + police/treasury per state)** | — | — | — | **Estimate: ₹350–600L/year at full national rollout** |

> Note: NIC/MeitY NIC Cloud (MeghRaj) rates apply for GoI deployment; estimates above use approximate AWS AP-South-1 on-demand rates as a proxy. NIC Cloud rates are typically 30–40% lower.

---

## Complexity Rating by Dimension

| Dimension | Complexity | Why |
|---|---|---|
| Application architecture | **LOW** — existing pattern is clean | CQRS + outbox + RLS is well-established in this codebase |
| Org model implementation | **HIGH** — cascades to all services | Every service's request context, RLS policy, and data model is affected |
| Police domain | **HIGH** — statutory + security constraints | CERT-In, CCTNS boundary, commissionerate topology variance |
| Multi-state configurability | **HIGH** — 28 states × different terminology | Metadata-service must be stable first |
| Ministry integration | **MEDIUM** — well-defined APIs | PFMS and NIC APIs are documented; statutory approval process is the bottleneck |
| Infra scaling (640 districts) | **MEDIUM** — cell model is well-defined | Cell provisioning automation is the key investment |
| DR and operational maturity | **MEDIUM** — tooling exists | Process discipline and drill schedule are harder than tooling |
