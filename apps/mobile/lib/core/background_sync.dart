import 'package:workmanager/workmanager.dart';
import 'auth/pkce_auth.dart';
import 'sync/sync_database.dart';
import 'sync/sync_engine.dart';

/// MOB-1c (02-T3): background + lifecycle sync so queued mutations flush without
/// the user reopening the screen.

const String kPeriodicSyncTask = 'civitasone.periodic-sync';

/// Mailboxes the app keeps in sync (server feeder fan-in targets).
const List<String> kKnownMailboxes = [
  'approvals',
  'notifications',
  'applications',
  'employees',
  'leave_requests',
  'attendance',
  'payments',
  'journals',
  'indents',
  'purchase_orders',
  'crm_contacts',
  'crm_deals',
  'helpdesk_tickets',
  'projects',
  'estab_files',
  'grievances',
  'vacancies',
  'holidays',
  'loans',
  'advances',
  'announcements',
  'tenant_settings',
];

const String _apiBase =
    String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:8080');
const String _issuer = String.fromEnvironment(
    'KEYCLOAK_ISSUER',
    defaultValue: 'http://10.0.2.2:8180/realms/civitasone');

/// Sync every known mailbox once (foreground use: app launch / resume).
Future<void> syncAllMailboxes(SyncEngine engine) async {
  for (final mailbox in kKnownMailboxes) {
    try {
      await engine.syncMailbox(mailbox);
    } catch (_) {
      // One mailbox failing must not stop the rest.
    }
  }
}

/// Background isolate entrypoint. Builds its own dependencies (Riverpod providers
/// are not available across isolates) and drains the outbox + pulls deltas.
@pragma('vm:entry-point')
void backgroundSyncDispatcher() {
  Workmanager().executeTask((task, _) async {
    try {
      final auth = PkceAuthService(issuer: _issuer);
      // Only sync when there's a live session.
      if (await auth.accessToken() == null) return true;
      final db = await SyncDatabase.open();
      final engine = SyncEngine(db: db, auth: auth, apiBase: _apiBase);
      await syncAllMailboxes(engine);
      return true;
    } catch (_) {
      // Returning false lets Workmanager retry per its backoff policy.
      return false;
    }
  });
}

/// Initialise Workmanager and register the periodic sync. Safe to call once at
/// startup; guarded by the caller so an unsupported platform never crashes boot.
Future<void> initBackgroundSync() async {
  await Workmanager().initialize(backgroundSyncDispatcher);
  await Workmanager().registerPeriodicTask(
    kPeriodicSyncTask,
    kPeriodicSyncTask,
    frequency: const Duration(minutes: 15),
    constraints: Constraints(networkType: NetworkType.connected),
    existingWorkPolicy: ExistingWorkPolicy.keep,
  );
}
