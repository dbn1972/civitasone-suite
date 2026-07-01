# CivitasOne — Administrative & Physical Hierarchy Model

## Two Separate Trees (Different Concerns)

| Tree | Service | Purpose | Example |
|------|---------|---------|---------|
| **Administrative** | `hrms-service` → `hrms_departments` | Who reports to whom; authority flow; file marking/routing | Ministry → Division → Section |
| **Physical** | `location-service` → `locations` | Where offices physically sit; LGD mapping; address | Delhi → CGO Complex → Room 401 |

**Relationship:** An administrative unit (`hrms_departments`) has an optional `location_id` pointing to its physical office. Multiple administrative units can share the same location (e.g. all Central Government ministries sit in Delhi).

---

## Administrative Hierarchy (`hrms_departments`)

### Schema

```
hrms_departments
├── id, tenant_id, code, name
├── parent_id        → self-referential tree
├── type             → edition-specific admin level (see below)
├── level            → numeric depth (0 = root)
├── govt_tier        → 'central' | 'state' | null
├── location_id      → cross-service ref to location-service (physical office)
├── head_employee_id → head of this unit
└── is_active
```

### Central Government (edition='govt', govt_tier='central')

CSMOP hierarchy. All offices physically in Delhi (shared location_id).

```
Ministry of Finance                      [type=ministry, level=0, location_id=<Delhi CGO>]
├── Department of Expenditure            [type=department, level=1]
│   ├── Controller General of Accounts   [type=attached_office, level=2]
│   │   └── Pay & Accounts Office        [type=subordinate_office, level=3]
│   ├── Budget Wing                      [type=wing, level=2]
│   │   ├── Establishment Division       [type=division, level=3]
│   │   │   ├── Section I               [type=section, level=4]
│   │   │   │   └── Desk A (Dealing)    [type=desk, level=5]
│   │   │   └── Section II              [type=section, level=4]
│   │   └── Finance Division            [type=division, level=3]
│   └── Director (Admin)                 [type=branch, level=2]
└── Department of Revenue                [type=department, level=1]
    └── CBDT                             [type=attached_office, level=2]
```

**Type vocabulary:** `ministry → department → attached_office / subordinate_office → wing → division → branch → section → desk`

**Physical location:** Most nodes share the same `location_id` pointing to Delhi/New Delhi (CGO Complex, North Block, etc.). Attached/subordinate offices outside Delhi get their own location.

---

### State Government (edition='govt', govt_tier='state')

State Secretariat hierarchy. Offices spread across the state.

```
Home Department                          [type=department, level=0, location_id=<Secretariat, Bhubaneswar>]
├── Directorate of Prisons               [type=directorate, level=1, location_id=<Directorate Bldg>]
│   ├── Central Jail, Berhampur          [type=district_office, level=2, location_id=<Berhampur>]
│   └── Special Jail, Jharpada           [type=district_office, level=2, location_id=<Bhubaneswar>]
├── Police HQ                            [type=directorate, level=1, location_id=<Police Bhawan>]
│   ├── Crime Branch                     [type=division, level=2]
│   │   └── Cyber Section               [type=section, level=3]
│   └── Traffic Division                 [type=division, level=2]
└── Home (General) Section               [type=section, level=1, location_id=<Secretariat>]
    └── Dealing Hand                     [type=desk, level=2]
```

**Type vocabulary:** `department → directorate → district_office → division → section → desk`

**Physical location:** Each directorate / district office has its own `location_id` (spread across the state). Secretariat sections share the state capital location.

---

### PSU — Public Sector Undertaking (edition='psu', govt_tier=null)

Corporate hierarchy. Zonal offices across the country.

```
NTPC Limited                             [type=company, level=0, location_id=<NTPC Tower, Delhi>]
├── Northern Zone                        [type=zone, level=1, location_id=<Delhi Zonal Office>]
│   ├── Singrauli Region                 [type=region, level=2, location_id=<Singrauli>]
│   │   ├── Vindhyachal STPS            [type=unit, level=3, location_id=<Vindhyachal Plant>]
│   │   │   ├── O&M Department          [type=department, level=4]
│   │   │   │   └── Boiler Section      [type=section, level=5]
│   │   │   └── HR Department           [type=department, level=4]
│   │   └── Rihand STPS                 [type=unit, level=3, location_id=<Rihand>]
│   └── Dadri Region                    [type=region, level=2, location_id=<Dadri>]
└── Western Zone                         [type=zone, level=1, location_id=<Mumbai Zonal>]
```

