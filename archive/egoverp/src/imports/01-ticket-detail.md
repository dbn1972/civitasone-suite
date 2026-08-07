# Helpdesk — Ticket Detail with SLA

**SPRINT:** 10
**ROUTE:** `/helpdesk/tickets/{id}`
**SERVICE OWNER:** helpdesk-service

---

## Figma Make prompt

```
Generate the Ticket Detail screen for CivitasOne Suite.

PURPOSE: Agent view of a single helpdesk ticket with SLA countdown, conversation
thread, internal notes, related tickets, CSAT result.

LAYOUT: DetailPage shell — left main column + right metadata column

HEADER:
- Ticket subject (text.h2, editable inline by agent)
- Ticket number, status pill (Open | Pending | On Hold | Resolved | Closed)
- SLA badges: First Response SLA, Resolution SLA — countdown with color
  (success >25% remaining, warning 10–25%, danger <10% or breached)
- Primary actions: Reply, Internal Note, Resolve
- Secondary menu: Reassign, Merge, Split, Print, Delete

LEFT COLUMN — Conversation thread:
- Reverse-chronological list of messages
- Each message: avatar, sender name, timestamp, channel (email / web / call / chat), body
- Internal notes shown with intent.warning background and lock icon
- File attachments rendered with preview where possible
- Reply composer at top (collapsible):
  - Rich text editor with toolbar
  - Canned response selector
  - CC / BCC fields
  - Attach files
  - Send + close, Send + keep open, Save draft

RIGHT COLUMN — Metadata:
- Requester card (avatar, name, email, phone, previous tickets count, CSAT history)
- Properties: Priority, Category, Sub-category, Source, Type, Tags
- Assignment: Assignee, Team, Queue
- SLA detail: SLA policy applied, business hours, response/resolution targets, breach history
- Related tickets (linked + similar)
- Activity log (collapsible — all status changes, assignments, SLA events)

STATES:
- Default
- Loading: skeleton conversation + metadata
- Error
- SLA breached: prominent Banner at top intent.danger
- Awaiting customer: Banner intent.info, customer reply enables Reopen
- Resolved with CSAT: show CSAT score widget (1–5 stars + comment)

PERMISSIONS:
- View: any agent on the queue
- Reply: any agent
- Reassign across queue: Team Lead
- Delete: Helpdesk Manager + audit comment

EVENTS EMITTED:
- helpdesk.ticket.replied
- helpdesk.ticket.resolved
- helpdesk.sla.breached (background, when timer fires)

ACCESSIBILITY:
- SLA countdown has aria-live="polite" with minute updates only (not seconds, to avoid noise)
- Status pill announces via aria-label including elapsed time
- Reply composer focus trap with Esc to close
- Rich text editor toolbar buttons have descriptive aria-labels and keyboard shortcuts

OUT OF SCOPE:
- AI suggested replies (Phase 2)
- Multi-channel unification (Phase 2 — voice call recording in telephony-service)
```
