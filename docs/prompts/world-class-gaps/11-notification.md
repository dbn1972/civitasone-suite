# Module 11: Notification & Communication — World-Class Enhancement

## Benchmark: Twilio / Customer.io / OneSignal / Braze

## Target Service: `services/notification-service`

---

## Phase A: Deep Audit

Read all modules: templates, channels, deliveries, inbox, alerts, bulk, domain-events.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: WhatsApp Business API Integration
- **What:** Send transactional notifications via WhatsApp (template messages + session messages)
- **Implement:**
  - New channel type: `whatsapp` in channels registry
  - `POST /v1/notification/channels/whatsapp/configure` — set API credentials, phone number, provider (Meta/Twilio)
  - Template messages: pre-approved HSM templates with variable substitution
  - Session messages: for within-24h replies
  - `GET /v1/notification/channels/whatsapp/delivery-status/:id` — webhook-driven status updates
  - Schema: `channels.whatsapp_config` (tenant_id, provider, api_key_ref, phone_number, webhook_secret)
- **Domain:** `buildWhatsAppPayload(template, variables, recipient)`, `validateHSMTemplate(templateId)`

### Gap 2: Notification Preference Center
- **What:** Users control which notifications they receive, on which channels, at what frequency
- **Implement:**
  - `GET /v1/notification/preferences/me` — current user's preferences (per category per channel)
  - `PATCH /v1/notification/preferences/me` — update preferences
  - `GET /v1/notification/preferences/categories` — available notification categories with defaults
  - Before sending: check user preferences → skip if opted out on that channel
  - Schema: `prefs.user_preferences` already exists — extend with category-level granularity
- **Domain:** `shouldDeliver(userId, category, channel, preferences)`, `applyDigestRules(pending, frequency)`

### Gap 3: Engagement Analytics
- **What:** Track open rates, click-through rates, delivery success per template/channel/time
- **Implement:**
  - Track: delivered → opened (pixel/webhook) → clicked (link tracking) → converted (action taken)
  - `GET /v1/notification/analytics/engagement?templateId=X` — open rate, CTR, delivery rate
  - `GET /v1/notification/analytics/best-time` — optimal send time per user segment (based on open patterns)
  - `GET /v1/notification/analytics/channel-performance` — delivery/open/click by channel comparison
  - Schema: `deliveries.engagement_events` (delivery_id, event_type, timestamp, metadata)
- **Domain:** `computeOpenRate(deliveries, opens)`, `computeCTR(opens, clicks)`, `optimalSendTime(engagementEvents)`

### Gap 4: Delivery Throttling & Rate Limiting
- **What:** Respect provider rate limits, queue excess messages, prioritize by urgency
- **Implement:**
  - Per-channel rate limits: `max_per_second`, `max_per_minute`, `max_per_hour`
  - Priority queue: critical > high > normal > low (critical never throttled)
  - `GET /v1/notification/throttle/status` — current queue depth, delivery rate, backpressure
  - `PATCH /v1/notification/channels/:id/rate-limits` — admin configures per-channel limits
  - Schema: Add `priority varchar(8)` to delivery table, rate limit config to channel table
- **Domain:** `shouldThrottle(channel, currentRate, limit)`, `priorityQueue(deliveries)`

### Gap 5: Rich Push Notifications
- **What:** Push notifications with images, action buttons, deep links
- **Implement:**
  - Template extension: `push_image_url`, `push_actions` (array of {label, deepLink})
  - `POST /v1/notification/send` — accepts rich payload for push channel
  - Platform-specific: APNs (iOS) with `mutable-content`, FCM (Android) with `data` payload
  - Schema: Extend template schema with `push_config jsonb` (image, actions, badge_count)
- **Domain:** `buildAPNsPayload(template, variables)`, `buildFCMPayload(template, variables)`

### Gap 6: In-App Notification Center
- **What:** Persistent in-app inbox with read/unread state, mark-all-read, infinite scroll
- **Implement:**
  - `GET /v1/notification/inbox/me?limit=20&cursor=X` — paginated inbox (newest first)
  - `PATCH /v1/notification/inbox/:id/read` — mark single as read
  - `POST /v1/notification/inbox/mark-all-read` — mark all as read
  - `GET /v1/notification/inbox/me/unread-count` — badge count for UI
  - `DELETE /v1/notification/inbox/:id` — dismiss notification
  - Schema: `inbox.user_inbox` (id, user_id, tenant_id, title, body, deep_link, read, created_at) — already exists, extend
- **Domain:** `computeUnreadCount(userId)`, `cursorPaginate(inbox, cursor, limit)`

### Gap 7: Webhook Delivery (Customer-Defined Callbacks)
- **What:** Tenants register webhook URLs to receive event notifications programmatically
- **Implement:**
  - `POST /v1/notification/webhooks` — register webhook (url, events_filter, secret)
  - On matching event: POST to webhook URL with signed payload (HMAC-SHA256)
  - Retry with exponential backoff (3 attempts), then mark failed
  - `GET /v1/notification/webhooks` — list registered webhooks with delivery stats
  - `GET /v1/notification/webhooks/:id/deliveries` — recent delivery attempts + response codes
  - Schema: `channels.webhook_registrations`, `channels.webhook_deliveries`
- **Domain:** `signPayload(payload, secret)`, `shouldRetry(statusCode, attemptCount)`, `exponentialBackoff(attempt)`

### Gap 8: Notification Digest (Batching)
- **What:** Batch low-priority notifications into a single daily/weekly digest email
- **Implement:**
  - User preference: `digest_frequency` (immediate | daily | weekly) per category
  - Scheduler: at configured time, collect pending digest notifications → merge into single email
  - `GET /v1/notification/digest/preview?userId=X` — preview what the next digest will contain
  - Schema: `deliveries.digest_queue` (user_id, notification_id, queued_at, digest_sent_at)
- **Domain:** `groupForDigest(pending, frequency)`, `renderDigestEmail(groupedNotifications)`

---

## Phase C–F: Same structure as Module 01

Implementation order: In-App Center → Preference Center → WhatsApp → Throttling → Engagement Analytics → Rich Push → Webhooks → Digest

**TOTAL: _/10**
