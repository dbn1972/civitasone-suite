# Module 08: Project Management — World-Class Enhancement

## Benchmark: Oracle Primavera / MS Project / SAP PS / Smartsheet

## Target Service: `services/project-service`

---

## Phase A: Deep Audit

Read all modules: project, progress, scheme, utilisation, evidence, geo, dashboard.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Critical Path Method (CPM) & Scheduling
- **What:** Auto-calculate earliest/latest start/finish, identify critical path, detect schedule float
- **Implement:**
  - `POST /v1/project/projects/:id/schedule` — compute CPM from task dependencies
  - `GET /v1/project/projects/:id/critical-path` — returns ordered critical tasks, total float per task
  - Tasks need: `depends_on` (array of task IDs), `duration_days`, `earliest_start`, `latest_finish`
  - Schema: Add `depends_on uuid[]`, `earliest_start date`, `latest_finish date`, `total_float_days int` to tasks
- **Domain:** `forwardPass(tasks)`, `backwardPass(tasks)`, `identifyCriticalPath(tasks)`

### Gap 2: Earned Value Management (EVM)
- **What:** Track project health via CPI (Cost Performance Index) and SPI (Schedule Performance Index)
- **Implement:**
  - `GET /v1/project/projects/:id/evm` — returns PV, EV, AC, CPI, SPI, EAC, ETC, VAC
  - Source: planned budget × % time elapsed (PV), actual progress × budget (EV), actual spend (AC)
  - `GET /v1/project/projects/:id/evm/trend` — period-wise EVM metrics for S-curve visualization
  - Schema: `project.evm_snapshots` (project_id, snapshot_date, pv_minor, ev_minor, ac_minor)
- **Domain:** `computeEVM(planned, earned, actual)`, `forecastEAC(bac, cpi)`, `spiTrend(snapshots)`

### Gap 3: Resource Levelling & Capacity Planning
- **What:** Detect resource over-allocation, suggest schedule shifts to level workload
- **Implement:**
  - `POST /v1/project/resources` — define resources (user_id, capacity_hours_per_week, skills)
  - `POST /v1/project/tasks/:id/assign-resource` — assign resource with effort_hours
  - `GET /v1/project/resources/utilization?from=X&to=Y` — resource load % per person per week
  - `GET /v1/project/resources/conflicts` — over-allocated resources with conflicting tasks
  - Schema: `project.resource_pool`, `project.task_assignments`
- **Domain:** `computeUtilization(assignments, capacity)`, `detectOverAllocation(resource, period)`

### Gap 4: Risk Register
- **What:** Per-project risk identification with probability × impact scoring, mitigation tracking
- **Implement:**
  - `POST /v1/project/projects/:id/risks` — create risk (description, probability, impact, owner, mitigation_plan)
  - `PATCH /v1/project/risks/:id` — update status (identified → mitigating → closed → materialized)
  - `GET /v1/project/projects/:id/risk-matrix` — probability vs impact matrix visualization
  - `GET /v1/project/risks/top-10` — highest exposure risks across all projects
  - Schema: `project.risks` (id, project_id, description, probability, impact, exposure_score, status, owner_id, mitigation)
- **Domain:** `computeExposure(probability, impact)`, `rankRisks(risks)`

### Gap 5: Change Request Management
- **What:** Formal change requests for scope/schedule/budget changes with approval workflow
- **Implement:**
  - `POST /v1/project/projects/:id/change-requests` — submit CR (type: scope|schedule|budget, description, impact_analysis)
  - `POST /v1/project/change-requests/:id/approve` — approve (triggers baseline update)
  - `GET /v1/project/projects/:id/change-requests` — list CRs with status
  - On approval: update project baseline (budget, end_date, scope)
  - Schema: `project.change_requests` (id, project_id, type, description, impact_minor, impact_days, status, approved_by)
- **Domain:** `computeImpact(changeRequest, currentBaseline)`, `updateBaseline(project, approvedCR)`

### Gap 6: Project Portfolio Management (PPM)
- **What:** Rank and prioritize projects across the organization, resource allocation across portfolio
- **Implement:**
  - `POST /v1/project/portfolio/score` — score projects by strategic alignment, ROI, risk, urgency
  - `GET /v1/project/portfolio/ranked` — ranked project list with composite scores
  - `GET /v1/project/portfolio/resource-demand` — aggregate resource demand across all projects vs capacity
  - `GET /v1/project/portfolio/health-summary` — RAG status (red/amber/green) for all active projects
  - Schema: `project.portfolio_scores` (project_id, alignment_score, roi_score, risk_score, composite)
- **Domain:** `computePortfolioScore(criteria, weights)`, `resourceDemandVsCapacity(projects, resources)`

### Gap 7: Timesheet & Time Tracking
- **What:** Employees log time against project tasks, feeds into EVM actual cost
- **Implement:**
  - `POST /v1/project/timesheets` — submit daily/weekly time entries (task_id, hours, date)
  - `POST /v1/project/timesheets/:id/approve` — manager approves timesheet
  - `GET /v1/project/timesheets/my-entries?from=X&to=Y` — employee's time log
  - `GET /v1/project/tasks/:id/time-spent` — total hours logged against a task
  - Schema: `project.timesheet_entries` (id, user_id, task_id, project_id, hours, date, status, approved_by)
- **Domain:** `computeActualCost(timesheetHours, hourlyRate)`, `validateWeeklyLimit(entries, maxHours)`

### Gap 8: Project Templates with WBS
- **What:** Reusable project templates with pre-defined Work Breakdown Structure
- **Implement:**
  - `POST /v1/project/templates` — create template (WBS tasks, dependencies, default durations, resource roles)
  - `POST /v1/project/templates/:id/instantiate` — create project from template (auto-create tasks + deps)
  - `GET /v1/project/templates` — list available templates
  - Schema: `project.project_templates`, `project.template_tasks`
- **Domain:** `instantiateTemplate(template, startDate, teamMapping)`, `adjustDatesFromStart(tasks, startDate)`

---

## Phase C–F: Same structure as Module 01

Implementation order: CPM Scheduling → EVM → Risk Register → Resource Levelling → Change Requests → Timesheets → PPM → Templates

**TOTAL: _/10**
