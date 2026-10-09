# ADR-0022: Deployment shape for a non-Node service (the solver)

- **Status:** Accepted
- **Decision id:** D-ST-22 (APPROVED, approval log 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** SRE lead; programme owner dbn1972 (approved)
- **Spec:** §7 (allocation engine is a separate bounded service); §15 (performance); §18 M01
- **Related:** D-ST-05/06 (solver runtime & licensing, **PROPOSED** — see [open-items.md](../open-items.md));
  delivered in part by **ST-M01-01** (docker-build fix) and **ST-M01-13** (solver spike)

## Context

The stack is **Node only**: no JVM or Python runtime, no solver library, PM2 has no JVM concept, and the Helm
`deployment.yaml` hard-codes `command: ["node", entry]` (M00 §1.14, §4.2, verified on `origin/main` `9d4fa95e5`). CI's
docker-build matrix references `services/<svc>/Dockerfile`, but **no such file exists** (count 0 on `origin/main`); only
the root `./Dockerfile` (with `ARG SERVICE`) and `apps/web/Dockerfile` exist, and the matrix covers 33 of 67 services
(M00 §1.14 defect 1).

The allocation solver may be a non-Node (JVM / CP-SAT sidecar) process (spec §7; M00 §4.1). It is stateless, holds no
tenant DB credentials, is queue-driven, and has no public gateway route.

## Decision

If a non-Node solver is chosen, it gets its **own Dockerfile, its own Helm template and its own CI job** — and the
existing **docker-build matrix defect is fixed first** (ST-M01-01: use the root Dockerfile with `--build-arg SERVICE`
and cover all services).

- The solver runs **outside PM2** (PM2 has no JVM concept), as a dedicated Helm-templated deployment (`solver.yaml`
  pattern), not as a `node` entry.
- It is queue-driven on `smarttransfer.solve.requested` / `smarttransfer.solve.completed`
  (see [event-list](../event-list.md)) and connects to no tenant database (spec §7; M00 §4.1).
- Security posture: non-root, read-only root filesystem, network-restricted to the queue and the snapshot bucket, signed
  images, Trivy + (if JVM) Java dependency scanning, SBOM (M00 §8.7).

**Which** solver runtime (and its licensing/hosting posture) is **NOT decided here** — that is D-ST-05/06, which are
**PROPOSED** and close on the ST-M01-13 spike data (see [open-items.md](../open-items.md)). This ADR fixes only the
**deployment shape** for a non-Node service, independent of the engine chosen, because the solver sits behind a
`SolverPort` (M00 §4.1).

## Consequences

- The docker-build fix (ST-M01-01) is a prerequisite for shipping **any** new service image, Node or not.
- A JVM/CP-SAT image needs its own CI build+scan lane; the default TS baseline (D-ST-05 default) needs none of this and
  deploys as an ordinary Node worker.
- Hosting a JVM image in an on-prem / air-gapped NIC/State Data Centre is a D-ST-06 concern, still **OPEN**.

## Alternatives considered

- **(b) Run the solver as a sibling process outside PM2 without its own Helm template / CI job** — rejected: it would
  not be independently buildable, scannable or deployable, and would not fix the matrix defect that blocks all new
  images.
