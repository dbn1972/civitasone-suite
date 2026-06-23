import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';

void main() {
  late SyncDatabase db;
  late Database raw;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    // openDatabase with no options — SyncDatabase.openInMemory creates tables.
    // sqflite caches open databases by path, and `:memory:` is one shared path,
    // so we must close in tearDown to give each test an isolated database.
    raw = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
    db = await SyncDatabase.openInMemory(raw);
  });

  tearDown(() async {
    await raw.close();
  });

  group('enqueueOutbox', () {
    test('inserts an entry and returns a UUID', () async {
      final id = await db.enqueueOutbox(
        mailbox: 'approvals',
        operation: 'approve',
        entityId: 'entity-1',
        payload: {'entityId': 'entity-1', 'decision': 'approved', 'comment': ''},
      );

      expect(id, isNotEmpty);
      final entries = await db.listOutbox('approvals');
      expect(entries.length, 1);
      expect(entries.first['operation'], 'approve');
      expect(entries.first['status'], 'queued');
    });

    test('encodes payload as JSON in payload_json', () async {
      await db.enqueueOutbox(
        mailbox: 'leave_requests',
        operation: 'create',
        entityId: 'entity-2',
        payload: {'leaveType': 'casual', 'days': 3},
      );

      final entries = await db.listOutbox('leave_requests');
      expect(entries.first['payload_json'], contains('casual'));
      expect(entries.first['payload_json'], contains('"days":3'));
    });

    test('stores entity_id separately', () async {
      await db.enqueueOutbox(
        mailbox: 'helpdesk_tickets',
        operation: 'create',
        entityId: 'my-entity',
        payload: {'subject': 'Test'},
      );

      final entries = await db.listOutbox('helpdesk_tickets');
      expect(entries.first['entity_id'], 'my-entity');
    });
  });

  group('markOutboxDone', () {
    test('removes the entry from the queue', () async {
      final id = await db.enqueueOutbox(
        mailbox: 'approvals',
        operation: 'reject',
        entityId: 'entity-3',
        payload: {'decision': 'rejected'},
      );

      await db.markOutboxDone(id);
      final entries = await db.listOutbox('approvals');
      expect(entries.isEmpty, true);
    });
  });

  group('markOutboxFailed', () {
    test('sets status to failed and stores error message', () async {
      final id = await db.enqueueOutbox(
        mailbox: 'approvals',
        operation: 'approve',
        entityId: 'entity-4',
        payload: {},
      );

      await db.markOutboxFailed(id, 'network_error');

      final entry = await db.getOutboxEntry(id);
      expect(entry, isNotNull);
      expect(entry!['status'], 'failed');
      expect(entry['last_error'], 'network_error');
      expect(entry['retry_count'], 1);
      // Backoff scheduled: a failed entry is not immediately re-eligible.
      expect(entry['next_attempt_at'], isNotNull);
    });

    test('increments retry_count on each failure', () async {
      final id = await db.enqueueOutbox(
        mailbox: 'approvals',
        operation: 'approve',
        entityId: 'entity-5',
        payload: {},
      );

      await db.markOutboxFailed(id, 'err1');
      await db.markOutboxFailed(id, 'err2');
      final entry = await db.getOutboxEntry(id);
      expect(entry!['retry_count'], 2);
    });

    test('dead-letters after the retry cap and drops out of listOutbox', () async {
      final id = await db.enqueueOutbox(
        mailbox: 'approvals',
        operation: 'approve',
        entityId: 'entity-6',
        payload: {},
      );

      for (var i = 0; i < 5; i++) {
        await db.markOutboxFailed(id, 'err');
      }
      final entry = await db.getOutboxEntry(id);
      expect(entry!['status'], 'dead');
      expect(await db.listOutbox('approvals'), isEmpty);
    });
  });

  group('listEntities / upsertEntity', () {
    test('upserts and lists entities', () async {
      await db.upsertEntity(
        id: 'e1',
        mailbox: 'approvals',
        data: {'title': 'PO Approval', 'status': 'pending'},
        updatedAt: '2026-06-20T10:00:00Z',
      );

      final items = await db.listEntities('approvals');
      expect(items.length, 1);
      expect((items.first['data'] as Map<String, dynamic>)['title'], 'PO Approval');
    });

    test('upsert replaces existing entity', () async {
      await db.upsertEntity(
        id: 'e2',
        mailbox: 'approvals',
        data: {'status': 'pending'},
        updatedAt: '2026-06-20T10:00:00Z',
      );
      await db.upsertEntity(
        id: 'e2',
        mailbox: 'approvals',
        data: {'status': 'approved'},
        updatedAt: '2026-06-20T11:00:00Z',
      );

      final items = await db.listEntities('approvals');
      expect(items.length, 1);
      expect((items.first['data'] as Map<String, dynamic>)['status'], 'approved');
    });
  });

  group('cursor', () {
    test('returns 0 when no cursor set', () async {
      expect(await db.getCursor('new_mailbox'), '0');
    });

    test('persists cursor after set', () async {
      await db.setCursor('approvals', 'cursor-abc');
      expect(await db.getCursor('approvals'), 'cursor-abc');
    });
  });
}
