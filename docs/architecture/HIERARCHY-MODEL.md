# CivitasOne — Organisation & Administrative Hierarchy Model

## Editions (Product Tiers)

| Edition | Who uses it | Examples |
|---------|-------------|----------|
| `govt` | Government departments at any level | Ministry of Finance, Odisha Home Dept, Municipal Corporation |
| `psu` | Public Sector Undertakings | NTPC, BHEL, SBI, State Transport Corp |
| `private` | Private companies | Tata Motors, Infosys, any Pvt Ltd / Ltd / LLP |
| `ngo` | Non-governmental organisations | Registered Society, Trust, CBO |
| `section8` | Section 8 Companies (non-profit corporate) | NASSCOM Foundation, Pratham |
| `cooperative` | Cooperative Societies | Amul (GCMMF), IFFCO, State Cooperative Banks |
| `small_office` | Micro enterprises / individual professionals | CA firm, law office, sole proprietor |

## Government Sub-Types (`govt_tier`)

When `edition = 'govt'`, the `govt_tier` on `hrms_departments` specifies WHICH kind of government body:

| `govt_tier` | What it is | Example |
|-------------|-----------|---------|
| `central` | Union Government (Central Secretariat, CSMOP) | Ministry of Finance, MoD, MEA |
| `state` | State Government (State Secretariat) | Odisha Home Dept, TN Finance Dept |
| `local_body` | Urban/Rural Local Body | Municipal Corporation, Zila Parishad, Panchayat |
| `statutory_body` | Created by Act of Parliament/Legislature | SEBI, RBI, Election Commission, CAG |
| `autonomous_body` | Government-funded but operationally independent | ICAR, UGC, AIIMS, IITs, CSIR labs |

---

## Two Trees (Same Design, Different Concerns)

| Tree | Service | Models | Links via |
|------|---------|--------|-----------|
| **Administrative** | `hrms-service` → `hrms_departments` | Authority / reporting / hierarchy | `department_id` UUID on all services |
| **Physical** | `location-service` → `locations` | Where offices physically sit | `location_id` UUID on `hrms_departments` |

---

## Administrative Hierarchy per Organisation Type

### 1. Central Government (`edition='govt'`, `govt_tier='central'`)

CSMOP: Central Secretariat Manual of Office Procedure.

```
Ministry of Finance                          [type=ministry, level=0]
├── Department of Expenditure                [type=department, level=1]
│   ├── Controller General of Accounts      [type=attached_office, level=2]
│   │   └── Pay & Accounts Office           [type=subordinate_office, level=3]
│   ├── Budget Wing                          [type=wing, level=2]
│   │   ├── Establishment Division           [type=division, level=3]
│   │   │   ├── Section I                   [type=section, level=4]
│   │   │   │   └── Desk A                  [type=desk, level=5]
│   │   │   └── Section II                  [type=section, level=4]
│   │   └── Finance Division                [type=division, level=3]
│   └── Director (Admin)                     [type=branch, level=2]
└── Department of Revenue                    [type=department, level=1]
    └── CBDT                                 [type=attached_office, level=2]
```

**Type vocabulary:** `ministry | department | attached_office | subordinate_office | wing | division | branch | section | desk`

**Physical:** All in Delhi (shared `location_id` → North Block / CGO Complex / Shastri Bhawan)

---

### 2. State Government (`edition='govt'`, `govt_tier='state'`)

```
Home Department                              [type=department, level=0]
├── Directorate of Prisons                   [type=directorate, level=1]
│   ├── Central Jail, Berhampur              [type=district_office, level=2]
│   └── Special Jail, Jharpada              [type=district_office, level=2]
├── Police HQ                                [type=directorate, level=1]
│   ├── Crime Branch                         [type=division, level=2]
│   │   └── Cyber Section                   [type=section, level=3]
│   └── Traffic Division                     [type=division, level=2]
└── Home (General) Section                   [type=section, level=1]
    └── Dealing Hand                         [type=desk, level=2]
```

**Type vocabulary:** `department | directorate | regional_office | district_office | division | section | desk`

