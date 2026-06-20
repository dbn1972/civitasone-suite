You are building production-ready Flutter module screens for CivitasOne mobile app.
Read CLAUDE.md, `apps/mobile/lib/main.dart`, `apps/mobile/lib/core/sync/sync_engine.dart`, and `apps/mobile/lib/core/auth/pkce_auth.dart` first.

## Architecture constraints

- **Offline-first**: every list screen reads from `SyncDatabase` (SQLite) via `db.listEntities(mailbox)`. Network sync happens in background via `SyncEngine.syncMailbox(mailbox)`.
- **Auth**: all API calls go through `PkceAuthService.accessToken()` — Bearer token in Authorization header.
- **State**: Riverpod `AsyncNotifierProvider` per module. No `setState` in lists.
- **Navigation**: GoRouter. All routes registered in main.dart under the authenticated shell route.
- **API base**: `const String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:8080')` — gateway port 8080.
- **Design**: Material 3, `useMaterial3: true`. No custom design system needed — clean ListTile / Card layouts.
- **No hardcoded data** — every screen syncs then reads from SQLite.

## Step 1 — Core providers (`lib/core/providers.dart`)

Create `lib/core/providers.dart` with:
```dart
final apiBaseProvider = Provider((_) => const String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:8080'));
final authProvider = Provider((_) => PkceAuthService());
final dbProvider = FutureProvider((ref) => SyncDatabase.open());
final syncEngineProvider = Provider((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return null;
  return SyncEngine(db: db, auth: ref.read(authProvider), apiBase: ref.read(apiBaseProvider));
});
```

Update `main.dart` to import `core/providers.dart` and remove the inline provider declarations.

## Step 2 — Module screens to build

Build each screen as `lib/features/{module}/{module}_list_screen.dart`.
Each screen follows this template:

```dart
class FinancePaymentsScreen extends ConsumerStatefulWidget { ... }
class _State extends ConsumerState<FinancePaymentsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('payments');
    });
  }
  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Payments')),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('payments'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!;
            if (items.isEmpty) return const Center(child: Text('No data — pull to refresh'));
            return RefreshIndicator(
              onRefresh: () async => ref.read(syncEngineProvider)?.syncMailbox('payments'),
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (ctx, i) => ListTile(
                  title: Text(items[i]['data']['reference'] as String? ?? items[i]['id']),
                  subtitle: Text(items[i]['data']['status'] as String? ?? ''),
                  trailing: Text(items[i]['data']['amountMinor']?.toString() ?? ''),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
```

### Screens to create

| File | Route | Mailbox | Title | Key fields shown |
|------|-------|---------|-------|-----------------|
| `lib/features/finance/payments_screen.dart` | `/finance/payments` | `payments` | Payments | reference, amountMinor, status |
| `lib/features/finance/journal_screen.dart` | `/finance/journals` | `journals` | Journal Entries | voucherNo, totalDebitMinor, status |
| `lib/features/hr/employees_screen.dart` | `/hr/employees` | `employees` | Employees | name, designation, department |
| `lib/features/hr/leave_screen.dart` | `/hr/leave` | `leave_requests` | Leave Requests | employeeName, leaveType, status, days |
| `lib/features/hr/attendance_screen.dart` | `/hr/attendance` | `attendance` | Attendance | employeeCode, date, status |
| `lib/features/procurement/indents_screen.dart` | `/procurement/indents` | `indents` | Purchase Indents | indentNo, department, status |
| `lib/features/procurement/pos_screen.dart` | `/procurement/pos` | `purchase_orders` | Purchase Orders | poNumber, vendor, amountMinor, status |
| `lib/features/procurement/approvals_screen.dart` | `/procurement/approvals` | `approvals` | Approvals | title, type, requestedBy, status |
| `lib/features/crm/contacts_screen.dart` | `/crm/contacts` | `crm_contacts` | Contacts | name, email, phone, organisation |
| `lib/features/crm/deals_screen.dart` | `/crm/deals` | `crm_deals` | Deals | title, stage, amountMinor, owner |
| `lib/features/helpdesk/tickets_screen.dart` | `/helpdesk/tickets` | `helpdesk_tickets` | Tickets | ticketNo, subject, status, priority |
| `lib/features/projects/projects_screen.dart` | `/projects` | `projects` | Projects | name, status, startDate, budget |
| `lib/features/estab/files_screen.dart` | `/estab/files` | `estab_files` | Files | fileNo, subject, status, classification |
| `lib/features/mis/mis_screen.dart` | `/mis` | `mis_metrics` | MIS Dashboard | label, value, note (MetricCard shape) |

For `/mis` screen, render a GridView of cards (2 columns) instead of ListView, each card showing `label` in subtitle and `value` large.

## Step 3 — Navigation shell (`lib/core/shell/app_shell.dart`)

Create a `NavigationDrawer`-based shell widget:

