# L05 — District Line-Department Onboarding Matrix & Common Platform Capabilities

**Lane:** L05 | **Date:** 2026-07-13 | **Branch:** court-management-service  
**Scope:** District governance platform — 20 line departments × 10 onboarding dimensions; common capabilities classification; department onboarding template  
**Evidence basis:** All claims [VERIFIED] from actual code/schema/DB reads on this server. Prior board deliverables cited by file; not re-derived.

---

## Preliminary: Verified Platform Inventory

The 10-column matrix in Task A references "common modules that exist." Evidence-basis for each:

| Module Label | Service | Status | Evidence (file:line) |
|---|---|---|---|
| **HRMS** | hrms-service | PARTIAL | `services/hrms-service/src/modules/employee/schema.ts` — `hrmsDepartments`, `hrmsDesignations`, `hrmsEmployees`; civitas_hrms DB has 16 PG schemas including appraisal, attendance, leave, lifecycle, disciplinary, pension, recruitment |
| **Payroll** | payroll-service | PARTIAL | `services/payroll-service/src/` — NACH, Form 16, PF/ESI/TDS/PT; 33 migration files; NACH via `packages/gov-adapters/src/nach.ts` |
| **Finance/Budget** | finance-service | PARTIAL | `services/finance-service/src/modules/` — budget, gl, treasury, payments, pfms, hoa; PFMS via `packages/gov-adapters/src/pfms.ts`; 43 migrations |
| **Procurement** | procurement-service | PARTIAL | `services/procurement-service/src/` — indent/RFQ/tender/PO/GRN/GeM/GFR; 23 migrations |
| **Asset** | asset-service | PARTIAL | `services/asset-service/src/modules/` — register/lifecycle/depreciation/maintenance/insurance |
| **Inventory/Stock** | inventory-service + stock-service | NEAR-COMPLETE | `services/inventory-service/src/` (item catalog, FIFO/WACM); `services/stock-service/src/` (GRN/issue/warehouse) |
| **Contract** | contract-service | PARTIAL | `services/contract-service/src/` — lifecycle/clauses/templates/e-sign/obligations |
| **eOffice** | estab-service | HIGH-RISK | `services/estab-service/src/modules/` — files/correspondence/DFA/committee/esign; 70 FORCE RLS; **20% test failure** (see `03-module-inventory.md`) |
| **Workflow** | workflow-service | NEAR-COMPLETE | `services/workflow-service/src/modules/` — BPMN definitions+instances+DMN+delegation+history |
| **DMS** | knowledge-service + estab-service | COMPLETE + HIGH-RISK | `services/knowledge-service/src/` — doc mgmt/versioning/retention (COMPLETE); estab file lifecycle HIGH-RISK |
| **Citizen/Grievance** | citizen-service | PARTIAL | `services/citizen-service/src/modules/` — grievance/RTI/application/portal/sla-rules; RTI Act 2005 deadline; CPGRAMS stub |
| **Project** | project-service | NEAR-COMPLETE | `services/project-service/src/modules/` — project/scheme/progress/geo/utilisation/scheduling |
| **Grant** | grant-service | HIGH-RISK | `services/grant-service/src/modules/` — scheme/beneficiary/disbursement/utilisation/compliance; **63% test failure** |
| **Audit** | audit-service | PARTIAL | `services/audit-service/src/modules/` — para state-machine/CAG/risk/vigilance/compliance |
| **Notification** | notification-service | PARTIAL | `services/notification-service/src/` — multi-channel; SMTP module file missing (HIGH-RISK: `smtp-sender.js` absent) |
| **Meeting** | meeting-service | COMPLETE | `services/meeting-service/src/` — committee governance/agenda/voting/minutes/quorum |
| **Legal** | legal-service | NEAR-COMPLETE | `services/legal-service/src/` — cases/filings/hearings/eCourts |
| **Reporting** | report-service | PARTIAL | `services/report-service/src/modules/` — jobs/kpis/mis/scheduled/templates |
| **Analytics** | analytics-service | NEAR-COMPLETE | `services/analytics-service/src/` — dashboards/facts/queries/exports |
| **Location/Admin-Geo** | location-service | NEAR-COMPLETE | `services/location-service/src/modules/hierarchy/schema.ts:13` — enum `[state, district, block, gp, ward, zone]` with `lgd_code`; civitas_location DB confirmed |

**Org-model depth [VERIFIED]:**  
`identity-service/users` schema: no `officeId`, `departmentId`, or `jurisdictionId` on the user row (`services/identity-service/src/modules/users/schema.ts:6-30`). RBAC `role_assignments` has no office-scope column (`services/identity-service/src/modules/rbac/schema.ts`). `hrmsEmployees` carries `departmentId + designationId` but no `positionId` or posting effective-dates (`services/hrms-service/src/modules/employee/schema.ts:42-65`). Deputation exists (`lifecycle.hrms_deputations`) but no sanctioned-post/position registry. **CONCLUSION: org model is Tenant→Department→Employee (2-level), NOT the 5-level Government standard (Ministry→Department→Office→Position→Posting).**

**Admin-geography gaps [VERIFIED]:**  
`unitTypeEnum` in `services/location-service/src/modules/hierarchy/schema.ts:7-13` has: `[state, district, block, gp, ward, zone]`. **MISSING: division (Divisional Commissioner tier), tehsil/taluka/mandal, police station/circle, ULB (municipality), sub-division (SDM tier)**. The full federal hierarchy Ministry→State→Division→District→Sub-division→Block/Taluka→GP/Ward→Village is not represented.

**Gov-adapters verified** (`packages/gov-adapters/src/`): GSTN (GSP/GSTR-1/GSTR-3B), NACH (bank gateway/DSC), PFMS (payment file), TRACES (TDS). DigiLocker: `services/visitor-service/src/modules/identity/digilocker-adapter.ts`. NIC VC: `services/meeting-service`. **NOT FOUND: VAHAN, SARATHI, State HMIS, CCTNS, NREGASoft, RCMS/PDS, AGRISNET, State IFMS/treasury.**

---

## TASK A — Department Onboarding Matrix

Legend: **[E]** = Exists in platform; **[M]** = Missing/must be built; **[Ext]** = External system-of-record (integrate, never replace); **[\*]** = HIGH-RISK service (see inventory above)

### Column Key
1. **Common-ERP** — which existing platform services it reuses
2. **Dept-Specific** — net-new modules/services needed
3. **State-SoR** — authoritative external systems; integrate only
4. **→Collector** — data projected to District Collector (read-only aggregates)
5. **Shared** — data shared with other departments
6. **Restricted** — data that MUST NOT leave departmental boundary
7. **Min/State Reports** — mandatory statutory reporting
8. **APIs / Events** — inbound/outbound integration contracts
9. **Internal Workflows** — workflows owned entirely within the dept
10. **District-Coordination Workflows** — multi-dept workflows chaired by Collector/SP/DM

---

### 1. Health

| Field | Content |
|---|---|
| **Common-ERP** | HRMS [E-PARTIAL], Payroll [E-PARTIAL], Finance/Budget [E-PARTIAL], Procurement [E-PARTIAL], Inventory/Stock (medicines) [E-NC], Asset [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL], Citizen/Grievance [E-PARTIAL] |
| **Dept-Specific** | PHC patient OPD/IPD register (thin, aggregate-only — NOT a patient health record system); ASHA/ANM worker attendance + incentive tracker; immunization camp scheduling + coverage tracking; disease surveillance weekly report aggregator; ambulance dispatch tracker [M] |
| **State-SoR** | State HMIS (patient records, OPD/IPD stats — authoritative); NHM MIS (NIC); ANMOL (immunization); NIKSHAY (TB); PCPNDT (sex-ratio monitoring); Blood Bank portal; State Medical Stores Depot (MSD) |
| **→Collector** | PHC/CHC bed-occupancy %; ASHA + ANM headcount vs sanctioned posts; active disease-outbreak alerts; vaccination coverage % by block; ambulance deployment status |
| **Shared** | Medical staff HRMS roster (→DM for disaster medical response); drug procurement tenders (→Procurement); SDRF medical relief expenditure (→DM/Finance) |
| **Restricted** | Individual patient records (DPDP §8 sensitive personal data — MUST NOT flow to CivitasOne ERP; state HMIS is SoR); PCPNDT ultrasound data; HIV/TB patient identifiers |
| **Min/State Reports** | NHM Monthly Progress Report (MPR); HMIS monthly report (NIC); DLHS data feed; RMNCH+A coverage report; TB quarterly report (NIKSHAY); drug stock-out report |
| **APIs / Events** | IN: `state_hmis.aggregate.pull` (weekly OPD/IPD counts, no PII) [M]; `anmol.immunization.coverage` [M]; `imd.alert.published` → disease-outbreak trigger [M]; OUT: `health.outbreak.alert` → Notification + DM [M]; `health.asha.incentive.approved` → Payroll [M] |
| **Internal Workflows** | Drug indent → Procurement → GRN → PHC distribution; ASHA incentive claim → verification → payroll; Medical officer leave → HR; Equipment maintenance ticket → Asset |
| **District-Coord Workflows** | Epidemic/outbreak → DDMA (Collector chairs); ambulance dispatch during disaster → DM + Police; mass vaccination camp → Education (school venue) + PR (GP mobilisation); medical relief camp → Revenue (land) + Police (security) |