**Physical:** Secretariat in state capital; directorates/districts spread across state (each gets own `location_id`)

---

### 3. Local Body (`edition='govt'`, `govt_tier='local_body'`)

Municipal Corporation / Zilla Parishad / Gram Panchayat.

```
Bhubaneswar Municipal Corporation            [type=corporation, level=0]
├── Engineering Department                   [type=department, level=1]
│   ├── South Zone                           [type=zone, level=2]
│   │   └── Ward 42 Office                  [type=ward_office, level=3]
│   └── North Zone                           [type=zone, level=2]
├── Health Department                        [type=department, level=1]
│   └── Sanitation Section                   [type=section, level=2]
└── Revenue Department                       [type=department, level=1]
    └── Tax Collection                       [type=section, level=2]
```

**Type vocabulary:** `corporation | council | panchayat | department | zone | ward_office | section | desk`

---

### 4. Statutory Body (`edition='govt'`, `govt_tier='statutory_body'`)

SEBI, RBI, Election Commission, CAG.

```
Securities and Exchange Board of India       [type=board, level=0]
├── Market Regulation Dept                   [type=department, level=1]
│   └── Surveillance Division               [type=division, level=2]
│       └── Tech Monitoring Section          [type=section, level=3]
├── Legal Affairs Dept                       [type=department, level=1]
└── Regional Office, Chennai                 [type=regional_office, level=1]
```

**Type vocabulary:** `board | commission | authority | department | regional_office | division | section | desk`

---

### 5. Autonomous Body (`edition='govt'`, `govt_tier='autonomous_body'`)

ICAR, UGC, AIIMS, IITs, CSIR Labs.

```
Indian Council of Agricultural Research      [type=council, level=0]
├── Division of Crop Sciences                [type=division, level=1]
│   └── Genetics Section                     [type=section, level=2]
├── IARI, Pusa                               [type=institute, level=1]
│   ├── Agronomy Division                    [type=division, level=2]
│   └── Administration                       [type=department, level=2]
└── Regional Station, Karnal                 [type=regional_office, level=1]
```

**Type vocabulary:** `council | university | institute | department | division | regional_office | section | desk`

---

### 6. Central PSU (`edition='psu'`, `govt_tier='central'` optional)

NTPC, BHEL, SBI, Indian Oil.

```
NTPC Limited                                 [type=company, level=0]
├── Northern Region                          [type=region, level=1]
│   ├── Vindhyachal STPS                     [type=plant, level=2]
│   │   ├── O&M Department                  [type=department, level=3]
│   │   │   └── Boiler Section              [type=section, level=4]
│   │   └── HR Department                   [type=department, level=3]
│   └── Rihand STPS                         [type=plant, level=2]
├── Western Region                           [type=region, level=1]
└── Corporate Centre                         [type=corporate, level=1]
    ├── Finance Division                     [type=division, level=2]
    └── HR Division                          [type=division, level=2]
```

**Type vocabulary:** `company | corporate | region | zone | plant | unit | department | division | section`

---

### 7. State PSU (`edition='psu'`, `govt_tier='state'` optional)

State Transport Corp, State Electricity Board, State Water Authority.

```
OSRTC (Odisha State Road Transport Corp)     [type=company, level=0]
├── HQ Administration                        [type=department, level=1]
├── Bhubaneswar Zone                         [type=zone, level=1]
│   ├── Depot Acharya Vihar                  [type=depot, level=2]
│   └── Depot Baramunda                      [type=depot, level=2]
└── Cuttack Zone                             [type=zone, level=1]
    └── Depot CDA                            [type=depot, level=2]
```

**Type vocabulary:** `company | zone | region | depot | branch | department | section`

---

### 8. Private Company (`edition='private'`)

Pvt Ltd / Ltd / LLP.

