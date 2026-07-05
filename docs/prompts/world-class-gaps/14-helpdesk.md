# Module 14: Helpdesk / ITSM — World-Class Enhancement

## Benchmark: ServiceNow ITSM / Freshdesk / Zendesk / Jira Service Management

## Target Service: `services/helpdesk-service`

---

## Phase A: Deep Audit

Read all modules: tickets, sla, sla-engine.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: ITIL-Aligned Change/Problem/Incident Management
- **What:** Beyond tickets — formal incident, problem (root cause), and change request workflows
- **Implement:**
  - `POST /v1/helpdesk/incidents` — create incident (impact, urgency → auto-priority matrix)
  - `POST /v1/helpdesk/problems` — create problem (linked_incidents[], root_cause_analysis)
  - `POST /v1/helpdesk/changes` — create change request (type: standard|normal|emergency, risk, plan, rollback)
  - `POST /v1/helpdesk/changes/:id/approve` — CAB approval for changes
  - `POST /v1/helpdesk/problems/:id/resolve` — resolve problem → auto-close linked incidents
  - Schema: `helpdesk.incidents`, `helpdesk.problems`, `helpdesk.change_requests`, `helpdesk.incident_problem_links`
- **Domain:** `computePriorityMatrix(impact, urgency)`, `linkIncidentsToProblem(incidents, problemId)`, `assessChangeRisk(change)`

### Gap 2: Knowledge Base Integration (Contextual Suggestions)
- **What:** When creating a ticket, auto-suggest KB articles; when agent views ticket, show relevant solutions
- **Implement:**
  - `GET /v1/helpdesk/suggestions?subject=printer+not+working` — top 5 KB articles matching the issue
  - Agent view: `GET /v1/helpdesk/tickets/:id/suggestions` — articles relevant to ticket subject + category
  - Track: suggestion → clicked → resolved-without-agent (deflection metric)
  - Cross-service: calls knowledge-service search API
  - Schema: `helpdesk.kb_suggestion_clicks` (ticket_id, article_id, clicked_at, deflected)
- **Domain:** `searchRelevantArticles(subject, category)`, `computeDeflectionRate(suggestions, outcomes)`

### Gap 3: AI Chatbot (Tier-0 Deflection)
- **What:** Conversational bot attempts to resolve before creating a ticket (FAQ lookup + guided troubleshooting)
- **Implement:**
  - `POST /v1/helpdesk/chatbot/message` — user sends message, bot responds with answer or asks clarifying questions
  - `POST /v1/helpdesk/chatbot/escalate` — bot cannot resolve → creates ticket with conversation context
  - Bot logic: keyword matching → KB search → decision tree → escalate
  - `GET /v1/helpdesk/chatbot/analytics` — resolution rate, avg conversation length, top escalation topics
  - Schema: `helpdesk.chatbot_conversations` (id, user_id, messages_json, outcome: resolved|escalated, ticket_id)
- **Domain:** `matchIntent(message, intents)`, `searchKBForAnswer(intent)`, `shouldEscalate(conversation)`

### Gap 4: CSAT Surveys (Post-Close)
- **What:** Auto-send satisfaction survey after ticket close, aggregate by agent/team/category
- **Implement:**
  - Auto-trigger: on ticket status → closed → emit survey invitation (1h delay)
  - `POST /v1/helpdesk/csat/respond` — { ticketId, rating: 1-5, comment }
  - `GET /v1/helpdesk/csat/dashboard` — avg CSAT by agent, team, category, period
  - `GET /v1/helpdesk/csat/trends` — CSAT trend over time
  - Schema: `helpdesk.csat_responses` (ticket_id, rating, comment, responded_at)
- **Domain:** `computeCSAT(responses)`, `trendByPeriod(responses, granularity)`, `bottomPerformers(agentScores)`

### Gap 5: Automation Rules (Auto-Assign, Auto-Tag, Auto-Close)
- **What:** Configurable rules that auto-execute on ticket events (creation, update, time-based)
- **Implement:**
  - `POST /v1/helpdesk/automations` — create rule (trigger, conditions, actions)
  - Triggers: `ticket_created`, `ticket_updated`, `time_since_response > X hours`
  - Actions: `assign_to`, `add_tag`, `change_priority`, `send_notification`, `close`, `escalate`
  - `GET /v1/helpdesk/automations` — list active rules with execution stats
  - `GET /v1/helpdesk/automations/:id/logs` — execution log for debugging
  - Schema: `helpdesk.automation_rules` (id, tenant_id, name, trigger, conditions_json, actions_json, active, executions)
- **Domain:** `evaluateConditions(ticket, conditions)`, `executeActions(ticket, actions)`, `checkTimeBasedTriggers(tickets, rules)`

### Gap 6: Multi-Channel Intake (Email Parsing, Web Widget)
- **What:** Auto-create tickets from incoming emails, embeddable web widget for external sites
- **Implement:**
  - `POST /v1/helpdesk/channels/email/inbound` — webhook receiving parsed email (from, subject, body, attachments)
  - Auto-create ticket: subject → ticket.subject, body → first note, from → requester
  - Reply detection: if email references existing ticket → add as note (not new ticket)
  - `POST /v1/helpdesk/channels/widget/config` — generate widget embed code (site_url, theme, default_category)
  - Schema: `helpdesk.email_thread_mapping` (email_message_id, ticket_id) for reply threading
- **Domain:** `parseInboundEmail(payload)`, `detectReplyThread(inReplyTo, references)`, `createFromEmail(parsed)`

### Gap 7: Agent Collision Detection
- **What:** Real-time indicator when multiple agents are viewing/replying to the same ticket
- **Implement:**
  - `POST /v1/helpdesk/tickets/:id/presence` — agent signals they're viewing the ticket
  - `GET /v1/helpdesk/tickets/:id/presence` — list other agents currently viewing
  - `DELETE /v1/helpdesk/tickets/:id/presence` — agent leaves the ticket
  - TTL: auto-expire presence after 5 minutes of inactivity
  - Schema: Redis-only (no SQL) — `helpdesk:presence:{ticketId}:{agentId}` with TTL
- **Domain:** `registerPresence(ticketId, agentId, ttl)`, `getActiveViewers(ticketId)`

### Gap 8: SLA Business Hours Calendar
- **What:** SLA timers pause outside business hours and on holidays
- **Implement:**
  - `POST /v1/helpdesk/sla/business-hours` — define schedule (mon-fri 9:00-18:00, timezone, holidays[])
  - SLA computation: count only business-hour minutes toward response/resolution time
  - `GET /v1/helpdesk/sla/business-hours` — current configuration
  - Update SLA engine: `computeSlaDeadline(createdAt, slaMinutes, businessHours, holidays)`
  - Schema: `helpdesk.business_hours_config` (tenant_id, schedule_json, timezone, holidays_json)
- **Domain:** `computeBusinessMinutes(from, to, schedule, holidays)`, `addBusinessMinutes(start, minutes, schedule)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Automation Rules → SLA Business Hours → Multi-Channel Intake → CSAT → KB Suggestions → Agent Collision → ITIL (Change/Problem) → Chatbot

**TOTAL: _/10**