---

### 2. Education

| Field | Content |
|---|---|
| **Common-ERP** | HRMS [E-PARTIAL], Payroll [E-PARTIAL], Finance/Budget [E-PARTIAL], Procurement (textbooks/infrastructure) [E-PARTIAL], Asset (school buildings) [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL], Citizen/Grievance [E-PARTIAL], Project (school construction) [E-NC] |
| **Dept-Specific** | Teacher roster with school-level posting (position/posting module MISSING [M]); school infrastructure tracker (Enrolment/sections/rooms); MDM (Mid-Day Meal) daily attendance aggregator; scholarship management (→Social Welfare overlap); transfer counselling workflow [M] |
| **State-SoR** | UDISE+ (NIC/MoE — school enrollment, infrastructure: authoritative); state EMIS (SARAL/Pragyaan); PM-POSHAN MIS (MDM); PFMS (fund tracking for SSA/RMSA); Vidya Samiksha Kendra (learning outcome dashboards) |
| **→Collector** | Teacher vacancy position-wise by school; PTR (Pupil-Teacher Ratio) by block; MDM attendance vs enrollment %; school construction progress %; out-of-school children count (block-wise) |
| **Shared** | PFMS fund utilization (→Finance); teacher posting requests crossing blocks (→SDM/Revenue for transfer orders); school-as-polling-booth roster (→Election) |
| **Restricted** | Individual student records including marks, disability category (DPDP §8 minor data); teacher disciplinary proceedings |
| **Min/State Reports** | UDISE annual survey data submission; SSA/RMSA monthly/quarterly MIS; PM-POSHAN MDM report; ASER alignment; DISE school report card |
| **APIs / Events** | IN: `udise.school.sync` (school master pull, no student PII) [M]; `pfms.fund.released` → budget allocation update [E via PFMS adapter]; OUT: `education.teacher.transferred` → HRMS dept-transfer [M]; `education.school.infraUpdated` → Asset [M] |
| **Internal Workflows** | Teacher transfer application → BEO → DEO → approval; textbook indent → Procurement; school building repair → PWD (cross-dept, see coord); scholarship application → verification → disbursement |
| **District-Coord Workflows** | Teacher shortage resolution → HRMS/Revenue for posting order (SDM); school building construction → PWD + Revenue (land); drought/disaster → school closure notification (Collector); child labour detection → Labour + Police (Collector); Board exam centre → Police security (SP) |

---

### 3. Agriculture

| Field | Content |
|---|---|
| **Common-ERP** | HRMS [E-PARTIAL], Finance/Budget [E-PARTIAL], Procurement (seeds/fertilizers) [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL], Citizen/Grievance [E-PARTIAL], Grant [E-HIGH-RISK*] (crop subsidy disbursement), Report/Analytics [E-PARTIAL] |
| **Dept-Specific** | Crop sowing progress tracker (khasra/block level, aggregate); input distribution register (seed/fertilizer/pesticide); farmer beneficiary registry with Aadhaar-seeded bank link; soil health card dispatch tracker; crop damage assessment form (for ex-gratia); PMFBY premium submission tracker [M] |
| **State-SoR** | State Girdawari/crop survey system (land records: Bhulekh/Apna Khata); AGRISNET (NIC); Soil Health Card portal (DAC&FW); PM-KISAN portal (DAC&FW — farmer beneficiary list); PMFBY portal (crop insurance: authoritative); fertilizer e-PoS (DBT portal) |
| **→Collector** | Kharif/Rabi sowing progress % by block; input distribution utilization vs allocation; crop damage % by tehsil (for ex-gratia); PM-KISAN pending beneficiary list; irrigation water demand vs Irrigation dept supply |
| **Shared** | Crop damage assessment → Revenue (for ex-gratia payment); disaster compensation → DM/Finance; land records → Registration dept; water demand → Irrigation dept |
| **Restricted** | Farmer Aadhaar-seeded bank account details (DPDP §8); individual farm holding area (commercial sensitivity) |
| **Min/State Reports** | Crop-wise area/production weekly report (MoA); PM-KISAN installation report; PMFBY premium + claim data; Soil Health Card issuance report; fertilizer DBT report |
| **APIs / Events** | IN: `pmkisan.beneficiary.list.pull` [M]; `pmfby.premium.submit` [M]; `soil_health_card.dispatch.sync` [M]; `bhulekh.land_record.lookup` [M]; OUT: `agriculture.crop.damaged` → DM + Finance (ex-gratia trigger) [M]; `agriculture.input.distributed` → Analytics [M] |
| **Internal Workflows** | Crop damage assessment → tehsil report → DEO → Collector → ex-gratia sanction (→Finance/Revenue); input distribution indent → Procurement; subsidy disbursement → Grant |
| **District-Coord Workflows** | Crop loss assessment → Revenue (Patwari survey) + DM (SDRF); PMFBY claim processing → Collector; kisan mela (Collector chairs); drought declaration → Revenue + DM + Finance (SDRF) |

---

### 4. Animal Husbandry

| Field | Content |
|---|---|
| **Common-ERP** | HRMS [E-PARTIAL], Finance/Budget [E-PARTIAL], Procurement (vaccines/medicines) [E-PARTIAL], Inventory (vet supplies) [E-NC], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL] |
| **Dept-Specific** | Livestock owner registry (village-level aggregate, not UID-per-animal — Pashu Aadhaar is SoR); vaccination camp register + coverage tracker; veterinary dispensary stock + dispensing log; livestock disease outbreak alert; dairy cooperative linkage [M] |
| **State-SoR** | INAPH (NIC — animal health & production: authoritative); Pashu Aadhaar (livestock UID portal, DAHD); NPDD (National Programme for Dairy Development, NABARD); State Livestock Development Board |
| **→Collector** | FMD/LSD/PPR outbreak alerts by block; vaccination coverage % vs target; vet dispensary medicine stock-out; livestock compensation claims pending (disaster) |
| **Shared** | Livestock compensation → DM/Finance (SDRF); dairy cooperative credit → Banking/Finance; fodder crisis → Agriculture |
| **Restricted** | Individual farmer livestock ownership data linked to Aadhaar; dairy cooperative financial records |
| **Min/State Reports** | Annual Livestock Census (20th series) data feed; NCA survey; INAPH monthly report; VDCC achievement report |
| **APIs / Events** | IN: `inaph.vaccination.coverage` [M]; `pashu_aadhaar.animal.registered` [M]; OUT: `animalhusbandry.outbreak.alert` → Notification + Collector + DM [M]; `animalhusbandry.livestock.loss` → DM/Finance for compensation [M] |
| **Internal Workflows** | Vaccine indent → Procurement → cold-chain distribution; camp scheduling → notification; disease reporting → state/central alert |
| **District-Coord Workflows** | Livestock epidemic response (Collector chairs joint meeting — AH + Health + Police); livestock compensation for disaster (DM + AH + Revenue Patwari); fodder camp during drought (AH + Revenue + DM) |

---

### 5. Women & Child Development

| Field | Content |
|---|---|
| **Common-ERP** | HRMS (AWW/Helper roster) [E-PARTIAL], Finance/Budget [E-PARTIAL], Grant (scheme disbursement — PMMVY/nutrition supplements) [E-HIGH-RISK*], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL], Citizen/Grievance [E-PARTIAL] |
| **Dept-Specific** | Anganwadi Worker (AWW) attendance + incentive tracker; ICDS beneficiary enrollment aggregator (not PII — ICDS-CAS is SoR); One Stop Centre (OSC) case register; POSHAN Abhiyaan progress tracker; PMMVY installment tracking [M] |
| **State-SoR** | ICDS-CAS (MoWCD — child health/nutrition monitoring: authoritative); Poshan Tracker (NIC); Udisha (AWW training); SAKHI portal (One Stop Centre); WCD state MIS |
| **→Collector** | SAM/MAM children count by block; AWW vacancy vs sanctioned posts; POSHAN Pakhwada event count; PMMVY disbursement %; OSC referral cases by type |
| **Shared** | AWW co-location with Health for immunization; PMMVY Aadhaar bank details → Finance/Payroll; child trafficking alert → Police + Legal |
| **Restricted** | Women survivor case details (OSC — legally protected under DV Act); child growth monitoring individual data (DPDP §8 minor data) |
| **Min/State Reports** | Poshan Tracker monthly upload; ICDS-CAS data report; PMMVY installment disbursement report; Mission Shakti progress; BBBP (Beti Bachao Beti Padhao) district report |
| **APIs / Events** | IN: `poshan_tracker.beneficiary.aggregate` [M]; `icds_cas.aww.attendance.pull` [M]; OUT: `wcd.pmmvy.installment.approved` → Finance (PFMS payment) [M]; `wcd.child.trafficking.alert` → Police/Legal notification [M] |
| **Internal Workflows** | AWW incentive claim → CDPO approval → payroll; supplementary nutrition procurement → Procurement; OSC case registration → counselling → legal referral |
| **District-Coord Workflows** | PMMVY grievance → SDM adjudication; child trafficking → Police + Legal + WCD (Collector); malnutrition crisis → Health + WCD + Panchayati Raj (BDO); mass POSHAN event → Panchayati Raj (venue) |

