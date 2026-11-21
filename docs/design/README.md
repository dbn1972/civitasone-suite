# CivitasOne Suite - Design Documentation

Code-grounded design documents for the CivitasOne Suite, generated from the codebase at build `0a5843762`. Every claim is source-tagged, and each document carries a gap appendix listing where the code diverges from intent. These are the review-corrected versions (a technical review pass was applied).

| Document | Description |
|---|---|
| [HLD.md](HLD.md) | High-Level Design: system context, module decomposition, major flows |
| [SAD.md](SAD.md) | Solution Architecture Document: architecture views, decisions, quality attributes |
| [LLD.md](LLD.md) | Low-Level Design: service internals, components, sequences, data flows |
| [CLOUD-ARCH.md](CLOUD-ARCH.md) | Cloud Architecture: deployment topology, HA/DR, observability |
| [INFRA-NETWORK.md](INFRA-NETWORK.md) | Infrastructure and Network Architecture: network zones, runtime topology |
| [SECURITY-ARCH.md](SECURITY-ARCH.md) | Security Architecture: authN/authZ, tenant isolation (RLS), trust zones |
| [DATA-ARCH.md](DATA-ARCH.md) | Data Architecture: schemas, ER views, outbox/CQRS, multi-tenancy |
| [INTEGRATION-ARCH.md](INTEGRATION-ARCH.md) | Integration Architecture: gateway request path, event flow, external integrations |

Diagrams are embedded inline as Mermaid blocks (rendered natively by GitHub). The standalone sources are in [diagrams/](diagrams/).

Word (.docx) versions are attached to the GitHub release `design-docs-2026-11-21`.

These documents supersede and correct drift in the older `docs/ARCHITECTURE.md` and related docs (which PR #2607 refreshes).
