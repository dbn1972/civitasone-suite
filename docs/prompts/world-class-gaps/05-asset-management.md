# Module 05: Asset Management — World-Class Enhancement

## Benchmark: IBM Maximo / SAP PM / Oracle EAM / Hexagon EAM

## Target Service: `services/asset-service`

---

## Phase A: Deep Audit

Read all modules in `services/asset-service/src/modules/` — register, depreciation, lifecycle, maintenance, verification, enterprise, insurance, dashboard.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Predictive Maintenance (ML-Ready)
- **What:** Use meter reading trends to predict failure before it occurs
- **Implement:**
  - `GET /v1/asset/maintenance/predictions?assetId=X` — predicted failure date, confidence, recommended action
  - `POST /v1/asset/maintenance/prediction-models` — register ML model endpoint (external service)
  - Fallback: rule-based prediction (linear extrapolation of meter readings to threshold)
  - Schema: `maintenance.prediction_records` (asset_id, predicted_failure_date, confidence, model_version, created_at)
- **Domain:** `linearExtrapolateToThreshold(readings[], threshold)`, `predictFromModel(meterData, modelEndpoint)`

### Gap 2: Asset Performance Management (OEE, MTBF, MTTR)
- **What:** Compute Overall Equipment Effectiveness, Mean Time Between Failures, Mean Time To Repair
- **Implement:**
  - `GET /v1/asset/performance/:id/kpis` — returns OEE, MTBF, MTTR, availability %
  - `GET /v1/asset/performance/fleet-summary` — aggregated KPIs across all assets (or by category)
  - Source data: work_order completion times, downtime records, meter readings
  - Schema: `maintenance.downtime_records` (asset_id, start_at, end_at, reason, work_order_id)
- **Domain:** `computeMTBF(failures, operatingHours)`, `computeMTTR(workOrders)`, `computeOEE(availability, performance, quality)`

### Gap 3: Spare Parts Inventory Integration
- **What:** Link assets to required spare parts, track availability, auto-generate indent when stock is low
- **Implement:**
  - `POST /v1/asset/assets/:id/spare-parts` — define required spares (item_code, min_stock, reorder_qty)
  - `GET /v1/asset/spare-parts/availability` — cross-reference with stock-service inventory levels
  - Auto-event: when spare drops below min_stock → emit `asset.spare_part.low_stock` → trigger indent
  - Schema: `maintenance.asset_spare_parts` (asset_id, item_code, min_stock, reorder_qty)
- **Cross-service:** Consume `stock.stock.adjusted` to update availability cache

### Gap 4: Asset Health Scoring
- **What:** Composite health index per asset combining age, maintenance history, meter readings, impairment
- **Implement:**
  - `GET /v1/asset/assets/:id/health-score` — returns score (0-100), contributing factors, trend
  - `GET /v1/asset/health/dashboard` — fleet-wide health distribution (critical/fair/good/excellent)
  - Recalculate on: work order completion, meter reading, impairment test
  - Schema: `enterprise.asset_health_scores` (asset_id, score, factors_json, calculated_at)
- **Domain:** `computeHealthScore(age, maintenanceHistory, meterTrend, impairmentResult, condition)`

### Gap 5: Warranty Tracking & Claims
- **What:** Track warranty periods per asset, alert before expiry, manage warranty claims
- **Implement:**
  - `POST /v1/asset/assets/:id/warranties` — register warranty (vendor, start_date, end_date, coverage_type, terms)
  - `GET /v1/asset/warranties/expiring?days=60` — warranties expiring within N days
  - `POST /v1/asset/warranty-claims` — file claim against warranty (issue_description, evidence)
  - `PATCH /v1/asset/warranty-claims/:id/resolve` — mark claim resolved (outcome, credit_amount)
  - Schema: `enterprise.asset_warranties`, `enterprise.warranty_claims`
- **Domain:** `isUnderWarranty(asset, issueDate)`, `identifyExpiringWarranties(days)`

### Gap 6: Calibration Management
- **What:** Track instruments/gauges requiring periodic calibration, certificate management
- **Implement:**
  - `POST /v1/asset/calibration/schedules` — define calibration schedule (asset_id, frequency_days, standard_ref)
  - `POST /v1/asset/calibration/records` — record calibration result (in_tolerance, deviation, certificate_ref)
  - `GET /v1/asset/calibration/overdue` — assets past their calibration due date
  - Schema: `maintenance.calibration_schedules`, `maintenance.calibration_records`
- **Domain:** `isCalibrationOverdue(lastCalibration, frequencyDays)`, `checkTolerance(reading, standardRange)`

### Gap 7: Linear Asset Management
- **What:** Manage assets that span a distance (roads, pipelines, railway tracks) with chainage/km-based segmentation
- **Implement:**
  - `POST /v1/asset/linear-assets` — create linear asset (from_chainage, to_chainage, route_ref)
  - `POST /v1/asset/linear-assets/:id/segments` — define segments with condition per km
  - `GET /v1/asset/linear-assets/:id/condition-map` — segment-by-segment condition visualization data
  - Schema: `enterprise.linear_assets`, `enterprise.linear_segments`
- **Domain:** `segmentConditionScore(surveys)`, `identifyCriticalSegments(segments, threshold)`

### Gap 8: GIS-Based Asset Mapping
- **What:** Store asset coordinates, visualize on map, spatial queries (assets within radius)
- **Implement:**
  - Asset table extension: `latitude numeric(10,7)`, `longitude numeric(10,7)`, `geohash varchar(12)`
  - `GET /v1/asset/assets/geo-search?lat=X&lng=Y&radiusKm=5` — assets within radius
  - `GET /v1/asset/assets/geo-cluster?bbox=X1,Y1,X2,Y2` — clustered asset counts for map tiles
  - Schema: Add location columns to existing asset register table
- **Domain:** `computeGeohash(lat, lng)`, `haversineDistance(point1, point2)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Health Scoring → Performance KPIs → Warranty Tracking → Predictive Maintenance → Spare Parts → Calibration → GIS Mapping → Linear Assets

**TOTAL: _/10**