---

### 6. Social Welfare

| Field | Content |
|---|---|
| **Common-ERP** | HRMS [E-PARTIAL], Finance/Budget [E-PARTIAL], Grant (scholarship/pension) [E-HIGH-RISK*], eOffice [E-HIGH-RISK*], Workflow [E-NC], Citizen/Grievance [E-PARTIAL], Notification [E-PARTIAL] |
| **Dept-Specific** | Post-matric/pre-matric scholarship management (may overlap NSP); caste certificate workflow (issuance via tehsil → District); hostel admission + occupancy; SHG formation + grading tracker; social audit calendar [M] |
| **State-SoR** | National Scholarship Portal (NSP — scholarship registry: authoritative); Prerana (state anti-trafficking); state caste certificate issuance system (varies by state — Revenue integration); SMILE MIS (MoSJE) |
| **→Collector** | Scholarship disbursement % by category (SC/ST/OBC/Divyaang); caste certificate pendency by tehsil; hostel vacancy; SHG grading distribution by block |
| **Shared** | Scholarship beneficiary Aadhaar → Aadhaar eKYC (shared identity); NSP data → Finance; atrocity case → Police + Legal |
| **Restricted** | Beneficiary caste classification (DPDP §8 sensitive); disability certificate data; individual scholarship award decisions (audit risk) |
| **Min/State Reports** | NSP quarterly disbursement report; Vanchit Samman beneficiary data; DISHA (District Implementation Social Help Act) report; SC/ST atrocity quarterly return |
| **APIs / Events** | IN: `nsp.scholarship.status.pull` [M]; `digilocker.caste_cert.verify` [E in visitor-service pattern, adapt]; OUT: `socialwelfare.scholarship.approved` → Finance/PFMS [M]; `socialwelfare.atrocity.case.filed` → Legal + Police notification [M] |
| **Internal Workflows** | Scholarship application → eligibility check → verification → sanction → PFMS disbursement; hostel admission → vacancy check → allotment |
| **District-Coord Workflows** | SC/ST atrocity case → Police (FIR) + Legal (prosecution) + Social Welfare (victim support) — Collector coordinates; caste certificate appeal → SDM/Revenue; SHG credit-linkage → Banking (NABARD) |

---

### 7. Food & Civil Supplies

| Field | Content |
|---|---|
| **Common-ERP** | HRMS [E-PARTIAL], Finance/Budget [E-PARTIAL], eOffice [E-HIGH-RISK*], Citizen/Grievance [E-PARTIAL], Workflow [E-NC], Notification [E-PARTIAL] |
| **Dept-Specific** | FPS (Fair Price Shop) visit inspection report; off-take reconciliation (stock lifted vs allotment); diversion complaint tracker; ration card portal integration (state SoR); dealer license management [M] |
| **State-SoR** | State PDS/e-PoS system (ration card + transaction: AUTHORITATIVE — CivitasOne MUST NOT duplicate); Annavitran portal; ration card Aadhaar seeding database; FCI stock position; DoCA allocation letter system |
| **→Collector** | Off-take % (foodgrains/kerosene) by FPS/Block; FPS opening status (real-time via e-PoS); diversion complaints count; ration card portability usage |
| **Shared** | BPL/AAY list → Revenue (survey); diversion FIR → Police; SDRF food relief → DM/Finance; revenue sharing (state sales tax) → Finance |
| **Restricted** | Individual ration card holder PII + biometric auth data (DPDP §8); AAY classification (poverty sensitive) |
| **Min/State Reports** | Monthly off-take report (DFPD); allotment vs lift MIS; NFSA coverage compliance report; GoI transparency portal feed |
| **APIs / Events** | IN: `state_pds.offtake.pull` (daily/weekly aggregate per FPS — no PII) [M]; `fci.stock.position.pull` [M]; OUT: `fcs.diversion.complaint` → Police/Legal notification [M]; `fcs.fps.inspection.completed` → Analytics [M] |
| **Internal Workflows** | Allotment order issuance; FPS inspection → report → action; dealer license renewal; diversion report → SDM investigation |
| **District-Coord Workflows** | Public distribution complaint → SDM investigation + FCS; disaster relief food distribution → DM + FCS + Revenue (relief camps); FPS ration diversion FIR → Police + FCS (Collector/SDM) |

---

### 8. Public Works

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget [E-PARTIAL], Procurement [E-PARTIAL], Asset (road/bridge register) [E-PARTIAL], Project/Works [E-NC], Contract [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC], Inventory (material) [E-NC] |
| **Dept-Specific** | Works estimate (Schedule of Rates — SOR-driven pricing); MB (Measurement Book) certification workflow; quality-control test tracking; road network asset condition index; contractor performance history [M] |
| **State-SoR** | State e-Procurement portal (NICSI/NeSL for tenders above threshold: authoritative); PFMS for CSS (PMGSY, PMAY-G roads); NHIDCL for national highway projects; NIC GIS road network (NRMS) |
| **→Collector** | Roads connecting all-weather habitations %; bridge condition red/amber/green count; scheme-wise expenditure vs DPR; pending land acquisition cases blocking works |
| **Shared** | PMGSY road data → Rural Development; NQM quality inspection (→Central NQM portal); land acquisition → Revenue; road closure → Police (traffic) |
| **Restricted** | Contractor financial bid amounts (commercial-in-confidence until award); NQM inspection findings (pending dispute resolution) |
| **Min/State Reports** | PMGSY MIS (MoRD); PMGSY e-GRAMlog entries; state PWD annual report; NHDP progress (NHAI); bridge maintenance report |
| **APIs / Events** | IN: `pmgsy.portal.project.status` [M]; `state_eprocurement.tender.awarded` [M]; OUT: `pwd.work.completed` → Asset (road condition update) [M]; `pwd.land_acquisition.required` → Revenue/Collector alert [M] |
| **Internal Workflows** | Works estimate → technical sanction → tender → LOA → agreement → work order → MB certification → RA bill → Finance payment |
| **District-Coord Workflows** | Land acquisition blocking road work → Revenue/Collector (expedite); road diversion during disaster → Police (traffic) + PWD; inter-department building allocation → Estab + PWD; flood damage repair → DM (SDRF) + PWD |

---

### 9. Irrigation

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget [E-PARTIAL], Procurement [E-PARTIAL], Project/Works [E-NC], Asset (canal/dam registry) [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL] |
| **Dept-Specific** | Dam/reservoir water level + inflow/outflow tracker (IoT-feed aggregator); irrigation schedule + canal maintenance calendar; water user association (WUA) ledger; water demand vs supply reconciliation; dam safety inspection log [M] |
| **State-SoR** | CWC (Central Water Commission — reservoir levels, flood bulletin: authoritative); IMD (India Meteorological Dept — rainfall, forecast: authoritative); state Water Resources Information System (WRIS); CWPRS for dam safety |
| **→Collector** | Reservoir storage % (current vs last year/normal); irrigated area vs kharif/rabi crop demand; dam safety alert level; flood zone inundation forecast (from CWC) |
| **Shared** | Crop water demand → Agriculture; flood forecast → DM (DDMA); canal land → Revenue (easement); hydro-power schedule → Energy dept |
| **Restricted** | Water rights/permits (commercial disputes pending); canal tender bid data; dam safety classified inspection reports |
| **Min/State Reports** | CWC reservoir bulletin contribution; state irrigation season report; dam safety report (NDSA); PMKSY (Per Drop More Crop) utilization |
| **APIs / Events** | IN: `imd.weather.forecast` (daily pull) [M]; `cwc.reservoir.level` (hourly ingest) [M]; OUT: `irrigation.flood_alert.raised` → DM + Police + Revenue [M]; `irrigation.water_schedule.published` → Agriculture + Notification [M] |
| **Internal Workflows** | Canal maintenance work order → Procurement; irrigation schedule publication → farmer notification; dam inspection → safety report → state upload |
| **District-Coord Workflows** | Flood alert → Collector/DDMA (multi-dept emergency: Irrigation + Revenue + Police + DM); inter-district water dispute → Divisional Commissioner; drought water rationing → Agriculture + Irrigation + Revenue |

---

