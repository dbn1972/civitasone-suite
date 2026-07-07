import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/write_outbox.dart';
import 'package:civitasone_mobile/core/sync/sync_push_service.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';

class MockDio extends Mock implements Dio {}

class MockPkceAuthService extends Mock implements PkceAuthService {}

void main() {
  late SyncDatabase db;
  late WriteOutbox outbox;
  late MockDio mockDio;
  late MockPkceAuthService mockAuth;
  late SyncPushService pushService;
  late Database raw;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    registerFallbackValue(Options());
  });

  setUp(() async {
    raw = await databaseFactoryFfi.openDatabase(inMemoryDatabasePath);
    db = await SyncDatabase.openInMemory(raw);
    outbox = WriteOutbox(db);
    mockDio = MockDio();
    mockAuth = MockPkceAuthService();

    when(() => mockAuth.accessToken()).thenAnswer((_) async => 'test-bearer-token');

    pushService = SyncPushService(
      outbox: outbox,
      auth: mockAuth,
      gatewayBase: 'http://localhost:8080',
      dio: mockDio,
      timeout: const Duration(seconds: 15),
    );
  });

  tearDown(() async {
    await raw.close();
  });

  Response _makeResponse(int statusCode, {dynamic data, Map<String, List<String>>? headers}) {
    return Response(
      requestOptions: RequestOptions(path: '/test'),
      statusCode: statusCode,
      data: data,
      headers: Headers.fromMap(headers ?? {}),
    );
  }

  DioException _makeDioException(DioExceptionType type, {int? statusCode, String? message}) {
    return DioException(
      type: type,
      requestOptions: RequestOptions(path: '/test'),
      response: statusCode != null
          ? Response(
              requestOptions: RequestOptions(path: '/test'),
              statusCode: statusCode,
            )
          : null,
      message: message,
    );
  }

  group('SyncPushService — successful sync', () {
    test('marks entry as synced on 2xx response', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {'leaveType': 'casual', 'days': 2},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(202, data: {'status': 'accepted'}));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.synced);
      expect(entry.syncedAt, isNotNull);
    });

    test('injects Bearer token in request headers', () async {
      await outbox.enqueue(
        action: 'leave.create',
        payload: {'leaveType': 'casual'},
      );

      Options? capturedOptions;
      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((inv) async {
        capturedOptions = inv.namedArguments[const Symbol('options')] as Options;
        return _makeResponse(202);
      });

      await pushService.pushPending();

      expect(capturedOptions, isNotNull);
      expect(capturedOptions!.headers!['authorization'], 'Bearer test-bearer-token');
    });

    test('uses correct method and URL from outbox entry', () async {
      await outbox.enqueue(
        action: 'leave.update',
        payload: {'leaveId': 'l1', 'status': 'cancelled'},
      );

      String? capturedUrl;
      Options? capturedOptions;
      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((inv) async {
        capturedUrl = inv.positionalArguments[0] as String;
        capturedOptions = inv.namedArguments[const Symbol('options')] as Options;
        return _makeResponse(200);
      });

      await pushService.pushPending();

      expect(capturedUrl, 'http://localhost:8080/v1/hrms/leaves');
      expect(capturedOptions!.method, 'PATCH');
    });

    test('processes multiple pending entries in order', () async {
      final id1 = await outbox.enqueue(action: 'leave.create', payload: {'a': 1});
      final id2 = await outbox.enqueue(action: 'ticket.create', payload: {'b': 2});

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(202));

      await pushService.pushPending();

      final entry1 = await outbox.getById(id1);
      final entry2 = await outbox.getById(id2);
      expect(entry1!.status, WriteOutboxStatus.synced);
      expect(entry2!.status, WriteOutboxStatus.synced);
    });
  });

  group('SyncPushService — non-retryable 4xx dead-lettering', () {
    test('dead-letters on 400 immediately without retry', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {'invalid': true},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(400, data: {
                'error': {'code': 'VALIDATION_ERROR', 'message': 'Invalid payload'}
              }));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
      expect(entry.lastError, 'Invalid payload');
      expect(entry.retryCount, 0); // No retry was attempted.
    });

    test('dead-letters on 403 immediately', () async {
      final id = await outbox.enqueue(
        action: 'bill.create',
        payload: {'amount': 1000},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(403));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
      expect(entry.lastError, contains('403'));
    });

    test('dead-letters on 404 immediately', () async {
      final id = await outbox.enqueue(
        action: 'ticket.create',
        payload: {},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(404));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
    });

    test('dead-letters on 422 immediately', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(422, data: {
                'error': {'message': 'Business rule violation'}
              }));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
      expect(entry.lastError, 'Business rule violation');
    });

    test('does NOT dead-letter on 401 (auth error)', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(401));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      // Should NOT be dead — should be pending again for retry after refresh.
      expect(entry!.status, isNot(WriteOutboxStatus.dead));
      expect(entry.status, WriteOutboxStatus.pending);
    });

    test('does NOT dead-letter on 429 (rate limited)', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(429,
              headers: {'retry-after': ['60']}));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, isNot(WriteOutboxStatus.dead));
      expect(entry.status, WriteOutboxStatus.pending);
    });
  });

  group('SyncPushService — retry exhaustion and dead-lettering', () {
    test('increments retry on 500 server error', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {'leaveType': 'casual'},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(500));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.pending);
      expect(entry.retryCount, 1);
      expect(entry.lastError, contains('500'));
    });

    test('dead-letters after 3 retries (entry already has 2 retries)', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {'leaveType': 'casual'},
      );

      // Simulate 2 prior retries.
      await outbox.incrementRetry(id, 'err1');
      await outbox.incrementRetry(id, 'err2');

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(503));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
      expect(entry.lastError, contains('503'));
    });

    test('increments retry on timeout DioException', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenThrow(_makeDioException(
        DioExceptionType.receiveTimeout,
        message: 'Connection timed out',
      ));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.pending);
      expect(entry.retryCount, 1);
      expect(entry.lastError, contains('Timeout'));
    });

    test('increments retry on connection error', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {},
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenThrow(_makeDioException(
        DioExceptionType.connectionError,
        message: 'No internet connection',
      ));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.pending);
      expect(entry.retryCount, 1);
      expect(entry.lastError, contains('Network error'));
    });

    test('dead-letters DioException after exhausting retries', () async {
      final id = await outbox.enqueue(
        action: 'leave.create',
        payload: {},
      );
      await outbox.incrementRetry(id, 'timeout-1');
      await outbox.incrementRetry(id, 'timeout-2');

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenThrow(_makeDioException(
        DioExceptionType.connectionTimeout,
        message: 'Timed out again',
      ));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
    });
  });

  group('SyncPushService — 401 token refresh', () {
    test('triggers onTokenRefreshNeeded callback on 401', () async {
      await outbox.enqueue(action: 'leave.create', payload: {});

      var refreshCalled = false;
      pushService.onTokenRefreshNeeded = () async {
        refreshCalled = true;
        return true;
      };

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(401));

      await pushService.pushPending();

      expect(refreshCalled, isTrue);
    });

    test('does not dead-letter entry on 401', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});

      pushService.onTokenRefreshNeeded = () async => true;

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(401));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.pending);
      expect(entry.status, isNot(WriteOutboxStatus.dead));
    });

    test('handles 401 DioException the same as 401 response', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});

      var refreshCalled = false;
      pushService.onTokenRefreshNeeded = () async {
        refreshCalled = true;
        return true;
      };

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenThrow(_makeDioException(
        DioExceptionType.badResponse,
        statusCode: 401,
      ));

      await pushService.pushPending();

      expect(refreshCalled, isTrue);
      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.pending);
    });
  });

  group('SyncPushService — 429 rate limiting', () {
    test('respects Retry-After header and notifies callback', () async {
      await outbox.enqueue(action: 'leave.create', payload: {});

      Duration? receivedRetryAfter;
      pushService.onRateLimited = (duration) {
        receivedRetryAfter = duration;
      };

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(429,
              headers: {'retry-after': ['120']}));

      await pushService.pushPending();

      expect(receivedRetryAfter, const Duration(seconds: 120));
    });

    test('does not dead-letter on 429', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(429,
              headers: {'retry-after': ['30']}));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, isNot(WriteOutboxStatus.dead));
    });
  });

  group('SyncPushService — pushWithRetry (inline retry)', () {
    test('succeeds on first attempt', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {'days': 1});
      final entry = (await outbox.getById(id))!;

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(202));

      final result = await pushService.pushWithRetry(entry);

      expect(result, isTrue);
      final updated = await outbox.getById(id);
      expect(updated!.status, WriteOutboxStatus.synced);
    });

    test('dead-letters non-retryable 4xx on first attempt', () async {
      final id = await outbox.enqueue(action: 'leave.create', payload: {});
      final entry = (await outbox.getById(id))!;

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(422, data: {
                'error': {'message': 'Invalid leave type'}
              }));

      final result = await pushService.pushWithRetry(entry);

      expect(result, isFalse);
      final updated = await outbox.getById(id);
      expect(updated!.status, WriteOutboxStatus.dead);
      expect(updated.lastError, 'Invalid leave type');
    });
  });

  group('SyncPushService — edge cases', () {
    test('dead-letters entry with no endpoint', () async {
      final id = await outbox.enqueueWithTopic(
        topic: 'custom.topic',
        payload: {'x': 1},
        service: 'custom',
        endpoint: '', // empty endpoint
      );

      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => _makeResponse(200));

      await pushService.pushPending();

      final entry = await outbox.getById(id);
      expect(entry!.status, WriteOutboxStatus.dead);
      expect(entry.lastError, contains('No endpoint configured'));
    });

    test('does not start a second push while one is in progress', () async {
      await outbox.enqueue(action: 'leave.create', payload: {});

      var callCount = 0;
      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async {
        callCount++;
        // Simulate slow request.
        await Future.delayed(const Duration(milliseconds: 50));
        return _makeResponse(202);
      });

      // Start two pushes concurrently.
      final f1 = pushService.pushPending();
      final f2 = pushService.pushPending();
      await Future.wait([f1, f2]);

      // Only one push cycle should have run.
      expect(callCount, 1);
    });

    test('continues processing other entries after one dead-letters', () async {
      final id1 = await outbox.enqueue(action: 'leave.create', payload: {});
      final id2 = await outbox.enqueue(action: 'ticket.create', payload: {});

      var callIndex = 0;
      when(() => mockDio.request(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async {
        callIndex++;
        if (callIndex == 1) return _makeResponse(400);
        return _makeResponse(202);
      });

      await pushService.pushPending();

      final entry1 = await outbox.getById(id1);
      final entry2 = await outbox.getById(id2);
      expect(entry1!.status, WriteOutboxStatus.dead);
      expect(entry2!.status, WriteOutboxStatus.synced);
    });
  });
}
