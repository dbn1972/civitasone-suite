# Module 13: CRM — World-Class Enhancement

## Benchmark: Salesforce / HubSpot / Zoho CRM / Freshsales

## Target Service: `services/crm-service`

---

## Phase A: Deep Audit

Read all modules: contacts, deals, activities, dashboard.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Lead Scoring (Rule-Based + Behavioral)
- **What:** Auto-score leads based on demographic fit + behavioral signals (engagement, recency)
- **Implement:**
  - `POST /v1/crm/scoring/rules` — define scoring rules (field_condition → points, activity_type → points)
  - `GET /v1/crm/leads/:id/score` — current composite score + breakdown
  - `GET /v1/crm/leads/hot` — leads above threshold, sorted by score (sales-ready)
  - Auto-recalculate: on activity logged, field updated, or time decay
  - Schema: `crm.scoring_rules` (id, tenant_id, type: 'demographic'|'behavioral', condition, points, active)
  - Add `score integer`, `score_updated_at timestamptz` to leads table
- **Domain:** `computeLeadScore(lead, activities, rules)`, `applyTimeDecay(score, lastActivity, decayRate)`

### Gap 2: Pipeline Forecasting
- **What:** Weighted probability-based revenue forecast from deal pipeline
- **Implement:**
  - `GET /v1/crm/forecast?period=Q3-2026` — projected revenue by stage (weighted by probability)
  - `GET /v1/crm/forecast/accuracy` — compare past forecasts to actuals (forecast accuracy %)
  - Deal stages carry default probabilities (configurable): prospect 10%, qualified 25%, proposal 50%, negotiation 75%, closed 100%
  - `GET /v1/crm/forecast/gap` — target revenue vs current weighted pipeline (gap to fill)
  - Schema: Add `probability_pct integer`, `expected_close_date date` to deals table
- **Domain:** `computeWeightedPipeline(deals)`, `forecastByPeriod(deals, periods)`, `forecastAccuracy(pastForecasts, actuals)`

### Gap 3: Marketing Automation (Email Sequences)
- **What:** Drip campaigns: automated email sequences triggered by lead actions
- **Implement:**
  - `POST /v1/crm/sequences` — create sequence (name, steps: [{delay_days, template_id, condition}])
  - `POST /v1/crm/sequences/:id/enroll` — enroll lead/contact into sequence
  - `POST /v1/crm/sequences/:id/unenroll` — remove from sequence (manual or on conversion)
  - Scheduler: daily check → send next step to enrolled contacts past delay
  - `GET /v1/crm/sequences/:id/analytics` — open/reply rate per step, drop-off funnel
  - Schema: `crm.email_sequences`, `crm.sequence_steps`, `crm.sequence_enrollments`
- **Domain:** `computeNextStep(enrollment, steps)`, `checkSendCondition(lead, condition)`, `stepAnalytics(enrollments)`

### Gap 4: Territory Management
- **What:** Assign accounts/leads to territories (geographic or segment-based), with owner assignment
- **Implement:**
  - `POST /v1/crm/territories` — create territory (name, type: geo|segment|account_size, rules, owner_id)
  - `POST /v1/crm/territories/auto-assign` — run territory assignment on all unassigned leads
  - `GET /v1/crm/territories/:id/accounts` — accounts in this territory
  - `GET /v1/crm/territories/coverage` — territory map with account counts, revenue, gaps
  - Schema: `crm.territories`, `crm.territory_rules`, add `territory_id uuid` to contacts/deals
- **Domain:** `assignTerritory(lead, territories, rules)`, `detectCoverageGaps(territories, accounts)`

### Gap 5: Customer 360 View (Unified Timeline)
- **What:** Single view of all interactions across CRM, helpdesk, billing, notifications, workflow
- **Implement:**
  - `GET /v1/crm/contacts/:id/360` — unified timeline (deals, tickets, payments, emails, calls, notes)
  - Aggregates from: crm activities + helpdesk tickets + billing invoices + notification deliveries
  - `GET /v1/crm/contacts/:id/health-score` — customer health (engagement recency + ticket volume + payment history)
  - Cross-service: internal HTTP calls to helpdesk, billing, notification with x-service-secret
  - Schema: No new tables — aggregation view
- **Domain:** `computeHealthScore(activities, tickets, payments)`, `buildTimeline(sources[], sortBy: date)`

### Gap 6: Quote-to-Cash (CPQ Lite)
- **What:** Generate quotes from deals, convert approved quotes to invoices, track payment
- **Implement:**
  - `POST /v1/crm/deals/:id/quotes` — create quote (line_items, validity_days, terms)
  - `POST /v1/crm/quotes/:id/send` — send quote to contact (PDF + email)
  - `POST /v1/crm/quotes/:id/accept` — contact accepts → create invoice in billing-service
  - `GET /v1/crm/quotes` — list quotes with status (draft/sent/accepted/expired/rejected)
  - Schema: `crm.quotes`, `crm.quote_line_items`
  - Cross-service: on accept → emit `crm.quote.accepted` → billing-service creates invoice
- **Domain:** `computeQuoteTotal(lineItems, discounts, tax)`, `checkQuoteExpiry(quote)`

### Gap 7: Data Enrichment (External Integration Ready)
- **What:** Enrich contact/company data from external sources (MCA, GST portal, LinkedIn)
- **Implement:**
  - `POST /v1/crm/contacts/:id/enrich` — trigger enrichment (source: 'mca'|'gst'|'manual')
  - `GET /v1/crm/enrichment/providers` — configured enrichment sources
  - `POST /v1/crm/enrichment/providers` — admin configures API credentials for enrichment source
  - On enrichment: update contact fields (company_name, gst_number, director_names, etc.)
  - Schema: `crm.enrichment_logs` (contact_id, source, data_received, applied_at)
- **Domain:** `mergeEnrichmentData(contact, enrichedData, overrideRules)`

### Gap 8: Social Media Monitoring (Activity Feed)
- **What:** Track mentions, log social interactions as activities on contacts
- **Implement:**
  - `POST /v1/crm/social/mentions` — log social mention (platform, content, contact_id, url, sentiment)
  - `GET /v1/crm/contacts/:id/social` — social activity feed for a contact
  - `GET /v1/crm/social/feed` — aggregate social feed across all contacts (newest first)
  - `GET /v1/crm/social/sentiment-summary` — overall sentiment distribution
  - Schema: `crm.social_mentions` (id, tenant_id, contact_id, platform, content, url, sentiment, created_at)
- **Domain:** `classifySentiment(content)`, `aggregateSentiment(mentions)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Lead Scoring → Pipeline Forecast → Customer 360 → Territory → Sequences → CPQ → Enrichment → Social

**TOTAL: _/10**
