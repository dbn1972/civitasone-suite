# Module 12: Analytics & BI — World-Class Enhancement

## Benchmark: Power BI Embedded / Metabase / Apache Superset / Tableau

## Target Service: `services/analytics-service`

---

## Phase A: Deep Audit

Read all modules: dashboards, metrics, queries, facts, registry, activation.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Self-Service Report Builder (Drag-and-Drop)
- **What:** Users build custom reports by selecting dimensions, measures, filters, and chart types — no code
- **Implement:**
  - `POST /v1/analytics/reports` — create report definition (dimensions[], measures[], filters[], chartType, groupBy)
  - `POST /v1/analytics/reports/:id/execute` — run the report, return tabular + chart data
  - `GET /v1/analytics/reports/my-reports` — user's saved custom reports
  - `GET /v1/analytics/metadata/dimensions` — available dimensions (department, date, status, etc.)
  - `GET /v1/analytics/metadata/measures` — available measures (count, sum, avg of specific fields)
  - Schema: `analytics.custom_reports` (id, tenant_id, user_id, name, config_json, last_run_at)
- **Domain:** `buildQuery(dimensions, measures, filters)`, `validateReportConfig(config, metadata)`

### Gap 2: Drill-Down & Slice-and-Dice (OLAP)
- **What:** Click on any aggregated number → drill into underlying detail (hierarchical)
- **Implement:**
  - `POST /v1/analytics/drill-down` — { reportId, currentDimensions, drillInto: "department.sub_dept" }
  - Returns the next level of detail while preserving filters
  - Dimension hierarchies: Year → Quarter → Month → Day, Org → Dept → Section, Location → State → District
  - `GET /v1/analytics/hierarchies` — available drill paths
- **Domain:** `resolveDrillPath(currentLevel, drillTarget, hierarchy)`, `applyDrillFilters(query, parentValues)`

### Gap 3: Scheduled Report Delivery
- **What:** Schedule reports to run daily/weekly/monthly and email as PDF/Excel to recipients
- **Implement:**
  - `POST /v1/analytics/reports/:id/schedule` — create schedule (frequency, recipients, format, time)
  - `GET /v1/analytics/schedules` — list active schedules
  - `DELETE /v1/analytics/schedules/:id` — cancel schedule
  - Scheduled worker: execute report → render to PDF/Excel → emit notification with attachment
  - Schema: `analytics.report_schedules` (id, report_id, tenant_id, cron_expr, recipients, format, last_run_at, next_run_at)
- **Domain:** `computeNextRun(cronExpr, lastRun)`, `renderReport(data, format: 'pdf'|'excel'|'csv')`

### Gap 4: Data Export (CSV/Excel/PDF)
- **What:** Any dashboard widget or report can be exported in standard formats
- **Implement:**
  - `POST /v1/analytics/export` — { reportId, format: 'csv'|'xlsx'|'pdf', filters }
  - Returns download URL (signed, time-limited) or streams directly for small datasets
  - PDF: formatted with headers, page numbers, tenant branding
  - Excel: formatted cells, auto-width, frozen headers
- **Domain:** `generateCSV(data, columns)`, `generateExcel(data, columns, formatting)`, `generatePDF(data, template)`

### Gap 5: Anomaly Detection (Statistical Alerts)
- **What:** Auto-detect when a KPI deviates significantly from historical pattern, alert admin
- **Implement:**
  - `POST /v1/analytics/anomaly-rules` — create rule (metric_id, sensitivity: low|medium|high, alert_channel)
  - Detection: compute rolling mean + stddev, flag if current value > mean ± (sensitivity × stddev)
  - `GET /v1/analytics/anomalies` — recent anomalies with context (metric, expected range, actual)
  - `PATCH /v1/analytics/anomalies/:id/acknowledge` — mark as reviewed (false_alarm | investigating)
  - Schema: `analytics.anomaly_rules`, `analytics.anomaly_detections`
- **Domain:** `detectAnomaly(metric, historicalValues, sensitivity)`, `computeZScore(value, mean, stddev)`

### Gap 6: Embedded Analytics (Widget SDK)
- **What:** Embed dashboard widgets in external portals via iframe with scoped, time-limited tokens
- **Implement:**
  - `POST /v1/analytics/embed/token` — generate scoped embed token (dashboard_id, filters, expires_in)
  - `GET /v1/analytics/embed/:token/render` — serve the rendered widget/dashboard for iframe embed
  - Token carries: tenant_id, allowed_dashboards, forced_filters (no data leak)
  - Schema: `analytics.embed_tokens` (token_hash, tenant_id, dashboard_id, filters, expires_at)
- **Domain:** `generateEmbedToken(dashboardId, filters, ttl)`, `validateEmbedToken(token)`

### Gap 7: Natural Language Query
- **What:** Users type questions in plain English → system translates to SQL/aggregation → returns answer
- **Implement:**
  - `POST /v1/analytics/nl-query` — { question: "show me leave trends this quarter" }
  - Returns: interpreted query (dimensions, measures, filters) + result data + chart suggestion
  - Fallback: if NLP fails, return "Did you mean..." suggestions from metadata
  - Schema: `analytics.nl_query_log` (question, interpreted_query, result_summary, user_id, created_at)
- **Domain:** `parseNLQuery(question, availableMetadata)`, `suggestAlternatives(question, metadata)`

### Gap 8: Data Freshness & Lineage
- **What:** Show when data was last refreshed, trace metric back to source system/table
- **Implement:**
  - `GET /v1/analytics/metrics/:id/lineage` — source service, source table, transformation steps, last_refreshed_at
  - `GET /v1/analytics/freshness` — dashboard-level freshness indicators (green/amber/red)
  - Each fact table records `last_etl_at` — amber if > 1h stale, red if > 24h
  - Schema: `analytics.metric_lineage` (metric_id, source_service, source_table, transform_description, refresh_frequency)
- **Domain:** `assessFreshness(lastRefresh, threshold)`, `traceLineage(metricId)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Data Export → Scheduled Reports → Self-Service Builder → Drill-Down → Anomaly Detection → Freshness/Lineage → Embedded Analytics → NL Query

**TOTAL: _/10**
