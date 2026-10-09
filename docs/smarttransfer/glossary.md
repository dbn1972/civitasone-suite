# SmartTransfer OS — glossary

> Spec §4 (Universal domain model). Owning service and placement kind for every term.
> Baseline: `origin/main` `9d4fa95e5`.

The spec (§4) requires four kinds of placement to stay separate:

- **Substantive appointment** — the employee's permanent post (one substantive holder per post).
- **Temporary attachment** — a non-substantive link (acting / additional / in-charge).
- **Operational assignment** — a work assignment that does not change the substantive post.
- **Actual physical joining** — the recorded fact that a person has physically taken charge.

"Owner" below is the service that owns the row and its state-transition authority (spec §4: "Every entity has a
defined owning service and a state-transition authority"). Two owners appear in M01:

- **Workforce Core** — a licensable module profile of `hrms-service` ([ADR-0023](adr/0023-standalone-packaging.md)),
  with its new tables in their own schema so they are liftable later. Owns people, posts, occupancy, cadre, office tree.
- **SmartTransfer** — `services/smarttransfer-service` (built in ST-M01-12). Owns the movement entities only and
  never writes Workforce Core tables ([ADR-0010](adr/0010-hrms-write-boundary.md)).

## Organisational entities (spec §4)

| Term | Definition | Owner | Notes |
|---|---|---|---|
| Tenant | A cycle-owning authority (e.g. a state government). One tenant per authority ([ADR-0004](adr/0004-tenancy-topology.md)). | tenant-service | Existing. `tenant-service/src/modules/tenant/schema.ts:9-41`. |
| Government Organisation | A government body within a tenant. | Workforce Core | Modelled as the top of the department tree ([ADR-0002](adr/0002-office-hierarchy-owner.md)). |
| Department | An administrative department. | Workforce Core | `hrms-service` `employee.hrms_departments` (`employee/schema.ts:8-25`). |
| Organisational Unit | A sub-unit of a department. | Workforce Core | Office tree node ([ADR-0002](adr/0002-office-hierarchy-owner.md)). |
| Office | A physical/administrative office that holds posts. | Workforce Core | Office dimension of a post; today `hrms_departments` conflates department and office (STANDALONE §8, D-ST-02). An explicit office flag/type is OPEN under D-ST-02. |
| Establishment | The sanctioned set of posts for an office. | Workforce Core | **Not** `estab-service` (that is the eOffice backend and owns no posts — M00 §0.3). |
| Geographic Jurisdiction | An administrative-area scope (district/division/LGD unit). | location-service | `location-service/.../jurisdiction/routes.ts:12-35`. Mapped to the office tree ([ADR-0002](adr/0002-office-hierarchy-owner.md)). |
| Location | A place reference (station, city). | location-service / Workforce Core | Free-text `station` + unlinked `location_id` on the employee today (`employee/schema.ts:46-48`). |
| Sanctioned Position (Post) | A single sanctioned position: office, designation, cadre, grade, attributes, status. | Workforce Core | **BUILD** (ST-M01-07). Four unlinked fragments exist today ([ADR-0001](adr/0001-post-and-occupancy-owner.md); M00 §1.4). |
| Position Requirement | Qualification / specialisation / eligibility attributes a post requires. | Workforce Core | Attribute set on the post. Qualification tables are orphaned today (`lifecycle/schema.ts:175-198`, no readers/writers — M00 §1.3). |
| Occupancy | Effective-dated record of who holds a post, with charge type. One substantive holder per post. | Workforce Core | **BUILD** (`post_occupancy`, ST-M01-07). Prior art: `hierarchy.postings` unique substantive index (`location-service/migrations/0005a_org_model.sql:159-161`), unreachable for writes. |
| Staffing Requirement | Minimum staffing for an office/unit. | Workforce Core | **BUILD**. Legacy counters only (`manpower.plans`). |

## Workforce entities (spec §4)

| Term | Definition | Owner | Notes |
|---|---|---|---|
| Employee / Personnel Record | The person master. | Workforce Core | Existing current-state row, not effective-dated (`employee/schema.ts:41-109`). |
| Employment Relationship | The link between a person and their employment. | Workforce Core | Current `department_id`/`designation_id`/`manager_id` on the employee row. |
| Service Category | Statutory category (e.g. SC/ST/OBC/general). | Workforce Core | `category` column (`employee/schema.ts:89-95`). |
| Cadre | The cadre master and the employee-cadre link. | Workforce Core | **BUILD** (ST-M01-07). Free text in four places today ([ADR-0003](adr/0003-cadre-master-owner.md)). |
| Rank / Grade | Pay level / grade. | Workforce Core | Designation/grade (`employee/schema.ts:27-39`). |
| Designation | Post title. | Workforce Core | `hrms_designations`. |
| Trade / Specialisation | Sector-specific specialisation (subject, speciality, trade). | Workforce Core | Attribute; sector packs are M07, OPEN. |
| Qualification | Formal qualification. | Workforce Core | Orphaned tables today (M00 §1.3). |
| Skill / Competency | A competency. | Workforce Core | Competency module keyed by role code, not post (EXTEND, M00 §1.3). |
| Eligibility Attribute | Any attribute used by an eligibility rule (tenure, spouse, medical, disability, hardship). | Workforce Core | Spouse/medical/hardship attributes are **BUILD** (M00 §3). |
| Posting History (Posting Ledger) | Effective-dated history of postings; tenure derivable. | Workforce Core | **BUILD** (`posting_ledger`, ST-M01-07). Today `applyTransferEffect` overwrites the employee row (`lifecycle/repo.ts:321-333`); no tenure computation. |
| Service Tenure | Time at a station/post, derived from the posting ledger. | Workforce Core | Derived; no computation exists today (M00 §1.3). |
| Reporting Relationship | Manager / reporting chain. | Workforce Core | `manager_id` (`employee/schema.ts`). |

## Movement entities (spec §4) — owned by SmartTransfer ([ADR-0010](adr/0010-hrms-write-boundary.md))

| Term | Definition | Owner | Notes |
|---|---|---|---|
| Movement Policy | A set of movement rules (eligibility, tenure, priority, scoring). | SmartTransfer | Rule-pack content & engine are PROPOSED (D-ST-07) — **OPEN**. |
| Policy Pack | A versioned, signed bundle of movement policy for a sector/department. | SmartTransfer | Sector packs are M07 — **OPEN**. |
| Movement Type | One of the 20 configurable movement types (spec §5). | SmartTransfer | Config, not code (spec §5). |
| Transfer Cycle | A time-boxed transfer exercise with a calendar and windows. | SmartTransfer | See [state machines](state-machines.md#cycle). |
| Eligibility Evaluation | Per-employee result: which grounds and posts are legal, with rule citations. | SmartTransfer | Depends on the policy engine (D-ST-07) — **OPEN**. |
| Employee Preference | An employee's ranked choice list for a cycle. | SmartTransfer | |
| Transfer Request | An employee or administrative request to move. | SmartTransfer | SmartTransfer holds its own request state; it does not rely on workflow callbacks for "returned" (M00 §1A, FF-11). |
| Allocation Scenario | A named what-if configuration of a run. | SmartTransfer | |
| Allocation Run | One execution of the solver over a frozen snapshot. | SmartTransfer | Solver runtime is PROPOSED (D-ST-05/06) — **OPEN**. |
| Recommended Assignment | A proposed employee→post assignment with constraint justification. | SmartTransfer | |
| Exception Request | A request to deviate from a rule / proposed outcome. | SmartTransfer | Override policy is PROPOSED (D-ST-18) — **OPEN**. |
| Approval | A competent-authority approval of a list/order. | SmartTransfer + eOffice | Approval path is PROPOSED (D-ST-08) — **OPEN**. |
| Movement Order | A signed order effecting a move. | SmartTransfer | Signing is PROPOSED (D-ST-12) — **OPEN**; interim label "system generated, not digitally signed". |
| Relieving Record | The fact and date an employee was relieved from the source. | SmartTransfer | |
| Joining Record | The fact and date an employee joined the destination. | SmartTransfer | |
| Representation / Appeal | A first-class appeal against a decision. | SmartTransfer | Appeal windows are PROPOSED (D-ST-18) — **OPEN**. |
| Reconciliation Record | The record that HRMS and Payroll received effective-dated updates. | SmartTransfer | Payroll scope is PROPOSED (D-ST-13/14) — **OPEN**. |
| Decision Evidence | The immutable evidence bundle for an allocation decision (spec §7.3). | SmartTransfer | Snapshot hash, rule-pack hash, solver version, seed, validator result. |

## Supporting terms

| Term | Definition | Reference |
|---|---|---|
| `applyPosting` | The single HRMS command that changes a posting. Idempotent on order id. | [ADR-0010](adr/0010-hrms-write-boundary.md); ST-M01-09. |
| Snapshot | An immutable, hashed as-of extract of the workforce used by a run. | Spec §7.3; M00 §6.4. |
| Hold | A legal block on a move (court stay, vigilance, DE, medical/spouse priority). | `hrms_employee_holds` (`lifecycle/schema.ts:212-232`); consumption is PROPOSED (D-ST-16) — **OPEN**. |
| `defineContract` | The event-contract DSL (`packages/events/src/contracts/define.ts`). | [ADR-0019](adr/0019-event-contract-policy.md); ST-M01-06. |
| `command-result` | The command-outcome channel adopted from day one (D-20). | `packages/outbox/src/command-result.ts`. |
| Workforce Core | Licensable module profile of `hrms-service`. | [ADR-0023](adr/0023-standalone-packaging.md). |
