You are building the Establishment module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/establishment-module/web/
  Key screens: dashboard.html, file-management.html, file-detail.html, noting.html,
  dispatch.html, inward.html, committee.html, committee-meeting.html, resolution.html,
  vehicle.html, vehicle-booking.html, guesthouse.html, guesthouse-booking.html,
  library.html, court-case.html, meeting-room.html

ERPNext reference: ~/CivitasOne/erpnext-develop/erpnext/

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.6

Service: services/estab-service
  DB: civitas_estab, role: estab_svc, password: estab_dev_pw
Prefix: estab_

## Modules inside estab-service (L2 schemas)
src/modules/
  files/     — noting, file movement, dispatch, inward dak
  committee/ — committees, meetings, resolutions, minutes
  assets/    — vehicle management, driver, bookings
  facilities/ — guesthouse, meeting rooms, library
  legal/     — court cases, RTI tracking

## Step 1 — Migration
services/estab-service/migrations/0001_init.sql:
  Schema files:      estab_files, estab_notings, estab_dispatch, estab_inward
  Schema committee:  estab_committees, estab_meetings, estab_resolutions, estab_attendees
  Schema assets:     estab_vehicles, estab_drivers, estab_vehicle_bookings
  Schema facilities: estab_guesthouses, estab_rooms, estab_room_bookings, estab_library_books, estab_issues
  Schema legal:      estab_court_cases, estab_case_dates, estab_rti_requests

Critical constraints:
- estab_files.status check in ('draft','active','closed','archived')
- estab_files.classification check in ('top_secret','secret','confidential','public')
- estab_notings: append-only (no UPDATE allowed on noting body after creation)
- estab_vehicle_bookings.status check in ('pending','approved','in_use','returned','cancelled')
- estab_room_bookings: no overlapping bookings for same room (enforce in domain)
- estab_rti_requests: deadline date = created_at + 30 days (CPIO mandate)
- estab_court_cases.status check in ('pending','disposed','appealed','stayed')

## Step 2 — CQRS routes + consumers
Files:
  POST /estab/files                     → estab.file.create
  POST /estab/files/:id/notings         → estab.noting.add (append-only, immutable)
  PATCH /estab/files/:id/move           → estab.file.move (change assigned officer)
  PATCH /estab/files/:id/close          → estab.file.close
  POST /estab/dispatch                  → estab.dispatch.create
  POST /estab/inward                    → estab.inward.register
  GET  /estab/files/:id                 → cache → repo (with notings chain)

Committee:
  POST /estab/committees                → estab.committee.create
  POST /estab/committees/:id/meetings   → estab.meeting.create
  POST /estab/meetings/:id/resolutions  → estab.resolution.create
  PATCH /estab/meetings/:id/minutes     → estab.meeting.minutes (upload link)
  GET  /estab/committees/:id/meetings   → cache → repo

Vehicles:
  POST /estab/vehicles                  → estab.vehicle.create
  POST /estab/vehicle-bookings          → estab.vehicle.book
    Consumer: check vehicle availability (no overlap in domain), approve/reject
  PATCH /estab/vehicle-bookings/:id/return → estab.vehicle.return
  GET  /estab/vehicles/:id              → cache → repo

Facilities:
  POST /estab/guesthouses               → estab.guesthouse.create
  POST /estab/room-bookings             → estab.room.book
    Consumer: check room availability window, reject if overlap
  PATCH /estab/room-bookings/:id/checkin  → estab.room.checkin
  PATCH /estab/room-bookings/:id/checkout → estab.room.checkout
  POST /estab/library/books             → estab.library.add
  POST /estab/library/issues            → estab.library.issue (to employee)

Legal/RTI:
  POST /estab/court-cases               → estab.court_case.create
  PATCH /estab/court-cases/:id/date     → estab.court_case.next_date
  POST /estab/rti                       → estab.rti.create
    Consumer: set deadline = now + 30 days, emit notification to CPIO
  PATCH /estab/rti/:id/respond          → estab.rti.respond

## Step 3 — Domain rules
- Noting body is immutable after creation (consumer checks _inbox.processed, no UPDATE)
- Vehicle booking overlap: check no approved/in_use booking exists for same vehicle in time window
- Room booking overlap: same check for rooms
- RTI 30-day SLA: deadline tracked, emit estab.rti.overdue event if not responded
- File classification 'top_secret' requires break-glass access — emit audit event on any read

## Step 4 — Events
estab.file.moved      → notification-service (new assignee notified)
estab.rti.created     → notification-service (CPIO alert)
estab.rti.overdue     → notification-service (reminder after 25 days)
estab.resolution.created → notification-service (committee members)
estab.court_case.date_set → notification-service (concerned officer)

## Step 5 — Tests
- Noting immutability: second noting add to same noting ID is idempotent, body not overwritten
- Room overlap: booking same room for overlapping window → consumer emits estab.room.conflict
- RTI deadline: deadline computed as created_at + 30 days in consumer
- CQRS: POST /estab/rti → SQS → consumer → DB (MemoryQueue + MemoryCache)

## Step 6 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=estab_dev_pw -i civitasone-postgres \
  psql -U estab_svc -d civitas_estab < services/estab-service/migrations/0001_init.sql
cd services/estab-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Note any government-specific file classification rules in screens.