### 10. Industries

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget [E-PARTIAL], Procurement [E-PARTIAL], Legal [E-NC], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL], Citizen/Grievance [E-PARTIAL] |
| **Dept-Specific** | Industry/factory registration tracker; license/NOC issuance workflow (multi-department clearances); MSME cluster performance tracker; investment intent vs realized tracker; industrial estate vacancy map [M] |
| **State-SoR** | Udyam Registration portal (NIC/MoMSME: authoritative for MSME); state single-window clearance system (SWCS); ESIC portal (factory compliance); EPFO; state Industrial Development Corporation (SIDC) |
| **→Collector** | Investment committed vs realized by sector; employment generated (formal, from ESIC/EPFO); land allotted vs utilised at industrial estates; pending environmental NOC count |
| **Shared** | Factory NOC → Pollution Control Board + Labour (inspection coordination); investment promotion → State Investment Promotion Agency; land allotment → Revenue |
| **Restricted** | Industry financial projections (investment proposals — commercial-in-confidence); inspection findings pending factory response |
| **Min/State Reports** | MSME survey annual (MoMSME); Make-in-India monthly report; DPIIT FDI tracking; state industrial growth report |
| **APIs / Events** | IN: `udyam.registration.verify` [M]; `esic.factory.coverage.pull` [M]; `epfo.establishment.pull` [M]; OUT: `industries.license.approved` → Notification [M]; `industries.land.required` → Revenue allocation trigger [M] |
| **Internal Workflows** | License application → multi-NOC workflow (PCB/Labour/Fire/PWD) → approval → issuance; inspection scheduling → report → notice → compliance |
| **District-Coord Workflows** | Law & order at industrial estate → SP + Industries; industrial dispute → Labour court + Industries + Police (Collector mediation); land acquisition for industrial estate → Revenue + Collector |

---

### 11. Labour

| Field | Content |
|---|---|
| **Common-ERP** | HRMS (labour inspector roster) [E-PARTIAL], Finance/Budget [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC], Citizen/Grievance [E-PARTIAL], Notification [E-PARTIAL] |
| **Dept-Specific** | Factory/shop registration ledger; labour inspector assignment + inspection scheduling; BOCW (Building & Other Construction Workers) board cess collection + beneficiary register; minimum wage violation tracker; child labour complaint → investigation workflow [M] |
| **State-SoR** | Shram Suvidha (MoLE — unified labour registration: authoritative for factory/shop registration); ESIC portal; EPFO API; state BOCW board MIS; CLC(C) portal for central-sphere establishments |
| **→Collector** | Active labour disputes count by stage; BOCW cess collection %; child labour cases detected vs resolved; minimum wage compliance audit score by block |
| **Shared** | Factory inspection cross-check → Industries; BOCW cess collection → Finance; accident report → Police (FIR if criminal); ESI coverage → Health (medical benefit) |
| **Restricted** | Individual worker wage data (DPDP §8); union membership lists (sensitive); ongoing inspection findings pre-order |
| **Min/State Reports** | Shram Suvidha unified annual returns; EPFO/ESIC coverage data; child labour survey (MoLE); occupational safety report; minimum wage notification compliance |
| **APIs / Events** | IN: `shram_suvidha.establishment.pull` [M]; `esic.beneficiary.enroll` [M]; OUT: `labour.dispute.filed` → Legal court calendar [M]; `labour.child_labour.detected` → Social Welfare + Police alert [M] |
| **Internal Workflows** | Complaint → inspector assignment → inspection → findings → show-cause → order; BOCW registration → cess levy → benefit claim |
| **District-Coord Workflows** | Labour unrest → SP (law & order) + Industries + Labour (Collector mediation); child labour rescue → Labour + Police + WCD + Social Welfare; factory accident → Police (FIR) + Labour (inquiry) + Health (casualty) |

---

### 12. Transport

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget (revenue receipts) [E-PARTIAL], Legal [E-NC], eOffice [E-HIGH-RISK*], Citizen/Grievance [E-PARTIAL], Workflow [E-NC], Notification [E-PARTIAL] |
| **Dept-Specific** | RTO service request tracker (status dashboard, NOT duplicate of VAHAN/SARATHI); permit issuance + renewal workflow; e-Challan grievance handler; motor vehicle tax demand + collection; transport revenue ledger [M] |
| **State-SoR** | VAHAN (NIC/MoRTH — vehicle registration: AUTHORITATIVE; do NOT duplicate); SARATHI (NIC — driving licence: AUTHORITATIVE; do NOT duplicate); state e-Challan portal; Vaahan/Parivahan portal; HIMMAT (accident reporting) |
| **→Collector** | Motor vehicle tax collection % vs target; e-Challan disposal rate; road accident hotspot map (from HIMMAT); overloaded vehicle violations by highway segment |
| **Shared** | e-Challan enforcement → Police (traffic); vehicle tax → Finance (revenue booking); school bus fitness → Education (compliance check) |
| **Restricted** | Vehicle owner PII (VAHAN — not to be replicated); DL applicant biometric data; individual challan payment history |
| **Min/State Reports** | Road Accident Data (MORTH HIMMAT); transport statistics annual report (MoRTH); vehicle tax collection report; state transport authority annual report |
| **APIs / Events** | IN: `vahan.vehicle.lookup` [M — read-only]; `sarathi.dl.lookup` [M — read-only]; `himmat.accident.report.ingest` [M]; OUT: `transport.tax.demanded` → Finance [M]; `transport.permit.expired` → Notification alert [M] |
| **Internal Workflows** | Permit application → inspection → fee → issuance → renewal reminder; vehicle tax demand notice → collection → receipt |
| **District-Coord Workflows** | Road accident response → Police (FIR) + Health (ambulance) + Transport (investigation); school bus fitness drive → Education + Transport + Police; overloaded vehicle enforcement → Police + Transport (joint naka) |

---

### 13. Excise

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget (excise revenue) [E-PARTIAL], Legal [E-NC], eOffice [E-HIGH-RISK*], Workflow [E-NC], Audit [E-PARTIAL], Notification [E-PARTIAL] |
| **Dept-Specific** | FL-1/FL-2/CL/PL/TP license management + renewal workflow; distillery/brewery permit; excise duty demand + collection ledger; illicit liquor raid case register (aggregate — CCTNS is FIR SoR); excise duty reconciliation [M] |
| **State-SoR** | State excise MIS (varies by state — authoritative for license registry); SUGAM (supply chain tracking, select states); NCB NDPS data (narcotics: DO NOT duplicate — police/CCTNS is SoR) |
| **→Collector** | Excise revenue vs target %; active license count by category; illicit liquor cases by tehsil; NDPS case conviction rate |
| **Shared** | Excise FIR → Police (CCTNS); prosecution → Legal; revenue → Finance; NDPS intelligence → Police/NCB |
| **Restricted** | License holder commercial data (bid-sensitivity); active raid intelligence (operational security); informer identity data |
| **Min/State Reports** | NDPS annual statistics (MHA); excise revenue statistics; state excise annual report; liquor prohibition status report |
| **APIs / Events** | IN: `state_excise_mis.license.sync` [M]; OUT: `excise.raid.case.registered` → Police notification [M]; `excise.duty.collected` → Finance GL [M]; `excise.license.expired` → Renewal alert [M] |
| **Internal Workflows** | License application → inspection → fee → issuance → renewal; duty assessment → demand → collection → reconciliation; illicit liquor case → seizure report → prosecution referral |
| **District-Coord Workflows** | Joint raid with Police (Collector/SP coordinates); NDPS prosecution → Police + Excise + Legal; liquor prohibition enforcement → Police + Excise + DM |

---

### 14. Forest

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget (CAMPA funds) [E-PARTIAL], Procurement (plantation material) [E-PARTIAL], Project (plantation/CAMPA works) [E-NC], Asset (forest depots/nurseries) [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC] |
| **Dept-Specific** | Forest block management + patrolling schedule; working plan implementation tracker; FRA (Forest Rights Act) claim processing workflow; tree felling permit issuance; timber depot management; CAMPA utilization certificate [M] |
| **State-SoR** | CAMPA portal (NIC/MoEFCC: authoritative for CAMPA fund utilization); FSI forest cover data (satellite — authoritative for land cover); FRA portal (Tribal: title claim registry — authoritative); WCCB (wildlife crime) |
| **→Collector** | CAMPA utilization % vs ceiling; FRA claim pending count by block (Collector chairs district-level FRA committee); deforestation incident alerts by range; poaching complaint count |
| **Shared** | FRA claim verification → Revenue (Patwari record); CAMPA plantation → Rural Development (MGNREGS convergence); forest land encroachment → Revenue; tribal welfare → Social Welfare |
| **Restricted** | Anti-poaching operation details (operational security); forest produce contractor bids; informer identity |
| **Min/State Reports** | CAMPA utilization certificate (MoEFCC quarterly); forest working plan annual progress; FRA title claim statistics (MoTA); FSI biennial state forest report contribution |
| **APIs / Events** | IN: `fsi.landuse.change.alert` (satellite-derived, weekly) [M]; `campa.fund.released` → Budget allocation [M]; `fra.claim.status.sync` [M]; OUT: `forest.encroachment.detected` → Revenue/Collector alert [M]; `forest.poaching.fir.trigger` → Police notification [M] |
| **Internal Workflows** | Tree felling permit → DFO inspection → fee → issuance; plantation work order → CAMPA; patrol duty schedule → notification; FRA claim → gram sabha → district committee → title deed |
| **District-Coord Workflows** | FRA district committee → Forest + Tribal Welfare + Revenue (Collector chairs); wildlife-human conflict → Forest + Police; forest fire → Forest + Revenue (revenue loss) + DM (SDRF) |

---

