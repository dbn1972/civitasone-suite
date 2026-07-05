# Module 07: Citizen Services — World-Class Enhancement

## Benchmark: ServiceNow CSM / Salesforce Gov Cloud / UMANG / mSeva

## Target Service: `services/citizen-service`

---

## Phase A: Deep Audit

Read all modules: grievance, rti, application, portal, helpdesk, escalation, sla-rules, sla-sweep, analytics.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Omnichannel Intake (WhatsApp, IVR, Chatbot)
- **What:** Accept grievances/applications via WhatsApp, IVR callback, and web chatbot — not just web forms
- **Implement:**
  - `POST /v1/citizen/channels/whatsapp/webhook` — receive WhatsApp messages (Twilio/Meta API format)
  - `POST /v1/citizen/channels/ivr/callback` — IVR system posts transcribed call data
  - `POST /v1/citizen/channels/chatbot/message` — chatbot forwards structured data after conversation
  - All channel messages normalize to internal `citizen.ticket.create` or `citizen.grievance.register`
  - Schema: `portal.channel_messages` (id, channel, external_ref, raw_payload, mapped_to, created_at)
- **Domain:** `normalizeWhatsAppMessage(payload)`, `normalizeIVRTranscript(callData)`, `mapToInternal(normalized)`

### Gap 2: Service Catalog (Configurable Form Builder)
- **What:** Admin defines services (certificates, permits, licenses) with dynamic forms — no code change per service
- **Implement:**
  - `POST /v1/citizen/catalog/services` — define service (name, department, sla_days, form_schema, documents_required)
  - `GET /v1/citizen/catalog/services` — public listing of available services
  - `POST /v1/citizen/catalog/services/:id/apply` — citizen submits application with dynamic form data
  - Form schema stored as JSON Schema (zod-compatible at runtime)
  - Schema: `portal.service_catalog` (id, tenant_id, name, department, sla_days, form_schema_json, documents_required, status)
- **Domain:** `validateDynamicForm(submission, formSchema)`, `computeSLADueDate(sla_days)`

### Gap 3: Digital KYC (Aadhaar eKYC / DigiLocker)
- **What:** Verify citizen identity via Aadhaar OTP-based eKYC or DigiLocker document fetch
- **Implement:**
  - `POST /v1/citizen/kyc/aadhaar/initiate` — send OTP to Aadhaar-linked mobile
  - `POST /v1/citizen/kyc/aadhaar/verify` — verify OTP, fetch KYC data (name, DOB, photo)
  - `POST /v1/citizen/kyc/digilocker/fetch` — pull verified documents (PAN, license, certificate)
  - Schema: `portal.kyc_records` (id, citizen_id, method, verified_at, data_hash, status)
  - **PII:** All KYC data encrypted via `encryptedText()`
- **Domain:** `verifyAadhaarOTP(aadhaar, otp)`, `fetchDigiLockerDocument(docType, accessToken)`

### Gap 4: Appointment Scheduling
- **What:** Slot-based appointment booking for counter services, SMS/push reminders
- **Implement:**
  - `POST /v1/citizen/appointments/slots` — admin defines available slots (date, time, service, capacity)
  - `POST /v1/citizen/appointments/book` — citizen books a slot
  - `DELETE /v1/citizen/appointments/:id/cancel` — cancel with reason
  - `GET /v1/citizen/appointments/my-appointments` — citizen's upcoming/past appointments
  - Auto-reminder: 24h before → emit notification event
  - Schema: `portal.appointment_slots`, `portal.appointment_bookings`
- **Domain:** `checkSlotAvailability(slotId)`, `decrementCapacity(slotId)`, `generateReminders(upcoming)`

### Gap 5: Citizen Satisfaction Survey (CSAT)
- **What:** Post-resolution survey (1-5 stars + optional comment), aggregated per department/service
- **Implement:**
  - Auto-trigger: on grievance.resolved or ticket.closed → emit survey invitation
  - `POST /v1/citizen/surveys/respond` — citizen submits CSAT (rating, comment, ticket_ref)
  - `GET /v1/citizen/surveys/dashboard` — avg CSAT by department, service, officer, time period
  - Schema: `portal.csat_responses` (id, tenant_id, ref_type, ref_id, rating, comment, created_at)
- **Domain:** `computeCSAT(responses)`, `trendByPeriod(responses, granularity)`

### Gap 6: Case Deflection (Knowledge Base Suggestions)
- **What:** Before filing a grievance, suggest relevant FAQ/knowledge articles that might answer the question
- **Implement:**
  - `GET /v1/citizen/deflection/suggest?query=water+supply+delay` — returns top 5 matching KB articles
  - Track: citizen viewed article but still filed → deflection failed
  - Track: citizen viewed article and did NOT file → deflection succeeded
  - `GET /v1/citizen/deflection/metrics` — deflection rate, top deflecting articles
- **Cross-service:** Query knowledge-service search API internally
- **Domain:** `computeDeflectionRate(suggestions, filedAfter)`, `rankArticlesByDeflection(articles)`

### Gap 7: Proactive Notifications
- **What:** Push status updates to citizen without them polling (application status change, hearing date, etc.)
- **Implement:**
  - On any application/grievance/RTI status change → auto-emit notification to citizen
  - `GET /v1/citizen/notifications/preferences` — citizen sets preferred channel (SMS/email/push/WhatsApp)
  - `PATCH /v1/citizen/notifications/preferences` — update preferences
  - Schema: `portal.citizen_notification_prefs` (citizen_id, channel, enabled)
- **Cross-service:** Emit to notification-service with citizen's preferred channel

### Gap 8: Multi-Language Support
- **What:** All citizen-facing content (service catalog, notifications, forms) in 12+ Indian languages
- **Implement:**
  - `POST /v1/citizen/i18n/translations` — admin uploads translations for a service/form
  - `GET /v1/citizen/catalog/services?lang=hi` — returns localized content
  - Notification templates: store per-language variants
  - Schema: `portal.translations` (entity_type, entity_id, language_code, field, translated_text)
- **Domain:** `resolveTranslation(entityType, entityId, field, languageCode, fallback)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Service Catalog → Omnichannel Intake → CSAT → Proactive Notifications → Appointment Scheduling → Case Deflection → Digital KYC → Multi-Language

**TOTAL: _/10**
