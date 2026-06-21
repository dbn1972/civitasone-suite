import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}
class MockPkceAuthService extends Mock implements PkceAuthService {}
class MockDio extends Mock implements Dio {}

void main() {
  late MockSyncDatabase mockDb;
  late MockPkceAuthService mockAuth;
  late MockDio mockDio;
  late SyncEngine engine;

  setUpAll(() {
    registerFallbackValue(Options());
  });

  setUp(() {
    mockDb = MockSyncDatabase();
    mockAuth = MockPkceAuthService();
    mockDio = MockDio();

    when(() => mockAuth.accessToken()).thenAnswer((_) async => 'test-token');
    when(() => mockAuth.getOrCreateDeviceId()).thenAnswer((_) async => 'device-1');
    when(() => mockDb.getCursor(any())).thenAnswer((_) async => '0');
    when(() => mockDb.setCursor(any(), any())).thenAnswer((_) async {});
    when(() => mockDb.listOutbox(any())).thenAnswer((_) async => []);

    engine = SyncEngine(
      db: mockDb,
      auth: mockAuth,
      apiBase: 'http://localhost:8080',
      dio: mockDio,
      isOnlineOverride: () async => true,
    );
  });

  group('syncMailbox — push', () {
    test('sends real payload from outbox entry (not empty body)', () async {
      const entityId = 'approval-uuid';
      final outboxEntry = {
        'id': 'outbox-1',
        'mailbox': 'approvals',
        'operation': 'approve',
        'entity_id': entityId,
        'payload_json': '{"entityId":"$entityId","decision":"approved","comment":"OK"}',
        'created_at': '2026-06-20T10:00:00Z',
        'status': 'queued',
        'retry_count': 0,
      };

      when(() => mockDb.listOutbox('approvals'))
          .thenAnswer((_) async => [outboxEntry]);
      when(() => mockDb.markOutboxDone(any())).thenAnswer((_) async {});
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'),
            mailbox: any(named: 'mailbox'),
            data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'),
            etag: any(named: 'etag'),
          )).thenAnswer((_) async {});

      // Capture the push request body.
      Map<String, dynamic>? capturedBody;
      when(() => mockDio.post(
            '/api/v1/sync/push',
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((inv) async {
        capturedBody = inv.namedArguments[const Symbol('data')]
            as Map<String, dynamic>;
        return Response(
          requestOptions: RequestOptions(path: '/api/v1/sync/push'),
          data: {'cursor': 'cursor-2', 'results': []},
          statusCode: 200,
        );
      });

      when(() => mockDio.post(
            '/api/v1/sync/pull',
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/v1/sync/pull'),
            data: {'cursor': 'cursor-3', 'entities': []},
            statusCode: 200,
          ));

      await engine.syncMailbox('approvals');

      final mutations =
          capturedBody!['mutations'] as List<dynamic>;
      expect(mutations, isNotEmpty);
      final mutation = mutations.first as Map<String, dynamic>;

      // Payload must NOT be empty.
      final payload = mutation['payload'] as Map<String, dynamic>;
      expect(payload['decision'], 'approved');
      expect(payload['comment'], 'OK');
      expect(mutation['entityId'], entityId);
      expect(mutation['operation'], 'approve');
    });

    test('marks outbox entry done on server success', () async {
      final outboxEntry = {
        'id': 'outbox-2',
        'mailbox': 'approvals',
        'operation': 'reject',
        'entity_id': 'e1',
        'payload_json': '{"entityId":"e1","decision":"rejected"}',
        'created_at': '2026-06-20T10:00:00Z',
        'status': 'queued',
        'retry_count': 0,
      };

      when(() => mockDb.listOutbox('approvals'))
          .thenAnswer((_) async => [outboxEntry]);
      when(() => mockDb.markOutboxDone(any())).thenAnswer((_) async {});

      when(() => mockDio.post(
            '/api/v1/sync/push',
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/v1/sync/push'),
            data: {
              'cursor': 'c2',
              'results': [
                {'clientMutationId': 'outbox-2', 'success': true},
              ],
            },
            statusCode: 200,
          ));

      when(() => mockDio.post(
            '/api/v1/sync/pull',
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/v1/sync/pull'),
            data: {'cursor': 'c3', 'entities': []},
            statusCode: 200,
          ));

      await engine.syncMailbox('approvals');

      verify(() => mockDb.markOutboxDone('outbox-2')).called(1);
    });

    test('marks outbox entry failed when server returns success=false', () async {
      final outboxEntry = {
        'id': 'outbox-3',
        'mailbox': 'approvals',
        'operation': 'approve',
        'entity_id': 'e2',
        'payload_json': '{"entityId":"e2"}',
        'created_at': '2026-06-20T10:00:00Z',
        'status': 'queued',
        'retry_count': 0,
      };

      when(() => mockDb.listOutbox('approvals'))
          .thenAnswer((_) async => [outboxEntry]);
      when(() => mockDb.markOutboxFailed(any(), any())).thenAnswer((_) async {});

      when(() => mockDio.post(
            '/api/v1/sync/push',
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/v1/sync/push'),
            data: {
              'cursor': 'c2',
              'results': [
                {
                  'clientMutationId': 'outbox-3',
                  'success': false,
                  'error': 'validation_failed',
                },
              ],
            },
            statusCode: 200,
          ));

      when(() => mockDio.post(
            '/api/v1/sync/pull',
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response(
            requestOptions: RequestOptions(path: '/api/v1/sync/pull'),
            data: {'cursor': 'c3', 'entities': []},
            statusCode: 200,
          ));

      await engine.syncMailbox('approvals');

      verify(() => mockDb.markOutboxFailed('outbox-3', 'validation_failed'))
          .called(1);
    });
  });
}