### 15. Municipal Administration

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget (ULB devolution) [E-PARTIAL], Procurement [E-PARTIAL], Asset (municipal property) [E-PARTIAL], Project (AMRUT/SBM works) [E-NC], eOffice [E-HIGH-RISK*], Citizen/Grievance [E-PARTIAL], Workflow [E-NC], Meeting [E-COMPLETE] |
| **Dept-Specific** | Property tax demand + collection ledger; trade license issuance + renewal; building plan approval workflow; birth/death registration; solid waste vehicle tracking; water supply billing; ULB council meeting management (→Meeting service covers this) [M property tax + trade license] |
| **State-SoR** | State ULBMS / e-Nagarpalika (varies by state — property register: authoritative); RERA (construction projects: authoritative for real estate); AMRUT MIS (MoHUA); SBM (Urban) MIS; eHousing portal |
| **→Collector** | Property tax collection %; ULB works (AMRUT/SBM) completion %; birth/death registration coverage; trade license defaults; urban poverty programme coverage |
| **Shared** | Property mutation after registration → Revenue; revenue (stamp duty) → Finance/Registration; urban poverty → Social Welfare; road/infrastructure → PWD |
| **Restricted** | Individual property valuation + owner financial history (commercial sensitivity); building plan commercial drawings |
| **Min/State Reports** | AMRUT MIS (MoHUA); SBM (Urban) — ODF city data; JnNURM utilization report; NULM monthly report; ULB own-revenue report (SFC) |
| **APIs / Events** | IN: `rera.project.registered` → asset registry [M]; `state_ulbms.property.sync` (master pull) [M]; OUT: `municipal.property_tax.demanded` → Notification [M]; `municipal.birth.registered` → Health + Citizen portal [M]; `municipal.death.registered` → Citizen + HRMS (if employee) [M] |
| **Internal Workflows** | Property tax demand notice → objection → collection → receipt; building plan → scrutiny (multi-dept NOC) → approval; trade license renewal → fee → certificate |
| **District-Coord Workflows** | Disaster relief in urban areas → Collector + ULB + Police; encroachment on revenue land → Revenue + ULB; AMRUT project works → PWD + ULB + Finance |

---

### 16. Panchayati Raj

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget (14th/15th FC, SFC) [E-PARTIAL], Procurement (GP works below threshold) [E-PARTIAL], Project [E-NC], eOffice [E-HIGH-RISK*], Citizen/Grievance [E-PARTIAL], Notification [E-PARTIAL], Meeting [E-COMPLETE] |
| **Dept-Specific** | GPDP (Gram Panchayat Development Plan) tracking; elected representative registry (GP Pradhan + ward members) with tenure management; 14th/15th FC fund utilization per GP; Gram Sabha recording + resolution repository; devolution status tracker [M] |
| **State-SoR** | eGramSwaraj (NIC/MoPR — GPDP plans + expenditure: AUTHORITATIVE; CivitasOne must project from it, not duplicate); PFMS (GP fund flow: authoritative); state Panchayat portal; LGD (Local Government Directory — GP boundary codes) |
| **→Collector** | GPDP plan completion %; 14th/15th FC utilization by GP (block-wise summary); Gram Sabha held/pending count; social audit compliance %; GP pradhan vacancy |
| **Shared** | GP fund utilization → Finance (UC); rural works → Rural Development (MGNREGS convergence); land records → Revenue; inter-GP disputes → SDM |
| **Restricted** | Individual Gram Sabha deliberations (may contain caste/community sensitive matters); GP election result disputes (pending legal) |
| **Min/State Reports** | MoPR eGramSwaraj activity reports; 15th FC activity reports; DISE-Panchayat; social audit reports; state finance commission report |
| **APIs / Events** | IN: `egramSwaraj.gpdp.plan.sync` (quarterly pull) [M]; `pfms.gp.fund.released` [M]; `lgd.gp.boundary.sync` [M]; OUT: `pr.gram_sabha.resolution.recorded` → Analytics [M]; `pr.fund.unutilized.alert` → Finance + Collector [M] |
| **Internal Workflows** | GPDP plan → approval → work order → UC submission; elected representative onboarding (tenure management); social audit scheduling → BDO supervision |
| **District-Coord Workflows** | Large GP works (>threshold) → Collector/BDO approval; inter-GP boundary dispute → SDM/Revenue; social audit findings → Collector + Panchayati Raj; election dispute → SDO + Election commission |

---

### 17. Rural Development

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget [E-PARTIAL], Procurement (materials for MGNREGS) [E-PARTIAL], Project [E-NC], Grant (PMAY-G) [E-HIGH-RISK*], Citizen/Grievance [E-PARTIAL], eOffice [E-HIGH-RISK*], Workflow [E-NC], Notification [E-PARTIAL] |
| **Dept-Specific** | MGNREGS muster roll approval workflow (NREGASoft is SoR — integrate, never duplicate); PMAY-G house construction progress tracker; NRLM/DAY-NRLM SHG tracking (aggregate from state MIS); social audit calendar [M] |
| **State-SoR** | NREGASoft (MoRD — MGNREGS demand, muster roll, wages: AUTHORITATIVE; CivitasOne integrates for dashboards only); AWAAS+ (PMAY-G house tracker: authoritative); NRLM MIS; eMuster (e-FMS for MGNREGS) |
| **→Collector** | MGNREGS person-days generated % vs target (block-wise); PMAY-G house completion stages (foundation/lintel/roof); SHG credit-linkage %; pending social audit reports |
| **Shared** | MGNREGS wage payment → Finance (PFMS); PMAY-G convergence → Sanitation (toilet) + Electricity (SAUBHAGYA); social audit → Panchayati Raj |
| **Restricted** | Job card holder bank accounts + Aadhaar (DPDP §8); SHG loan repayment individual data; wage dispute case details (pending) |
| **Min/State Reports** | NREGASoft weekly report (MoRD); PMAY-G progress MIS; NRLM annual report; DISHA dashboard data; social audit report upload |
| **APIs / Events** | IN: `nregasoft.musterroll.approved.pull` (dashboard sync) [M]; `awaas_plus.house.progress.pull` [M]; `nrlm.shg.grading.pull` [M]; OUT: `rd.social_audit.finding` → Collector + Finance alert [M]; `rd.pmayg.completed` → Grant UC trigger [M] |
| **Internal Workflows** | Muster roll approval coordination (field supervisor → BDO); PMAY-G installment release → verification → Finance; SHG formation → grading → credit-linkage |
| **District-Coord Workflows** | Social audit findings → Collector (district-level review) + Finance (recovery) + Panchayati Raj; MGNREGS convergence works → PWD + Agriculture + Irrigation; disaster rehabilitation housing → PMAY-G + DM |

---

### 18. Treasury

| Field | Content |
|---|---|
| **Common-ERP** | Finance [E-PARTIAL] (deep integration — all bills/challans route through Treasury); HRMS (salary bill verification) [E-PARTIAL]; Audit [E-PARTIAL]; eOffice [E-HIGH-RISK*]; Workflow [E-NC]; Report/Analytics [E-PARTIAL] |
| **Dept-Specific** | Pay Order (PO) issuance + token system; drawing rights (DDO-wise); AG reconciliation upload; appropriation ledger vs IFMS; CTS cheque-return handling; contingency advance management [M — Treasury is primarily a RECONCILIATION LAYER to state IFMS] |
| **State-SoR** | State IFMS (Integrated Financial Management System — expenditure posting: AUTHORITATIVE SoR for all expenditure; CivitasOne finance-service must POST to IFMS, not be the SoR); PFMS (CSS expenditure); CAG iCISA/iTRACKS (AG reconciliation); e-Kuber (RBI — for direct payment, select states) |
| **→Collector** | District expenditure vs allocation % (HOA-wise); treasury bill pending count + age; daily cash position; SDRF/NDRF utilization % |
| **Shared** | All departments bills → Treasury; salary bills → HRMS/Payroll; SDRF expenditure → DM; AG audit observation → Audit service |
| **Restricted** | Individual salary/pension details (employee PII); classified expenditure heads; treasury inspection reports |
| **Min/State Reports** | AG reconciliation monthly (CAG format); Finance Commission utilization statement; PAC report response; State Legislature Appropriation Accounts; PFMS UC |
| **APIs / Events** | IN: `state_ifms.appropriation.sync` (daily pull — authorized amount by HOA) [M]; `pfms.disbursement.confirmed` [E via gov-adapters]; `ag.recon.mismatch` [M]; OUT: `treasury.bill.passed` → Finance GL post [M]; `treasury.po.issued` → Finance payment initiation [M]; `treasury.recon.mismatch` → Finance + Audit alert [M] |
| **Internal Workflows** | Bill submission → pre-audit → token → PO → NEFT/CTS; pension renewal; contingency advance → retirement |
| **District-Coord Workflows** | SDRF contingency release → Collector authorization + Treasury + Finance; AG special audit → Audit + Treasury; salary payment discrepancy → Treasury + HRMS + Payroll |

---

### 19. Registration