**Type vocabulary:** `company → zone → region → unit → department → section`

**Physical location:** Each zone/region/unit has its own location (geographically spread). HQ is typically Delhi/Mumbai.

---

### Small Office / Section 8 Company (edition='small_office', govt_tier=null)

Flat hierarchy. 1–3 offices.

```
ABC Foundation                           [type=organisation, level=0, location_id=<Main Office>]
├── Programs Department                  [type=department, level=1]
│   └── Field Operations                 [type=section, level=2]
├── Finance Department                   [type=department, level=1]
└── Admin Department                     [type=department, level=1]
```

**Type vocabulary:** `organisation → department → section`

**Physical location:** Usually a single `location_id` for the whole org, or 2–3 branches.

---

## Physical Hierarchy (`location-service` → `locations`)

Models where offices **physically sit**. LGD-coded for India government digital integration.

```
locations (type: state | district | block | ward | office | facility | branch)
```

### Central Government — Delhi-centric

```
Delhi (NCT)                              [type=state, lgd_code=07]
├── New Delhi                            [type=district, lgd_code=0742]
│   ├── CGO Complex                      [type=office]
│   ├── North Block (Finance Ministry)   [type=office]
│   ├── South Block (Defence/External)   [type=office]
│   └── Shastri Bhawan                   [type=office]
└── Central Delhi                        [type=district]
    └── Rail Bhawan                      [type=office]
```

### State Government — Capital + Districts

```
Odisha                                   [type=state, lgd_code=21]
├── Khordha                              [type=district, lgd_code=2118]
│   ├── State Secretariat                [type=office]
│   ├── Police Bhawan                    [type=office]
│   └── High Court Complex               [type=facility]
├── Ganjam                               [type=district, lgd_code=2104]
│   └── Collectorate, Berhampur          [type=office]
└── Cuttack                              [type=district, lgd_code=2103]
    └── Ravenshaw University             [type=facility]
```

---

## How They Link

```
┌────────────────────────────────────┐    ┌─────────────────────────────────┐
│ hrms_departments                   │    │ locations                        │
│ (Administrative authority tree)    │    │ (Physical geography tree)        │
│                                    │    │                                  │
│ Ministry of Finance ───────────────┼──→ │ North Block (type=office)        │
│   └── Dept of Expenditure ─────────┼──→ │ North Block (same office)        │
│       └── Pay & Accounts Office ───┼──→ │ CGO Complex (different office)   │
│                                    │    │                                  │
│ Home Dept (State) ─────────────────┼──→ │ State Secretariat, BBSR          │
│   └── Directorate of Prisons ─────┼──→ │ Directorate Bldg, BBSR           │
│       └── Central Jail Berhampur ──┼──→ │ Jail Complex, Berhampur          │
└────────────────────────────────────┘    └─────────────────────────────────┘
         Many:1 relationship
    (multiple admin units can share one physical location)
```

---

## Key Design Decisions

1. **Single source of truth for org hierarchy = `hrms_departments`** (not duplicated in estab/finance/etc.)
2. **Cross-service reference by UUID** — other services (estab, finance, procurement) reference `hrms_departments.id` the same way they reference employees.
3. **`govt_tier` distinguishes Central vs State** at the root level. A tenant may have both (e.g. a Union Territory administers both central and state functions).
4. **`location_id` is optional and many:1** — Central Government departments share one Delhi location; State Government offices are geographically distributed.
5. **Type vocabulary is edition-dependent** — the `type` column holds strings whose valid vocabulary depends on `tenant.edition` + `dept.govt_tier`. Enforcement is in domain logic, not a DB constraint (flexibility for edge-case tenants).
6. **`level` enforces hierarchy ordering** — a child's level must be > parent's level. No section can parent a ministry.
