import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}
class MockPkceAuthService extends Mock implements PkceAuthService {}
class MockDio extends Mock implements Dio {}

Response _ok(String path, Map<String, dynamic> data) =>
    Response(requestOptions: RequestOptions(path: path), data: data, statusCode: 200);

void main() {
  late MockSyncDatabase mockDb;
  late MockPkceAuthService mockAuth;
  late MockDio mockDio;

  setUpAll(() {
    registerFallbackValue(Options());
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    mockDb = MockSyncDatabase();
    mockAuth = MockPkceAuthService();
    mockDio = MockDio();
    when(() => mockAuth.accessToken()).thenAnswer((_) async => 'test-token');
    when(() => mockAuth.getOrCreateDeviceId()).thenAnswer((_) async => 'device-1');
    when(() => mockDb.getCursor(any())).thenAnswer((_) async => '0');
    when(() => mockDb.setCursor(any(), any())).thenAnswer((_) async {});
    when(() => mockDb.getEntityEtag(any())).thenAnswer((_) async => null);
    when(() => mockDb.hasPendingOutboxForEntity(any())).thenAnswer((_) async => false);
  });

  group('offline-then-reconnect (10-T5)', () {
    final queued = {
      'id': 'outbox-off-1',
      'mailbox': 'approvals',
      'operation': 'approve',
      'entity_id': 'e-off',
      'payload_json': '{"entityId":"e-off","decision":"approved"}',
      'created_at': '2026-06-20T10:00:00Z',
      'status': 'queued',
      'retry_count': 0,
    };

    test('offline: nothing is pushed, mutation stays queued', () async {
      when(() => mockDb.listOutbox(any())).thenAnswer((_) async => [queued]);
      final engine = SyncEngine(
        db: mockDb, auth: mockAuth, apiBase: 'http://x', dio: mockDio,
        isOnlineOverride: () async => false,
      );

      await engine.syncMailbox('approvals');

      verifyNever(() => mockDio.post(any(), data: any(named: 'data'), options: any(named: 'options')));
      verifyNever(() => mockDb.markOutboxDone(any()));
    });

    test('back online: the queued mutation flushes and is marked done', () async {
      when(() => mockDb.listOutbox(any())).thenAnswer((_) async => [queued]);
      when(() => mockDb.markOutboxDone(any())).thenAnswer((_) async {});
      when(() => mockDio.post('/api/v1/sync/push', data: any(named: 'data'), options: any(named: 'options')))
          .thenAnswer((_) async => _ok('/api/v1/sync/push', {
                'cursor': 'c2',
                'results': [
                  {'clientMutationId': 'outbox-off-1', 'status': 'applied', 'etag': 'e1'},
                ],
              }));
      when(() => mockDio.post('/api/v1/sync/pull', data: any(named: 'data'), options: any(named: 'options')))
          .thenAnswer((_) async => _ok('/api/v1/sync/pull', {'cursor': 'c3', 'entities': []}));

      final engine = SyncEngine(
        db: mockDb, auth: mockAuth, apiBase: 'http://x', dio: mockDio,
        isOnlineOverride: () async => true,
      );

      await engine.syncMailbox('approvals');

      verify(() => mockDb.markOutboxDone('outbox-off-1')).called(1);
    });
  });

  group('conflict handling (02-T4)', () {
    test('a conflict result adopts server state and stops retrying', () async {
      final entry = {
        'id': 'outbox-cf-1',
        'mailbox': 'approvals',
        'operation': 'update',
        'entity_id': 'e-cf',
        'payload_json': '{"entityId":"e-cf","v":2}',
        'created_at': '2026-06-20T10:00:00Z',
        'status': 'queued',
        'retry_count': 0,
      };
      when(() => mockDb.listOutbox(any())).thenAnswer((_) async => [entry]);
      when(() => mockDb.markOutboxFailed(any(), any(), permanent: any(named: 'permanent')))
          .thenAnswer((_) async {});
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'), mailbox: any(named: 'mailbox'), data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'), etag: any(named: 'etag'), syncState: any(named: 'syncState'),
          )).thenAnswer((_) async {});
      when(() => mockDio.post('/api/v1/sync/push', data: any(named: 'data'), options: any(named: 'options')))
          .thenAnswer((_) async => _ok('/api/v1/sync/push', {
                'cursor': 'c2',
                'results': [
                  {
                    'clientMutationId': 'outbox-cf-1',
                    'status': 'conflict',
                    'reason': 'stale_base_version',
                    'etag': 'server-etag',
                    'serverData': {'id': 'e-cf', 'v': 9},
                  },
                ],
              }));
      when(() => mockDio.post('/api/v1/sync/pull', data: any(named: 'data'), options: any(named: 'options')))
          .thenAnswer((_) async => _ok('/api/v1/sync/pull', {'cursor': 'c3', 'entities': []}));

      final engine = SyncEngine(
        db: mockDb, auth: mockAuth, apiBase: 'http://x', dio: mockDio,
        isOnlineOverride: () async => true,
      );

      await engine.syncMailbox('approvals');

      verify(() => mockDb.markOutboxFailed('outbox-cf-1', 'stale_base_version', permanent: true)).called(1);
      verify(() => mockDb.upsertEntity(
            id: 'e-cf', mailbox: 'approvals', data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'), etag: 'server-etag', syncState: 'conflict',
          )).called(1);
    });

    test('pull does not clobber an entity with a pending local edit', () async {
      when(() => mockDb.listOutbox(any())).thenAnswer((_) async => []);
      when(() => mockDb.hasPendingOutboxForEntity('e-pending')).thenAnswer((_) async => true);
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'), mailbox: any(named: 'mailbox'), data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'), etag: any(named: 'etag'),
          )).thenAnswer((_) async {});
      when(() => mockDio.post('/api/v1/sync/push', data: any(named: 'data'), options: any(named: 'options')))
          .thenAnswer((_) async => _ok('/api/v1/sync/push', {'cursor': '0', 'results': []}));
      when(() => mockDio.post('/api/v1/sync/pull', data: any(named: 'data'), options: any(named: 'options')))
          .thenAnswer((_) async => _ok('/api/v1/sync/pull', {
                'cursor': 'c3',
                'entities': [
                  {'id': 'e-pending', 'operation': 'upsert', 'data': {'v': 1}, 'updatedAt': '2026-06-20T10:00:00Z', 'etag': 'x'},
                ],
              }));

      final engine = SyncEngine(
        db: mockDb, auth: mockAuth, apiBase: 'http://x', dio: mockDio,
        isOnlineOverride: () async => true,
      );

      await engine.syncMailbox('approvals');

      verifyNever(() => mockDb.upsertEntity(
            id: 'e-pending', mailbox: any(named: 'mailbox'), data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'), etag: any(named: 'etag'),
          ));
    });
  });

  group('restart-resume persistence (10-T5)', () {
    test('cursor + outbox survive a DB reopen from disk', () async {
      final dir = await databaseFactoryFfi.getDatabasesPath();
      final path = '$dir/restart_resume_test_${DateTime.now().microsecondsSinceEpoch}.db';

      // First session: write a cursor + enqueue a mutation, then close.
      final raw1 = await databaseFactoryFfi.openDatabase(path);
      final db1 = await SyncDatabase.openInMemory(raw1);
      await db1.setCursor('approvals', 'cursor-persist');
      final outboxId = await db1.enqueueOutbox(
        mailbox: 'approvals', operation: 'approve', entityId: 'e-persist', payload: {'decision': 'approved'},
      );
      await raw1.close();

      // Second session: reopen the same file — data must still be there.
      final raw2 = await databaseFactoryFfi.openDatabase(path);
      final db2 = await SyncDatabase.openInMemory(raw2);
      expect(await db2.getCursor('approvals'), 'cursor-persist');
      final outbox = await db2.listOutbox('approvals');
      expect(outbox.map((e) => e['id']), contains(outboxId));
      await raw2.close();
      await databaseFactoryFfi.deleteDatabase(path);
    });
  });
}