| Field | Content |
|---|---|
| **Common-ERP** | Finance/Budget (stamp duty revenue) [E-PARTIAL], Legal [E-NC], eOffice [E-HIGH-RISK*], Citizen/Grievance [E-PARTIAL], Workflow [E-NC], Notification [E-PARTIAL] |
| **Dept-Specific** | Appointment slot booking (SRO); EC (Encumbrance Certificate) queue management; stamp duty calculation rule-engine (circle rate driven); deed execution tracker; Franking machine log; valuation objection workflow [M] |
| **State-SoR** | State IGRS/DORIS/Kaveri/Sampadika (document registration: AUTHORITATIVE by state — CivitasOne integrates for status/dashboards; never duplicates deed registry); e-Stamp (NIC/SHCIL — authoritative for stamp supply); Revenue Bhulekh/land records (for mutation trigger post-registration) |
| **→Collector** | Stamp duty revenue (daily/monthly vs target); registration volume by SRO; EC pending > 7 days; pending mutation after registration by Revenue circle |
| **Shared** | Post-registration mutation trigger → Revenue; stamp duty GL posting → Finance; property fraud flag → Police/Legal; RERA registration → Municipal Administration |
| **Restricted** | Property transaction value + party PII (DPDP §8); seller/buyer Aadhaar data; family settlement document content |
| **Min/State Reports** | DOLR registration statistics (MoRD); stamp duty collection report; Annual Registration Report; DoLR land use change data |
| **APIs / Events** | IN: `state_igrs.deed.registered` → Finance GL trigger (stamp duty posting) [M]; `estate.circle_rate.updated` [M]; `bhulekh.mutation.status.pull` [M]; OUT: `registration.deed.executed` → Revenue mutation trigger [M]; `registration.stamp_duty.collected` → Finance GL [M] |
| **Internal Workflows** | Appointment booking → document scrutiny → stamp duty calculation → payment → deed execution → certified copy; valuation objection → adjudication |
| **District-Coord Workflows** | Property fraud → Police (FIR) + Registration + Legal; disputed mutation → Revenue (Collector/SDM adjudicates); benami property → ED + Police + Registration |

---

### 20. Disaster Management

| Field | Content |
|---|---|
| **Common-ERP** | HRMS (rescue team + personnel roster) [E-PARTIAL], Finance/Budget (SDRF/NDRF funds) [E-PARTIAL], Procurement (relief material) [E-PARTIAL], Inventory (relief stock: food/medicines/tarpaulins) [E-NC], Citizen/Grievance (helpline) [E-PARTIAL], Notification (mass alert) [E-PARTIAL], Meeting (DDMA) [E-COMPLETE], eOffice [E-HIGH-RISK*], Project (reconstruction works) [E-NC] |
| **Dept-Specific** | NDRF/SDRF fund management + UC; relief camp management (occupancy/needs tracking); damage assessment form (multi-hazard: flood/cyclone/earthquake/drought); ex-gratia disbursement workflow; incident command tracking; early warning dissemination engine [M — most critical gap] |
| **State-SoR** | NDMS (NIC/NDMA — national disaster management system: incident reporting SoR); state IEDMS; IMD (early warning: authoritative); CWC (flood bulletin: authoritative); IDRN (India Disaster Resource Network — resource directory); SDRF portal (state Finance) |
| **→Collector** | Active incidents count + severity by block; relief camp occupancy vs capacity; ex-gratia approved vs pending by tehsil; rescue team deployment map; SDRF expenditure vs allocation |
| **Shared** | Medical relief → Health; food relief → FCS; temporary shelter → Revenue (land); law & order in camps → Police; reconstruction → PWD + Rural Development; school/government building as shelter → Education/Municipal |
| **Restricted** | NDRF operational intelligence; individual ex-gratia beneficiary bank details; classified rescue operation plans |
| **Min/State Reports** | NDMA SOP compliance report; SDRF/NDRF utilization certificate (Finance Commission); IMD early warning response log; APDM report; Disaster-wise damage assessment (Memorandum) |
| **APIs / Events** | IN: `imd.cyclone_alert.published` [M]; `imd.heatwave.alert.published` [M]; `cwc.flood_bulletin.ingest` [M]; `idrn.resource.lookup` [M]; OUT: `dm.incident.declared` → ALL departments alert via Notification [M]; `dm.relief_camp.opened` → FCS + Health + Revenue notification [M]; `dm.exgratia.approved` → Finance (PFMS payment) [M]; `dm.rescue.team.deployed` → HRMS roster update [M] |
| **Internal Workflows** | Incident creation → team deployment → damage assessment → relief camp opening → ex-gratia sanction → reconstruction UC; SDRF fund request → state approval → release → Finance |
| **District-Coord Workflows** | ALL departments respond under Collector (DDMA chair): Health (medical), Police (law & order + search rescue), FCS (food), Revenue (land/shelter), Finance (SDRF), PWD (roads), Irrigation (flood gates), Education (school shelters), DM (coordination) |

---

## TASK B — Department Onboarding Template

> **Config-registry state [VERIFIED]:** `admin-service/src/modules/config/schema.ts` stores per-tenant `admin_editions`, `admin_module_configs` (enable/disable by moduleKey), and `admin_feature_flags` (PG schema `config`). The visitor-service has a generalized `config_entries` table (`visitor` PG schema) with `(namespace, config_key, value JSONB, effectiveFrom, effectiveTo)` — the most mature config pattern in the codebase. There is NO centralized config-registry package. The onboarding template below is designed so that when a platform-level config-registry service is built (P1 work), it stores all the entries defined here.

---

### D-ONBOARD-001 — Department Onboarding Checklist

**Purpose:** Onboard department N+1 without writing code. This spec is filled once per department by an implementation team and loaded via admin APIs + config ingestion scripts.

---

#### Section 1: Tenant / Org Provisioning

```
TENANT_CODE: <e.g. dist_collector_haryana_gurugram>
DEPT_CODE:   <e.g. health / education / agriculture>
EDITION:     govt_department | psu | small_office
TIER:        district | sub_division | block | state

Required actions:
□ Create tenant via POST /api/v1/install/provision
  payload: { edition, tier, deptCode, tenantCode, region, residency }
□ Set tenant isolation tier via tenant-service
  payload: { isolationTier: "pool" | "shard" | "silo" }  # P1: silo for state depts
□ Configure tenant DNS / custom domain (theme-service)
□ Assign billing plan (billing-service) — or mark as govt_exempt
□ Enable required module keys via admin-service:
  PUT /api/v1/admin/config/modules
  { moduleKeys: ["hrms", "payroll", "finance", "procurement", ...] }
```

---

#### Section 2: Administrative Geography

```
Required config (POST /api/v1/locations/hierarchy):
□ Import LGD hierarchy: state → district → block → GP/ward → village
  (CSV from LGD portal: lgdcodes.gov.in)
  fields: lgdCode, name, type [state|district|block|gp|ward], parentLgdCode

□ Import office registry (POST /api/v1/locations):
  For each physical office:
    name, type=office, lgdCode (nearest admin unit),
    parentId (parent office),
    latitude, longitude, address

□ MISSING [M — P0 before pilot]:
  Add hierarchy enum values: division, tehsil, ulb, police_station, sub_division
  Add office fields: designatedHeadPositionCode, officeCategory, effectiveFrom, effectiveTo
```

---

#### Section 3: Org Structure (HRMS-side)

```
Required: POST /api/v1/hrms/departments (per hrmsDepartments schema)
  For each org unit:
    code, name, parentId, type (district|block|sector|circle), level,
    govtTier (state|central), locationId (→ office registry), headEmployeeId

Required: POST /api/v1/hrms/designations
  For each sanctioned designation:
    code, name, level (1-20), payGrade, cadreCode

MISSING [M — P0 before pilot]:
  □ Sanctioned-post registry: positionCode, designationId, departmentId, vacantFrom, filledBy
  □ Posting table: employeeId, positionId, effectiveFrom, effectiveTo, orderRef
  □ Delegation rules: delegatorPositionCode, delegateePositionCode, scopeType
```

---

#### Section 4: Identity & RBAC

```
□ Import initial users via POST /api/v1/identity/users (CSV / SCIM batch)
  fields: email, name, empCode, designation

□ Create department-specific roles via POST /api/v1/policy/roles:
  Standard role templates (create once, reuse per dept):
    <DEPT>_ddo         — Drawing & Disbursing Officer (finance operations)
    <DEPT>_clerk       — file handling, data entry
    <DEPT>_inspector   — field inspection + report
    <DEPT>_officer     — section officer / BEO / BDO
    <DEPT>_head        — department head / collector-level viewer
    <DEPT>_viewer      — read-only dashboard

□ Assign roles via POST /api/v1/policy/role-assignments

MISSING [M — P1]:
  □ Role scope by jurisdiction (officeId + unitId on role_assignment):
    "This user is HEALTH_DDO only for District Gurugram, not statewide"
  □ Effective-date on role assignments (transfer → old role expires)
```

---

#### Section 5: Jurisdictions