```dart
class AppShell extends StatelessWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  static const _navItems = [
    (label: 'Dashboard', icon: Icons.dashboard, route: '/dashboard'),
    (label: 'Approvals', icon: Icons.approval, route: '/procurement/approvals'),
    (label: 'Finance', icon: Icons.account_balance, route: '/finance/payments'),
    (label: 'HR', icon: Icons.people, route: '/hr/employees'),
    (label: 'Procurement', icon: Icons.shopping_cart, route: '/procurement/indents'),
    (label: 'CRM', icon: Icons.contacts, route: '/crm/contacts'),
    (label: 'Helpdesk', icon: Icons.support_agent, route: '/helpdesk/tickets'),
    (label: 'Projects', icon: Icons.folder, route: '/projects'),
    (label: 'Estab Files', icon: Icons.description, route: '/estab/files'),
    (label: 'MIS', icon: Icons.bar_chart, route: '/mis'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: NavigationDrawer(children: [
        const DrawerHeader(child: Text('CivitasOne', style: TextStyle(fontSize: 20))),
        for (final item in _navItems)
          ListTile(leading: Icon(item.icon), title: Text(item.label), onTap: () {
            Navigator.of(context).pop();
            context.go(item.route);
          }),
      ]),
      body: child,
    );
  }
}
```

## Step 4 — Update GoRouter in main.dart

Wrap all authenticated routes in a `ShellRoute` using `AppShell`.
Add all routes from Step 2 table.
Add auth guard: if `authProvider.accessToken() == null`, redirect to `/login`.

```dart
GoRoute(path: '/login', builder: (_, __) => LoginScreen(auth: ref.read(authProvider))),
ShellRoute(
  builder: (ctx, state, child) => AppShell(child: child),
  routes: [
    GoRoute(path: '/dashboard', builder: (_, __) => const DashboardScreen()),
    GoRoute(path: '/finance/payments', builder: (_, __) => const PaymentsScreen()),
    // ... all routes from Step 2
  ],
),
```

## Step 5 — Dashboard screen with module grid

Replace `DashboardScreen` with a real grid:

```dart
class DashboardScreen extends StatelessWidget {
  static const modules = [
    (label: 'Approvals', icon: Icons.approval, route: '/procurement/approvals', color: Color(0xFF6366F1)),
    (label: 'Finance', icon: Icons.account_balance, route: '/finance/payments', color: Color(0xFF22C55E)),
    (label: 'HR', icon: Icons.people, route: '/hr/employees', color: Color(0xFFF59E0B)),
    (label: 'Procurement', icon: Icons.shopping_cart, route: '/procurement/indents', color: Color(0xFFEF4444)),
    (label: 'CRM', icon: Icons.contacts, route: '/crm/contacts', color: Color(0xFF8B5CF6)),
    (label: 'Helpdesk', icon: Icons.support_agent, route: '/helpdesk/tickets', color: Color(0xFF06B6D4)),
    (label: 'Projects', icon: Icons.folder, route: '/projects', color: Color(0xFFEC4899)),
    (label: 'MIS', icon: Icons.bar_chart, route: '/mis', color: Color(0xFF10B981)),
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('CivitasOne')),
    body: GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, childAspectRatio: 1.2, crossAxisSpacing: 12, mainAxisSpacing: 12),
      itemCount: modules.length,
      itemBuilder: (ctx, i) {
        final m = modules[i];
        return InkWell(
          onTap: () => context.go(m.route),
          borderRadius: BorderRadius.circular(12),
          child: Container(
            decoration: BoxDecoration(color: m.color.withOpacity(0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: m.color.withOpacity(0.3))),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(m.icon, size: 36, color: m.color),
              const SizedBox(height: 8),
              Text(m.label, style: TextStyle(fontWeight: FontWeight.w600, color: m.color)),
            ]),
          ),
        );
      },
    ),
  );
}
```

## Step 6 — pubspec.yaml dependencies

Ensure `apps/mobile/pubspec.yaml` has:
```yaml
dependencies:
  flutter_riverpod: ^2.5.1
  go_router: ^14.0.0
  dio: ^5.4.3
  connectivity_plus: ^6.0.3
  flutter_appauth: ^7.0.0
  flutter_secure_storage: ^9.2.2
  sqflite: ^2.3.3
  uuid: ^4.4.0
```

Add any missing dependencies with `flutter pub add`.

## Deliverables

- `lib/core/providers.dart` — shared providers
- `lib/core/shell/app_shell.dart` — navigation drawer shell
- `lib/features/{finance,hr,procurement,crm,helpdesk,projects,estab,mis}/*.dart` — 14 screen files
- Updated `lib/main.dart` — ShellRoute + all routes registered
- `apps/mobile/pubspec.yaml` — all deps present

## Verification

```bash
cd apps/mobile
flutter pub get
flutter analyze
```

Fix any analyzer warnings before finishing. Do not run `flutter test` — no widget tests exist yet.