```
Tata Consultancy Services Ltd                [type=company, level=0]
├── India Business Unit                      [type=business_unit, level=1]
│   ├── BFSI Vertical                       [type=vertical, level=2]
│   │   └── Banking Practice                [type=practice, level=3]
│   └── Retail Vertical                     [type=vertical, level=2]
├── HR Function                              [type=function, level=1]
│   └── Talent Acquisition                  [type=department, level=2]
└── Hyderabad DC                             [type=delivery_center, level=1]
    └── Floor 3 Operations                   [type=section, level=2]
```

**Type vocabulary:** `company | business_unit | vertical | function | practice | delivery_center | department | section | team`

---

### 9. NGO — Society / Trust (`edition='ngo'`)

Registered Society (Societies Registration Act), Trust (Indian Trusts Act).

```
Pratham Education Foundation                 [type=organisation, level=0]
├── Programs                                 [type=department, level=1]
│   ├── Read India Campaign                  [type=program, level=2]
│   │   ├── Maharashtra State Team          [type=state_unit, level=3]
│   │   └── UP State Team                   [type=state_unit, level=3]
│   └── Hybrid Learning                     [type=program, level=2]
├── Finance & Admin                          [type=department, level=1]
└── Research & Monitoring                    [type=department, level=1]
```

**Type vocabulary:** `organisation | department | program | state_unit | district_unit | section | team`

---

### 10. Section 8 Company (`edition='section8'`)

Non-profit corporate entity under Companies Act §8.

```
NASSCOM Foundation                           [type=company, level=0]
├── Digital Literacy Program                 [type=program, level=1]
│   └── South Region                        [type=region, level=2]
├── Social Innovation                        [type=department, level=1]
└── Operations                               [type=department, level=1]
    └── Grants Management                    [type=section, level=2]
```

**Type vocabulary:** `company | department | program | region | section | team`

---

### 11. Cooperative Society (`edition='cooperative'`)

State/multi-state cooperative under Cooperative Societies Act.

```
Gujarat Cooperative Milk Marketing Federation [type=federation, level=0]
├── Anand District Union (Amul)              [type=district_union, level=1]
│   ├── Anand Dairy Plant                    [type=plant, level=2]
│   │   └── Quality Control                  [type=section, level=3]
│   └── Mogar Dairy Plant                    [type=plant, level=2]
├── Mehsana District Union                   [type=district_union, level=1]
└── Corporate Office                         [type=corporate, level=1]
    ├── Marketing Division                   [type=division, level=2]
    └── Finance Division                     [type=division, level=2]
```

**Type vocabulary:** `federation | district_union | society | corporate | plant | division | department | section`

---

### 12. Small Office (`edition='small_office'`)

CA firm, law office, proprietorship, partnership, micro enterprise.

```
M/s Sharma & Associates (CA Firm)            [type=firm, level=0]
├── Audit Department                         [type=department, level=1]
├── Tax Department                           [type=department, level=1]
└── Admin                                    [type=department, level=1]
```

**Type vocabulary:** `firm | office | department | section`

---

## Physical Hierarchy (`location-service`)

Independent of org type — always models geography:

```
locations.type: state | district | block | ward | office | facility | branch | plant | depot
```

Linked from admin tree: `hrms_departments.location_id → locations.id`

| Org Type | Physical pattern |
|----------|-----------------|
| Central Govt | All in Delhi (shared location) |
| State Govt | State capital + districts (per-office location) |
| Local Body | Single city/district |
| PSU | HQ + regional offices + plants |
| Private | HQ + delivery centers / offices |
| NGO | Central office + state units |
| Section 8 | 1–5 offices |
| Cooperative | HQ + district union offices + plants |
| Small Office | Single office |

---

## Design Rules

1. **`hrms_departments`** is the SINGLE source of truth for administrative hierarchy
2. **`type`** column vocabulary is edition+govt_tier dependent — NOT a DB constraint; enforced in domain logic
3. **`level`** (numeric) enforces parent > child ordering
4. **`govt_tier`** distinguishes within `edition='govt'`: central / state / local_body / statutory_body / autonomous_body
5. **`location_id`** links admin unit to physical location (many:1)
6. Cross-service reference: all services use `department_id UUID → hrms_departments.id`
7. No service duplicates the hierarchy — they reference it
