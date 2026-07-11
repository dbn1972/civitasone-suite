# Court Module (Flutter) — CivitasOne Mobile

A real, API-backed court module for the CivitasOne mobile app. It consumes the
**court-service** REST APIs (dashboard KPIs, case browsing, a case detail view,
and a public citizen case-status lookup with an OTP gate).

> **Authored against the LIVE API shapes** running on the build box
> (`http://127.0.0.1:3034`, gateway path prefix `/v1/court/*` and `/v1/public/*`).
> Every `fromJson` field name was verified byte-for-byte against real responses.
>
> **Not compiled here.** The build box has **no Flutter/Dart toolchain**, so
> `dart analyze` / `flutter build` could **not** be run. Code was written by
> mirroring the existing app's patterns exactly. Run `flutter pub get` +
> `dart analyze` on a machine with Flutter **>= 3.22** (Dart SDK `>=3.3.0`)
> before shipping.

## Drop-in install

1. Copy this whole folder into the app:

   ```
   cp -r mobile/* apps/mobile/lib/features/court/
   ```

   Resulting layout:

   ```
   apps/mobile/lib/features/court/
     models/court_case.dart
     models/court_analytics.dart
     models/public_case_status.dart
     models/establishment.dart
     data/court_api.dart
     providers/court_providers.dart
     screens/court_dashboard_screen.dart
     screens/cases_list_screen.dart
     screens/case_detail_screen.dart
     screens/public_lookup_screen.dart
     court_routes.dart
   ```

   The relative imports assume exactly this location — `../../../core/api_client.dart`
   and `../../../core/providers.dart` resolve to `apps/mobile/lib/core/*`.

2. Register the routes in `apps/mobile/lib/main.dart` (same idiom as
   `hrShellRoutes()` / `hrFullScreenRoutes()`):

   ```dart
   import 'features/court/court_routes.dart';

   // inside the authenticated ShellRoute(routes: [...]):
   ...courtShellRoutes(),

   // inside the top-level GoRouter routes: [...] (full-screen, un-shelled):
   ...courtFullScreenRoutes(),
   ```

   Add a dashboard entry point (e.g. a `_modules` card in `DashboardScreen`)
   pointing at `/court/dashboard`.

## Wiring (Dio / base URL / auth)

- **No new HTTP client.** `CourtApi` wraps the app's shared `ApiClient`
  (`core/api_client.dart`) via `courtApiProvider`, exactly like
  `features/reports/quick_reports_screen.dart` uses `apiClientProvider`.
- **Auth is attached the same way as every other feature** — the `ApiClient`
  request interceptor injects `Authorization: Bearer <token>` from
  `PkceAuthService.accessToken()` (with transparent refresh + 401 retry). This
  module never sets headers itself.
- **Base URL** comes from `apiBaseProvider`
  (`--dart-define=API_BASE=...`, default `http://10.0.2.2:8080`). The court-service
  runs on `:3034`; in a deployed environment the **gateway proxies** `/v1/court/*`
  and `/v1/public/*` to court-service, so the app keeps using the gateway base URL.
  For direct-to-service testing, point `API_BASE` at the court-service origin.

## Endpoints consumed (only the ones that exist — no invented routes)

Authenticated (`court_admin` / `judge` / registrar roles):

| Method | Path                          | Used by |
|--------|-------------------------------|---------|
| GET    | `/v1/court/cases`             | `listCases({limit, offset, status})` |
| GET    | `/v1/court/cases/:id`         | `getCase(id)` |
| GET    | `/v1/court/cases/analytics`   | `analytics({from, to})` |
| GET    | `/v1/court/cases/pendency`    | `pendency()` |
| GET    | `/v1/court/cases/overdue`     | `overdue({asOf})` |

Public (no auth):

| Method | Path                            | Used by |
|--------|---------------------------------|---------|
| GET    | `/v1/public/establishments`     | `publicEstablishments()` |
| POST   | `/v1/public/case-status/otp`    | `requestOtp({mobile})` |
| POST   | `/v1/public/case-status`        | `publicCaseStatus({cnr, slug, challengeId, otp, captchaToken})` |

## Model ⇄ live-JSON field mapping (verified)

**`CourtCase`** (from `/v1/court/cases[/:id]`, `/overdue`):
`id, tenantId, cnrNumber, caseType, filingNumber, filingDate, title, status,
stage, courtId, benchId, disposalDate, targetDisposalDate, createdAt, updatedAt,
version` (+ `parties[]` on detail only). Date-only strings (`filingDate`,
`targetDisposalDate`, `disposalDate`) and ISO timestamps are parsed with
`DateTime.tryParse`; nulls are tolerated (`filingNumber`, `benchId`,
`disposalDate` are `null` in live data).

**`CaseParty`** (detail `parties[]`): only the non-PII columns are modelled —
`id, partyRole, advocateName, advocateBarId`. Name/address/phone/email are
AES-256-GCM ciphertext server-side (DPDP Act 2023) and are intentionally not
surfaced.

**`CourtAnalytics`** (`/analytics`): `period.{from,to}, instituted, disposed,
pending, avgPendencyDays, oldestPendingDays, clearanceRatePct, source`.

**`PendencySummary`** (`/pendency`): `summary[].{status,count}, total, source`.

**`OverdueCases`** (`/overdue`): `items[] (CourtCase), count, asOf`.

**`Establishment`** (`/public/establishments`): `courtName, publicSlug,
establishmentCode, publicUrl`.

**`OtpChallenge`** (`/case-status/otp`): `challengeId, expiresInSec, devOtp?`
(`devOtp` is test-only; the service returns it solely when `NODE_ENV=test`).

**`PublicDocket` / `PublicCaseStatus`** (`/case-status`): response is
`{ case: {cnrNumber, caseType, title, status, stage, filingDate, disposalDate},
accessMode, source }` — deliberately PII-free.

## Screens

- **`CourtDashboardScreen`** (`/court/dashboard`) — KPI tiles (clearance rate,
  pending, overdue count, avg pendency) from `analytics` + `overdue`, plus a
  pendency-by-status breakdown and navigation cards.
- **`CasesListScreen`** (`/court/cases`) — status filter chips + case cards
  (CNR, title, type tag, status pill, target-disposal date with overdue flag).
- **`CaseDetailScreen`** (`/court/cases/:id`) — full case metadata + parties.
- **`PublicLookupScreen`** (`/court/public-lookup`) — citizen CNR + OTP flow:
  request OTP → enter CNR + OTP → render the PII-free docket. Also lists the
  public court directory.

## Assumptions & notes

- **Plain Dart models, not freezed** — matches the app (see
  `features/stock_scanner/models.dart`, `features/invoicing/invoice_model.dart`);
  the app has no `freezed`/`build_runner` in `pubspec.yaml`.
- **Riverpod** providers mirror `features/citizen_requests/providers.dart`
  (`Provider` + `FutureProvider.autoDispose` + `.family`). Unlike the offline
  sync features, court reads hit the REST API directly (like Quick Reports),
  since court-service is a live service with no local SQLite mailbox yet.
- The **case-status request body uses the key `cnr`** (not `cnrNumber`) and, for
  OTP-gated courts, `challengeId` + `otp` — confirmed against the service's
  `lookupBody` zod validator and live 400/`OTP_REQUIRED` responses.
- `dart analyze` **could not be run on the build box (no toolchain).** Validate
  on a Flutter >= 3.22 host before merging into `apps/mobile`.
```