```
□ For each office, map to jurisdiction via POST /api/v1/locations/jurisdictions:
  { officeId, unitId (LGD admin unit), level, isPrimary }
  Example: Block PHO (Pataudi) → jurisdictions: [block:GGN-Block-3 (primary), district:GGN]

MISSING [M — P0 before pilot]:
  □ Jurisdiction envelope on data records: every service record should carry
    jurisdictionId (or unitId) so Collector dashboard can aggregate by LGD unit
  □ locationId on role_assignments: RBAC queries must respect jurisdiction scope
```

---

#### Section 6: Workflow Configuration

```
□ For each approval process, create workflow definition via POST /api/v1/workflow/definitions:
  Standard templates to seed (reuse across departments):
    bill_approval_3tier   — Clerk → DDO → Head (Finance bills)
    file_noting_2tier     — Dealing hand → Section Officer
    procurement_approval  — Indent → PA/HOFO → DDO → Finance
    leave_approval        — Employee → Supervisor → HoD
    grievance_resolution  — Intake → Officer → Head (SLA-driven)

□ Configure SLA rules via POST /api/v1/citizen/sla-rules:
  { workflowType, slaHours, escalationChain: [...officeIds] }

□ Configure approval rules (estab-service) via POST /api/v1/estab/approval-rules:
  { module, sourceType, minAmountMinor, maxAmountMinor, workflowDefinitionCode }
```

---

#### Section 7: Forms & Field Configuration

```
□ If department needs custom fields (above standard schema):
  POST /api/v1/metadata/entities  (metadata-service — currently STUB [M must build first])
  { apiName, label, fields: [{ apiName, fieldType, isRequired, picklistValues }] }

□ Config-registry entries (per visitor-service config_entries pattern,
  generalize to platform config service [M — P1]):
  namespace=<DEPT_CODE>, entries:
    inspection.sla_hours: 48
    grievance.escalation_days: 7
    procurement.approval_threshold_minor: 500000  (₹5,000)
    report.submission_day_of_month: 5
    notification.channels: ["sms", "email", "in_app"]
    feature_flag.offline_mode: true | false
```

---

#### Section 8: External Adapter Configuration

```
□ Identify state SoR systems (see Task A matrix column 3 for your dept)
□ For each external system:
  - Adapter type: pull (scheduled) | push (event) | lookup (on-demand)
  - Configure gov-adapter endpoint in environment:
    ADAPTER_<SYSTEM>_URL, ADAPTER_<SYSTEM>_API_KEY, ADAPTER_<SYSTEM>_MODE

□ Standard adapters available today [VERIFIED]:
    GSTN (GSP/GSTR), NACH (bank gateway), PFMS (payment disbursement), TRACES (TDS)
    DigiLocker (document verification — via visitor-service pattern)

□ Adapters to build [M — priority in parentheses]:
    State IFMS/treasury API (P0 — Treasury dept; all expenditure)
    NREGASoft pull (P1 — Rural Development)
    VAHAN/SARATHI lookup (P1 — Transport)
    UDISE+ sync (P1 — Education)
    INAPH (P2 — Animal Husbandry)
    State HMIS aggregate (P2 — Health; aggregate only, no patient PII)
    IMD/CWC alert ingest (P0 — Disaster Management)
    CAMPA portal (P1 — Forest)
    eGramSwaraj sync (P1 — Panchayati Raj)
```

---

#### Section 9: Projections to Collector

```
□ For each data point in Task A "→Collector" column:
  Create a report definition via POST /api/v1/reports/templates:
  {
    templateCode: "<DEPT>_collector_projection",
    dataSource: "<dept-service> | analytics-service",
    aggregation: { groupBy: ["unitId"], filters: ["tenantId", "dateRange"] },
    refreshCadence: "daily" | "hourly",
    destDashboard: "collector_district_dashboard"
  }

□ Collector-side tenant: must have READ-ONLY role across all line-dept report projections
  → Separate read-model materialized in analytics-service (no cross-service SQL)
  → Each dept publishes aggregated events → analytics-service facts table
```

---

#### Section 10: Data Classification

```
For each data category in this department:
□ PII (DPDP §8 / §9): encrypted at rest (AES-256-GCM via pii-crypto.ts pattern)
  Examples: Aadhaar ref, bank account, biometric, patient ID, caste classification
□ Sensitive Commercial: restricted to dept + audit + legal; no projection
□ Operational (internal): visible within dept + Collector dashboard
□ Public: aggregated stats only; no individual record

Decision matrix (fill per dept at onboarding):
| Data Category | Classification | Encryption | Projection Allowed | Retention (years) |
|---|---|---|---|---|
| Employee payroll | PII | YES | NO | 30 |
| Beneficiary Aadhaar | PII-sensitive | YES | NO | 7 |
| Scheme utilization | Operational | NO | YES (aggregates) | 10 |
| Audit observations | Restricted | NO | YES (Collector) | permanent |
| Tender bid amounts | Commercial | NO | NO (until award) | 7 |
```

---

#### Section 11: Dashboards

```
□ Collector projection dashboard (report-service template — read-only, cross-dept)
□ Department operational dashboard (analytics-service, dept-scoped)
□ Field officer mobile dashboard (Flutter mobile app — offline-capable MIS report)

□ Configure via POST /api/v1/analytics/dashboards:
  { name, widgets: [{ type: kpi|chart|table, query, refreshSec }] }
```

---

#### Section 12: Notification & Alert Configuration

```
□ Configure alert rules via POST /api/v1/notification/alert-rules:
  - SLA breach alerts (from citizen-service SLA sweep)
  - Fund utilization alert at 80% + 95% of budget
  - External system sync failure alert
  - Outbreak / incident alert (for Health / DM depts)
□ Configure channels: email, SMS (DLT-registered template), in-app, push
□ DLT template IDs for SMS (India regulatory requirement) — must be pre-registered
```

---

#### Section 13: Records Retention Configuration

```
□ Configure CSMOP categories for department files (estab-service records module):
  POST /api/v1/estab/records/categories:
  { recordCategory: "C" | "B" | "A" | "D", retentionYears: 1|5|10|30|permanent }
  
□ Configure retention policies (knowledge-service):
  POST /api/v1/knowledge/retention-policies:
  { policyCode, documentType, retentionYears, disposalAction }
```

---

#### Section 14: Go-Live Checklist

```
□ All LGD codes imported and validated
□ Org hierarchy configured with at least 3 levels
□ HRMS employees imported (or HR team trained for self-onboard)
□ Workflow definitions published and tested
□ External adapter in mock mode → switched to sandbox → switched to production
□ Role assignments verified (each user can log in, sees only their jurisdiction data)
□ Collector projection dashboard shows department data
□ SLA rules configured and sweep scheduler running
□ Notification templates DLT-registered
□ Data classification decisions documented and encryption keys rotated
□ CERT-In audit log chain verified (audit-service)
□ DR drill: offline mode test (if offline_mode: true)
```

---

## TASK C — Common Platform Capabilities Classification

Legend: **[E]** = Exists (cited); **[M]** = Missing; **[STUB]** = Skeleton/schema only; **[HR]** = Exists but HIGH-RISK (test failure)

