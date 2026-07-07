import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/write_outbox.dart';
import 'package:civitasone_mobile/core/sync/sync_route_registry.dart';

void main() {
  late SyncDatabase db;
  late WriteOutbox outbox;
  late Database raw;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    raw = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
    db = await SyncDatabase.openInMemory(raw);
    outbox = WriteOutbox(db);
  });

  tearDown(() async {
    await raw.close();
  });

  group('SyncRouteRegistry', () {
    test('resolves known action to SyncRoute', () {
      final route = SyncRouteRegistry.resolve('leave.create');
      expect(route, isNotNull);
      expect(route!.service, 'hrms');
      expect(route.topic, 'hrms.leave.create');
      expect(route.endpoint, '/v1/hrms/leaves');
      expect(route.method, 'POST');
    });

    test('resolves update action with PATCH method', () {
      final route = SyncRouteRegistry.resolve('leave.update');
      expect(route, isNotNull);
      expect(route!.method, 'PATCH');
    });

    test('returns null for unknown action', () {
      expect(SyncRouteRegistry.resolve('nonexistent.action'), isNull);
    });

    test('hasRoute returns true for registered actions', () {
      expect(SyncRouteRegistry.hasRoute('attendance.mark'), isTrue);
      expect(SyncRouteRegistry.hasRoute('unknown'), isFalse);
    });

    test('actions returns all registered keys', () {
      final actions = SyncRouteRegistry.actions.toList();
      expect(actions, contains('leave.create'));
      expect(actions, contains('deal.create'));
      expect(actions, contains('approval.approve'));
    });

    test('covers all major mobile write domains', () {
      // Verify routes exist for each domain service
      final domains = ['hrms', 'finance', 'procurement', 'crm', 'helpdesk',
                       'project', 'citizen', 'estab', 'inventory', 'asset',
                       'workflow', 'contract', 'knowledge'];
      for (final domain in domains) {
        final hasService = SyncRouteRegistry.routes.values
            .any((r) => r.service == domain);
        expect(hasService, isTrue, reason: 'Missing route for domain: $domain');
      }
    });
  });

  group('WriteOutbox.enqueue', () {
    test('enqueues by action key and returns UUID', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {'leaveType': 'casual', 'days': 3},
      );

      expect(id, isNotEmpty);
      expect(id.length, 36); // UUID v4 format
    });

    test('persists entry with correct topic from registry', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {'leaveType': 'casual'},
      );

      final entry = await outbox.getById(id);
      expect(entry, isNotNull);
      expect(entry!.topic, 'hrms.leave.create');
      expect(entry.service, 'hrms');
      expect(entry.endpoint, '/v1/hrms/leaves');
      expect(entry.method, 'POST');
      expect(entry.status, WriteOutboxStatus.pending);
      expect(entry.retryCount, 0);
    });

    test('stores payload correctly', () async {
      final payload = {'amount': 5000, 'currency': 'INR', 'note': 'Test'};
      final id = await outbox.enqueue(action: 'bill.create', payload: payload);

      final entry = await outbox.getById(id);
      expect(entry!.payload['amount'], 5000);
      expect(entry.payload['currency'], 'INR');
      expect(entry.payload['note'], 'Test');
    });

    test('throws ArgumentError for unregistered action', () async {
      expect(
        () => outbox.enqueue(action: 'unknown.action', payload: {}),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('enqueues update actions with PATCH method', () async {
      final id = await outbox.enqueue(
        action: 'deal.update',
        payload: {'dealId': 'd1', 'stage': 'negotiation'},
      );

      final entry = await outbox.getById(id);
      expect(entry!.topic, 'crm.deal.update');
      expect(entry.method, 'PATCH');
    });
  });

  group('WriteOutbox.enqueueWithTopic', () {
    test('enqueues directly by topic', () async {
      final id = await outbox.enqueueWithTopic(
        topic: 'custom.topic.create',
        payload: {'key': 'value'},
        service: 'custom',
        endpoint: '/v1/custom/things',
      );

      final entry = await outbox.getById(id);
      expect(entry!.topic, 'custom.topic.create');
      expect(entry.service, 'custom');
      expect(entry.endpoint, '/v1/custom/things');
      expect(entry.method, 'POST');
    });
  });

  group('WriteOutbox.getPending', () {
    test('returns only pending entries in creation order', () async {
      final id1 = await outbox.enqueue(action: 'leave.create', payload: {'a': 1});
      final id2 = await outbox.enqueue(action: 'ticket.create', payload: {'b': 2});

      final pending = await outbox.getPending();
      expect(pending.length, 2);
      expect(pending[0].id, id1);
      expect(pending[1].id, id2);
    });

    test('excludes synced entries', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.markSynced(id);

      final pending = await outbox.getPending();
      expect(pending, isEmpty);
    });

    test('excludes dead entries', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.moveToDead(id, 'validation_error');

      final pending = await outbox.getPending();
      expect(pending, isEmpty);
    });
  });

  group('WriteOutbox.getUnsynced', () {
    test('includes both pending and syncing entries', () async {
      final id1 = await outbox.enqueue(action: 'leave.create', payload: {});
      final id2 = await outbox.enqueue(action: 'ticket.create', payload: {});
      await outbox.markSyncing(id2);

      final unsynced = await outbox.getUnsynced();
      expect(unsynced.length, 2);
      expect(unsynced.map((e) => e.id), containsAll([id1, id2]));
    });
  });

  group('WriteOutbox.markSynced', () {
    test('sets status to synced and records synced_at', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.markSynced(id);

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.synced);
      expect(entry.syncedAt, isNotNull);
    });
  });

  group('WriteOutbox.moveToDead', () {
    test('sets status to dead and stores error', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.moveToDead(id, '422: Business rule violation');

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
      expect(entry.lastError, '422: Business rule violation');
    });

    test('dead entries appear in getDead()', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.moveToDead(id, 'error');

      final dead = await outbox.getDead();
      expect(dead.length, 1);
      expect(dead.first.id, id);
    });
  });

  group('WriteOutbox.incrementRetry', () {
    test('increments retry count and stores error', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.incrementRetry(id, 'timeout');

      final entry = await outbox.getById(id);
      expect(entry!.retryCount, 1);
      expect(entry.lastError, 'timeout');
      expect(entry.status, WriteOutboxStatus.pending);
    });

    test('accumulates retries across multiple failures', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.incrementRetry(id, 'err1');
      await outbox.incrementRetry(id, 'err2');
      await outbox.incrementRetry(id, 'err3');

      final entry = await outbox.getById(id);
      expect(entry!.retryCount, 3);
      expect(entry.lastError, 'err3');
    });
  });

  group('WriteOutbox.retryDead', () {
    test('resets dead entry back to pending', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.moveToDead(id, 'server_error');
      await outbox.retryDead(id);

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.pending);
      expect(entry.lastError, isNull);
    });
  });

  group('WriteOutbox counts', () {
    test('unsyncedCount returns pending + syncing count', () async {
      await outbox.enqueue(action: 'leave.create', payload: {});
      final id2 = await outbox.enqueue(action: 'ticket.create', payload: {});
      await outbox.markSyncing(id2);
      final id3 = await outbox.enqueue(action: 'deal.create', payload: {});
      await outbox.markSynced(id3);

      expect(await outbox.unsyncedCount, 2);
    });

    test('deadCount returns dead entry count', () async {
      final id1 = await outbox.enqueue(action: 'leave.create', payload: {});
      final id2 = await outbox.enqueue(action: 'ticket.create', payload: {});
      await outbox.moveToDead(id1, 'err');
      await outbox.moveToDead(id2, 'err');

      expect(await outbox.deadCount, 2);
    });
  });

  group('WriteOutbox.purge', () {
    test('removes old synced entries', () async {
      // Enqueue and mark synced
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      // Manually set synced_at to 8 days ago to simulate old entry
      await db.updateWriteOutbox(id, {
        'status': WriteOutboxStatus.synced,
        'synced_at': DateTime.now().toUtc().subtract(const Duration(days: 8)).toIso8601String(),
      });

      final purged = await outbox.purge(age: const Duration(days: 7));
      expect(purged, 1);
      expect(await outbox.getById(id), isNull);
    });

    test('does not purge recent synced entries', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      await outbox.markSynced(id);

      final purged = await outbox.purge(age: const Duration(days: 7));
      expect(purged, 0);
      expect(await outbox.getById(id), isNotNull);
    });
  });

  group('WRITE_THROUGH_COMMANDS completeness', () {
    test('every enqueue maps to correct domain service topic', () async {
      // Test a representative set of actions across all services
      final actions = [
        ('leave.create', 'hrms.leave.create'),
        ('attendance.mark', 'hrms.attendance.mark'),
        ('bill.create', 'finance.bill.create'),
        ('indent.create', 'procurement.indent.create'),
        ('deal.create', 'crm.deal.create'),
        ('ticket.create', 'helpdesk.ticket.create'),
        ('task.create', 'project.task.create'),
        ('grievance.create', 'citizen.grievance.create'),
        ('approval.approve', 'workflow.approval.approve'),
        ('stock_receipt.create', 'inventory.stock-receipt.create'),
        ('asset_verification.create', 'asset.verification.create'),
      ];

      for (final (action, expectedTopic) in actions) {
        final id = await outbox.enqueue(action: action, payload: {'test': true});
        final entry = await outbox.getById(id);
        expect(entry!.topic, expectedTopic,
            reason: 'Action "$action" should map to topic "$expectedTopic"');
      }
    });
  });
}
