import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';

class MockPkceAuthService extends Mock implements PkceAuthService {}

/// Records every request Dio actually puts on the wire and replays a scripted
/// outcome, so we can assert how many times a request was attempted.
class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter(this._respond);

  final ResponseBody Function(RequestOptions options, int attempt) _respond;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return _respond(options, requests.length);
  }

  @override
  void close({bool force = false}) {}
}

class _ThrowingAdapter implements HttpClientAdapter {
  _ThrowingAdapter(this.type);

  final DioExceptionType type;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    throw DioException(requestOptions: options, type: type);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(String body, int status) =>
    ResponseBody.fromString(body, status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });

void main() {
  late MockPkceAuthService auth;

  setUp(() {
    auth = MockPkceAuthService();
    when(() => auth.accessToken()).thenAnswer((_) async => 'test-token');
  });

  group('RetryInterceptor', () {
    test('retries a 5xx GET because a read is safe to replay', () async {
      final dio = Dio();
      final adapter = _RecordingAdapter(
        (options, attempt) =>
            attempt == 1 ? _json('{}', 503) : _json('{"ok":true}', 200),
      );
      dio.httpClientAdapter = adapter;
      dio.interceptors.add(RetryInterceptor(dio: dio, maxRetries: 1));

      final res = await dio.get<Map<String, dynamic>>('/v1/things');

      expect(res.statusCode, 200);
      expect(adapter.requests.length, 2,
          reason: 'first attempt plus one retry');
    });

    test('does not replay a 5xx POST — the server may already have applied it',
        () async {
      final dio = Dio();
      final adapter = _RecordingAdapter((options, attempt) => _json('{}', 500));
      dio.httpClientAdapter = adapter;
      dio.interceptors.add(RetryInterceptor(dio: dio, maxRetries: 3));

      await expectLater(
        dio.post<Map<String, dynamic>>('/v1/payments', data: {'amount': 100}),
        throwsA(isA<DioException>()),
      );

      expect(adapter.requests.length, 1,
          reason: 'a non-idempotent write must be attempted exactly once');
    });

    test('does not replay a 5xx PUT, PATCH or DELETE', () async {
      for (final send in <Future<Response<dynamic>> Function(Dio)>[
        (d) => d.put<dynamic>('/v1/things/1', data: <String, dynamic>{}),
        (d) => d.patch<dynamic>('/v1/things/1', data: <String, dynamic>{}),
        (d) => d.delete<dynamic>('/v1/things/1'),
      ]) {
        final dio = Dio();
        final adapter =
            _RecordingAdapter((options, attempt) => _json('{}', 502));
        dio.httpClientAdapter = adapter;
        dio.interceptors.add(RetryInterceptor(dio: dio, maxRetries: 3));

        await expectLater(send(dio), throwsA(isA<DioException>()));
        expect(adapter.requests.length, 1);
      }
    });

    test('gives up after maxRetries and surfaces the error', () async {
      final dio = Dio();
      final adapter = _RecordingAdapter((options, attempt) => _json('{}', 500));
      dio.httpClientAdapter = adapter;
      dio.interceptors.add(RetryInterceptor(dio: dio, maxRetries: 2));

      await expectLater(
        dio.get<dynamic>('/v1/things'),
        throwsA(isA<DioException>()),
      );

      expect(adapter.requests.length, 3,
          reason: 'initial attempt plus maxRetries replays');
    });
  });

  group('ApiClient auth handling', () {
    test('attaches the bearer token from PkceAuthService', () async {
      final dio = Dio();
      final adapter = _RecordingAdapter((options, attempt) => _json('{}', 200));
      dio.httpClientAdapter = adapter;
      final client =
          ApiClient(baseUrl: 'https://gw.test', auth: auth, dio: dio);

      await client.get<Map<String, dynamic>>('/v1/things');

      expect(adapter.requests.single.headers['Authorization'],
          'Bearer test-token');
    });

    test('sends no Authorization header when there is no session', () async {
      when(() => auth.accessToken()).thenAnswer((_) async => null);
      final dio = Dio();
      final adapter = _RecordingAdapter((options, attempt) => _json('{}', 200));
      dio.httpClientAdapter = adapter;
      final client =
          ApiClient(baseUrl: 'https://gw.test', auth: auth, dio: dio);

      await client.get<Map<String, dynamic>>('/v1/things');

      expect(adapter.requests.single.headers.containsKey('Authorization'),
          isFalse);
    });

    test('retries once with a refreshed token after a 401', () async {
      final dio = Dio();
      final adapter = _RecordingAdapter(
        (options, attempt) =>
            attempt == 1 ? _json('{}', 401) : _json('{"ok":true}', 200),
      );
      dio.httpClientAdapter = adapter;
      final client =
          ApiClient(baseUrl: 'https://gw.test', auth: auth, dio: dio);
      var authExpired = false;
      client.onAuthExpired = () => authExpired = true;

      final res = await client.get<Map<String, dynamic>>('/v1/things');

      expect(res.statusCode, 200);
      expect(adapter.requests.length, 2);
      expect(authExpired, isFalse);
    });

    test('signals auth expiry when the session cannot be refreshed', () async {
      when(() => auth.accessToken()).thenAnswer((_) async => null);
      final dio = Dio();
      final adapter = _RecordingAdapter((options, attempt) => _json('{}', 401));
      dio.httpClientAdapter = adapter;
      final client =
          ApiClient(baseUrl: 'https://gw.test', auth: auth, dio: dio);
      var authExpired = false;
      client.onAuthExpired = () => authExpired = true;

      await expectLater(
        client.get<dynamic>('/v1/things'),
        throwsA(isA<DioException>()),
      );

      expect(authExpired, isTrue);
    });
  });

  group('ApiClient offline queue', () {
    test('queues a write that failed with a connection error', () async {
      final dio = Dio();
      dio.httpClientAdapter = _ThrowingAdapter(DioExceptionType.connectionError);
      final client =
          ApiClient(baseUrl: 'https://gw.test', auth: auth, dio: dio);

      await expectLater(
        client.post<dynamic>('/v1/payments', data: {'amount': 100}),
        throwsA(isA<DioException>()),
      );

      expect(client.pendingQueueCount, 1);
    });

    test('does not queue a failed read', () async {
      final dio = Dio();
      dio.httpClientAdapter = _ThrowingAdapter(DioExceptionType.connectionError);
      final client =
          ApiClient(baseUrl: 'https://gw.test', auth: auth, dio: dio);

      await expectLater(
        client.get<dynamic>('/v1/things'),
        throwsA(isA<DioException>()),
      );

      expect(client.pendingQueueCount, 0);
    });

    test('flushOfflineQueue keeps the request queued while it still fails',
        () async {
      final dio = Dio();
      dio.httpClientAdapter = _ThrowingAdapter(DioExceptionType.connectionError);
      final client =
          ApiClient(baseUrl: 'https://gw.test', auth: auth, dio: dio);

      await expectLater(
        client.post<dynamic>('/v1/payments', data: {'amount': 100}),
        throwsA(isA<DioException>()),
      );
      expect(client.pendingQueueCount, 1);

      final flushed = await client.flushOfflineQueue();

      expect(flushed, 0);
      expect(client.pendingQueueCount, 1,
          reason: 'an unsent write must not be silently dropped');
    });
  });
}
