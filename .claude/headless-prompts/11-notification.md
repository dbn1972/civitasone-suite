You are building the Notification & Communication module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/notification-module/web/ (if present)
  Key screens: dashboard.html, templates.html, template-detail.html, delivery-log.html,
  preferences.html, channels.html, bulk-send.html, alert-rules.html

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.12

Service: services/notification-service (already scaffolded in 01-platform — EXTEND it)
  DB: civitas_notification, role: notification_svc, password: notification_dev_pw
Prefix: notification_

NOTE: notification-service was scaffolded in 01-platform with basic templates, deliveries, and prefs.
This prompt EXTENDS it with: channel adapters, alert rules, bulk send, and delivery retry logic.

## Modules inside notification-service (extend existing L2)
src/modules/
  templates/   — ALREADY EXISTS from 01-platform — extend with versioning
  deliveries/  — ALREADY EXISTS from 01-platform — extend with retry
  prefs/       — ALREADY EXISTS from 01-platform — extend with channel-specific
  channels/    — NEW: channel adapter registry (email, SMS, push, in-app, WhatsApp stub)
  alerts/      — NEW: alert rules, threshold monitors, auto-notification
  bulk/        — NEW: bulk send campaigns

## Step 1 — Migration extension
Add to services/notification-service/migrations/0002_channels_alerts.sql (DO NOT modify 0001):
  Schema channels:  notification_channels, notification_channel_configs
  Schema alerts:    notification_alert_rules, notification_alert_events
  Schema bulk:      notification_campaigns, notification_campaign_recipients

notification_templates: add version int default 1, superseded_by uuid (self-ref)
notification_deliveries: add retry_count int default 0, next_retry_at timestamptz, error_detail text

Channel types (notification_channels.type check):
  'email', 'sms', 'push', 'in_app', 'whatsapp'

Critical constraints:
- notification_deliveries: status check in ('queued','sending','delivered','failed','skipped')
- notification_alert_rules: trigger_event text, conditions jsonb, channel text, recipients jsonb
- notification_campaigns: status check in ('draft','scheduled','sending','completed','cancelled')
- Template versioning: when template updated → old version superseded_by = new id
- Retry: max 3 retries with exponential backoff (15m, 60m, 240m)

## Step 2 — CQRS routes + consumers
Templates (extend existing):
  POST /notifications/templates          → notification.template.create
  PATCH /notifications/templates/:id     → notification.template.update (creates new version, supersedes old)
  GET  /notifications/templates          → cache → repo
  GET  /notifications/templates/:id/versions → cache → repo (version history)

Deliveries (extend existing):
  POST /notifications/send               → notification.send (immediate, single recipient)
    Consumer: look up template, resolve channel from prefs, call channel adapter
    On adapter failure: set retry_count+1, set next_retry_at, re-queue for retry
  GET  /notifications/deliveries?userId= → cache → repo (delivery log)
  GET  /notifications/deliveries/:id     → cache → repo

Alert rules:
  POST /notifications/alert-rules        → notification.alert_rule.create
  PATCH /notifications/alert-rules/:id/enable  → notification.alert_rule.enable
  PATCH /notifications/alert-rules/:id/disable → notification.alert_rule.disable
  GET  /notifications/alert-rules        → cache → repo

Bulk:
  POST /notifications/campaigns          → notification.campaign.create (template + recipients + schedule)
  PATCH /notifications/campaigns/:id/send → notification.campaign.send
    Consumer: fan out to individual notification.send commands (one per recipient via queue)
  PATCH /notifications/campaigns/:id/cancel → notification.campaign.cancel
  GET  /notifications/campaigns/:id      → cache → repo (with delivery stats)

Preferences:
  POST /notifications/preferences/:userId → notification.pref.upsert (channel + frequency)
  GET  /notifications/preferences/:userId → cache → repo

## Step 3 — Channel adapters (src/adapters/)
Write stub adapters (interface + log-only implementation):
  email.ts    — sends via SMTP (configurable via EMAIL_HOST, EMAIL_PORT env vars); stub logs the email
  sms.ts      — sends via SMS gateway (SMS_GATEWAY_URL env var); stub logs the SMS
  push.ts     — sends via FCM (FIREBASE_SERVER_KEY env var); stub logs the push
  in_app.ts   — writes to notification_deliveries with in_app flag; WebSocket delivery via event
  whatsapp.ts — stub only (WhatsApp Business API — future integration)

Channel selection in consumer:
  1. Check notification_prefs for user's preferred channel for this notification type
  2. Fall back to notification_channels default channel for the event category
  3. If channel unavailable → fall back to email

## Step 4 — Retry logic
Consumer after adapter failure:
  - retry_count < 3: set next_retry_at = now + backoff(retry_count), re-publish to SQS with delay
  - retry_count >= 3: set status = 'failed', emit notification.delivery.permanently_failed

SQS delay message attributes:
  Use SQS DelaySeconds: [900, 3600, 14400] for retries 1, 2, 3

## Step 5 — Events consumed (all from other services)
notification.send (SQS topic) — published by ALL other services:
  payload: { templateId, recipientId, tenantId, variables: Record<string,string>, channel?: string }
  Consumer already handles in 01-platform — extend to use channel adapters and retry

## Step 6 — Tests
- Template versioning: update template → new version created, old superseded
- Channel fallback: user pref = 'push', push adapter fails → falls back to email
- Retry backoff: failure on retry_count=0 → next_retry_at = now + 15m
- Bulk fan-out: campaign with 3 recipients → 3 individual notification.send commands queued
- CQRS: POST /notifications/campaigns/:id/send → SQS → consumer → fan-out (MemoryQueue)

## Step 7 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=notification_dev_pw -i civitasone-postgres \
  psql -U notification_svc -d civitas_notification \
  < services/notification-service/migrations/0002_channels_alerts.sql
cd services/notification-service && pnpm typecheck && pnpm test

Report: routes, adapters, retry logic, test results.