| # | Capability | Classification | Exists Today | Status | Evidence |
|---|---|---|---|---|---|
| 1 | **identity-federation** | Shared-platform-service | [E] | HIGH-RISK | `identity-service` SAML/SCIM/WebAuthn; 24% test failure (`03-module-inventory.md`); no office-scope on role_assignments |
| 2 | **org-registry** | Shared-platform-service | [M] | **MISSING** | `hrmsDepartments` in hrms-service is a dept tree; NO canonical 5-level org unit (Ministry→State→District→Block→Tehsil) with effective dates as a standalone shared service |
| 3 | **admin-geography** | Shared-platform-service | [E] | NEAR-COMPLETE | `location-service/hierarchy/schema.ts:7-13` — `[state, district, block, gp, ward, zone]` with `lgd_code`; **MISSING: division, tehsil/taluka, ULB, police station, sub-division** — 6/11 federal levels |
| 4 | **office-registry** | Shared-but-logically-isolated | [E] | STUB | `location.locations` table (`type=office`, `parentId`, `lgdCode`) exists but missing: position/designation link, department category, effective dates, jurisdiction area polygon |
| 5 | **position/posting** | Shared-but-logically-isolated | [M] | **MISSING** | `hrmsEmployees.designationId` + `departmentId` exist but NO sanctioned-post registry, NO posting table with effectiveFrom/effectiveTo, NO delegation rules |
| 6 | **HRMS** | Shared-platform-service | [E] | PARTIAL | `hrms-service` 16 PG schemas; 22 test failures incl. geo-attendance + Rule 14 disciplinary; 59 tests skipped |
| 7 | **payroll** | Shared-platform-service | [E] | PARTIAL | `payroll-service` NACH, Form 16, PF/ESI/TDS/PT; 33 migrations; 12 test failures |
| 8 | **finance** | Shared-but-logically-isolated | [E] | PARTIAL | `finance-service` budget/GL/treasury/HOA/PFMS; 43 migrations; HOA-based multi-dept isolation; 9 test failures |
| 9 | **budget** | Shared-but-logically-isolated | [E] | PARTIAL | `finance-service/budget` module with HOA, sanction, re-appropriation; PFMS integration present |
| 10 | **procurement** | Shared-but-logically-isolated | [E] | PARTIAL | `procurement-service` GeM/GFR/tender/GRN; 23 migrations; 8 test failures |
| 11 | **inventory** | Shared-but-logically-isolated | [E] | NEAR-COMPLETE | `inventory-service` FIFO/WACM, demand forecast; `stock-service` GRN/warehouse |
| 12 | **asset** | Shared-but-logically-isolated | [E] | PARTIAL | `asset-service` 7 modules, 12 tests (16 failing) |
| 13 | **contract** | Shared-but-logically-isolated | [E] | PARTIAL | `contract-service` lifecycle/clauses/e-sign; 7 test failures |
| 14 | **eOffice** | Shared-platform-service | [HR] | HIGH-RISK | `estab-service` 117 routes, 70 FORCE RLS; **20% test failure** — DSP numbering undefined, NAI archival broken |
| 15 | **workflow** | Shared-platform-service | [E] | NEAR-COMPLETE | `workflow-service` BPMN/DMN/delegation; 2 test failures; usable for dept onboarding immediately |
| 16 | **DMS** | Shared-platform-service | [E] | COMPLETE + HR | `knowledge-service` (COMPLETE — doc mgmt/versioning/retention); `estab-service` file lifecycle (HIGH-RISK) |
| 17 | **notification** | Shared-platform-service | [HR] | HIGH-RISK | `notification-service` multi-channel; **SMTP module file missing** (`smtp-sender.js` absent — startup panic) |
| 18 | **meeting** | Shared-platform-service | [E] | COMPLETE | `meeting-service` 1147 tests pass, committee governance, voting, minutes, quorum |
| 19 | **helpdesk** | Shared-platform-service | [E] | PARTIAL | `helpdesk-service` ITSM/SLA/CMDB; 10 test failures |
| 20 | **audit** | Shared-platform-service | [E] | PARTIAL | `audit-service` para state-machine/CAG; 6 test failures incl. RLS isolation |
| 21 | **search** | Shared-platform-service | [E] | EXISTS | `packages/search` Meilisearch adapter; used by knowledge-service |
| 22 | **GIS** | State-owned / **MISSING** | [M] | **MISSING** | `location-service` has geofence (radius/polygon) + geocoding adapter stub + routing adapter stub. NO PostGIS extensions, no spatial indexing, no WMS/WFS/WMTS tile service, no map layer management. NOT a GIS platform. District pilot requires integration with NIC's National GIS portal or ISRO Bhuvan. |
| 23 | **reporting** | Shared-but-logically-isolated | [E] | PARTIAL | `report-service` 4 modules/20 routes; 7 test failures; `analytics-service` NEAR-COMPLETE |
| 24 | **integration-gateway** | Shared-platform-service | [E] | PARTIAL | `gateway-service` (HTTP reverse proxy, JWT, module-guard, quota) + `gov-adapters` (GSTN/NACH/PFMS/TRACES + DigiLocker). **NO VAHAN, SARATHI, HMIS, NREGASoft, State IFMS adapters.** |
| 25 | **API-mgmt** | Shared-platform-service | [M] | **MISSING** | `admin-service/api-keys` stores API keys (schema + CRUD). NO external API management plane: no developer portal, no per-key rate limiting, no API versioning governance, no subscription management for external consumers. |
| 26 | **observability** | Shared-platform-service | [E] | EXISTS | `packages/observability`; Prometheus `/metrics` on all services; pino JSON logs; OpenTelemetry trace headers propagated |
| 27 | **feature-flags** | Shared-platform-service | [E] | EXISTS | `packages/feature-flags` (pure evaluation logic); `admin-service/feature-flags` (PG storage, CRUD). Tenant-scoped. Verified: `admin-service/src/modules/feature-flags/schema.ts:7-20` |
| 28 | **config** | Shared-but-logically-isolated | [E] | PARTIAL | `admin-service/config` (edition + module-enable per tenant); `visitor-service` config_entries pattern (namespace, configKey, JSONB value, effectiveFrom/To). NO centralized cross-service config-registry package. Pattern must be extracted and generalized. |
| 29 | **records-retention** | Shared-platform-service | [E] | PARTIAL | `knowledge-service` retention module (`retention-policy.create/update/apply` topics + consumer); `estab-service/records/schema.ts` (CSMOP record categories, disposal action, record-room tracking). estab is HIGH-RISK. |

---

### Capability Gaps Requiring New Services (P0–P1)

| Gap | Priority | Rationale | Proposed Service/Module |
|---|---|---|---|
| **Position / Posting registry** | **P0** | Without sanctioned posts, no vacancy report, no transfer workflow, no HRMS onboarding completion | `hrms-service/src/modules/positions/` — `hrms_positions` + `hrms_postings` tables with effective dates |
| **Admin-geography — missing levels** | **P0** | Tehsil/SDM/Division/ULB levels missing from LGD enum; breaks jurisdiction assignment and Collector dashboard rollup | Alter `location.hierarchy.unit_type` enum: add `division`, `tehsil`, `sub_division`, `ulb`, `circle` |
| **State IFMS adapter** | **P0** | All finance-service payments must reconcile against state treasury; without IFMS integration finance-service is an island | `packages/gov-adapters/src/ifms.ts` (state-specific; configurable by `IFMS_PROVIDER` env) |
| **IMD / CWC alert ingest** | **P0** | Disaster Management cannot function without early warning feeds | `packages/gov-adapters/src/imd.ts` + `packages/gov-adapters/src/cwc.ts` |
| **eOffice HIGH-RISK fix** | **P0** | 20% test failure; DSP numbering broken — blocks ALL 20 departments | Fix `estab-service` DSP sequence + NAI workflow (see `15-defect-register.md`) |
| **Notification SMTP** | **P0** | `smtp-sender.js` missing — blocks email delivery for all 20 departments | Restore `notification-service/src/modules/email/smtp-sender.ts` |
| **GIS service** | **P1** | Agriculture, Forest, Irrigation, DM all require spatial data; location-service geofence is not a GIS | Build `gis-service` wrapping NIC National GIS / ISRO Bhuvan API; expose WMS/WFS endpoints + simple geo-query API |
| **API Management plane** | **P2** | State/Ministry consumers of district data need API versioning + keys + rate limits + portal | `api-mgmt-service` (Kong or custom) with developer portal; admin-service api-keys module feeds it |
| **Centralised config-registry** | **P1** | visitor-service config_entries pattern is per-service; must be extracted to platform | Extract `visitor-service/config-registry` pattern into `packages/config` + dedicated `config-service`; each dept onboarding populates it |
| **Org-registry federation** | **P1** | Collector must see all dept org units; currently each dept has its own hrmsDepartments isolated by tenantId | `org-registry-service` with cross-tenant read-model published from each dept's HRMS dept events |
| **Grant-service fix** | **P1** | 63% test failure; disbursement broken — blocks all 20 dept scheme disbursements and grant management | Fix `grant-service` disbursement approval + budget reservation (see `15-defect-register.md`) |

---

## Evidence Summary

| Verified Fact | Source |
|---|---|
| 38 DBs, one per service, each with dedicated PG login | `docker exec civitasone-postgres psql -U civitas_admin -c "\l"` |
| Location hierarchy enum is 6 levels (missing division/tehsil/ULB) | `services/location-service/src/modules/hierarchy/schema.ts:7-13` |
| User schema has no officeId/departmentId | `services/identity-service/src/modules/users/schema.ts:6-16` |
| RBAC role_assignments has no office scope | `services/identity-service/src/modules/rbac/schema.ts:43-55` |
| hrmsDepartments is 2-level (dept + designation only) | `services/hrms-service/src/modules/employee/schema.ts:8-40` |
| No position/posting table anywhere | `grep -rn "hrms_positions\|hrms_postings"` → 0 results |
| gov-adapters: GSTN, NACH, PFMS, TRACES only | `packages/gov-adapters/src/` — 4 files |
| feature-flags: evaluation package + admin storage confirmed | `packages/feature-flags/src/index.ts`; `admin-service/src/modules/feature-flags/schema.ts` |
| config-registry: per-service pattern (visitor), not centralized | `visitor-service/src/modules/config-registry/schema.ts` |
| records-retention: knowledge-service (topics.ts:12-14) + estab records module | `services/knowledge-service/src/topics.ts`; `services/estab-service/src/modules/records/schema.ts` |
| GIS: no PostGIS, no spatial index, no WMS | grep for `postgis, spatial, WMS, WFS` across services → 0 results |
| eOffice HIGH-RISK, grant HIGH-RISK, identity HIGH-RISK | `erp-assessment/03-module-inventory.md` (test run results) |
| PFMS adapter wired in finance-service | `services/finance-service/src/app.ts:59-92` |
| DigiLocker adapter wired in visitor-service | `services/visitor-service/src/modules/identity/digilocker-adapter.ts` |
| Tenant isolation scored 7/10 (23 services' reads incomplete) | `erp-assessment/08-tenant-isolation-report.md` |

---

LANE_DONE L05 score=3
