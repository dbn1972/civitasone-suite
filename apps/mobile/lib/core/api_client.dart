import 'dart:async';
import 'dart:collection';
import 'dart:math' as math;
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'auth/pkce_auth.dart';

// Fix: [AUDIT-P1-3] Retry interceptor for 5xx responses (exponential backoff)
class RetryInterceptor extends Interceptor {
  final Dio dio;
  final int maxRetries;

  RetryInterceptor({required this.dio, this.maxRetries = 3});

  /// Only these methods may be replayed automatically. A 5xx does not tell us
  /// whether the server already applied a write, so replaying POST/PUT/PATCH/
  /// DELETE can duplicate a payment, approval or outbox command.
  static const _retryableMethods = {'GET', 'HEAD', 'OPTIONS'};

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final statusCode = err.response?.statusCode ?? 0;
    final retryCount = (err.requestOptions.extra['retryCount'] as int?) ?? 0;
    final method = err.requestOptions.method.toUpperCase();

    if (statusCode >= 500 &&
        retryCount < maxRetries &&
        _retryableMethods.contains(method)) {
      final delay = Duration(seconds: math.pow(2, retryCount).toInt());
      await Future.delayed(delay);

      err.requestOptions.extra['retryCount'] = retryCount + 1;
      try {
        final response = await dio.fetch(err.requestOptions);
        handler.resolve(response);
        return;
      } catch (e) {
        // Fall through to original handler
      }
    }
    handler.next(err);
  }
}

/// Dio-based API client that connects to the CivitasOne gateway.
///
/// Features:
/// - Base URL from environment config
/// - Adds auth token from secure storage
/// - Handles 401 → redirect to login
/// - Handles offline → queue for sync
class ApiClient {
  final String baseUrl;
  final PkceAuthService auth;
  final Dio _dio;
  final Queue<_QueuedRequest> _offlineQueue = Queue();

  /// Callback invoked when a 401 is received and user must re-authenticate.
  void Function()? onAuthExpired;

  /// Marks a request that is already a replay of a queued write, so a repeated
  /// failure re-queues it once instead of appending another copy.
  static const _replayFlag = 'civitasoneOfflineReplay';

  ApiClient({
    required this.baseUrl,
    required this.auth,
    Dio? dio,
  }) : _dio = dio ?? Dio() {
    _dio.options.baseUrl = baseUrl;
    _dio.options.connectTimeout = const Duration(seconds: 15);
    _dio.options.receiveTimeout = const Duration(seconds: 30);
    _dio.options.headers['Content-Type'] = 'application/json';

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: _onRequest,
      onError: _onError,
    ));

    // Fix: [AUDIT-P1-3] Register retry interceptor for 5xx responses
    _dio.interceptors.add(RetryInterceptor(dio: _dio));

    // SEC: Only log in debug mode — never log tokens/bodies in release
    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(
        requestBody: false, // Never log request bodies (may contain PII)
        responseBody: false,
        requestHeader: false, // Never log auth headers
      ));
    }
  }

  // ─── Interceptors ────────────────────────────────────────────────────────────

  Future<void> _onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Use PkceAuthService.accessToken() which transparently refreshes if expired
    // and reads from the correct secure storage key ('civitasone_at').
    final token = await auth.accessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  Future<void> _onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    // Handle 401 Unauthorized → attempt token refresh, then redirect to login
    if (err.response?.statusCode == 401) {
      final refreshed = await _attemptTokenRefresh();
      if (refreshed) {
        // Retry original request with new token from PkceAuthService
        final token = await auth.accessToken();
        err.requestOptions.headers['Authorization'] = 'Bearer $token';
        try {
          final response = await _dio.fetch(err.requestOptions);
          return handler.resolve(response);
        } catch (retryErr) {
          // Fall through to auth expired
        }
      }
      onAuthExpired?.call();
      return handler.next(err);
    }

    // Handle offline / network errors → queue for later sync
    if (err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.unknown ||
        err.type == DioExceptionType.connectionError) {
      if (_isWriteMethod(err.requestOptions.method) &&
          err.requestOptions.extra[_replayFlag] != true) {
        _offlineQueue.add(_QueuedRequest(
          method: err.requestOptions.method,
          path: err.requestOptions.path,
          data: err.requestOptions.data,
          queryParameters: err.requestOptions.queryParameters,
          timestamp: DateTime.now(),
        ));
      }
      return handler.next(err);
    }

    handler.next(err);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  Future<Response<T>> get<T>(String path, {Map<String, dynamic>? params}) {
    return _dio.get<T>(path, queryParameters: params);
  }

  Future<Response<T>> post<T>(String path, {dynamic data}) {
    return _dio.post<T>(path, data: data);
  }

  Future<Response<T>> put<T>(String path, {dynamic data}) {
    return _dio.put<T>(path, data: data);
  }

  Future<Response<T>> patch<T>(String path, {dynamic data}) {
    return _dio.patch<T>(path, data: data);
  }

  Future<Response<T>> delete<T>(String path) {
    return _dio.delete<T>(path);
  }

  /// Retry all queued offline requests. Call when connectivity is restored.
  Future<int> flushOfflineQueue() async {
    int succeeded = 0;
    while (_offlineQueue.isNotEmpty) {
      final req = _offlineQueue.removeFirst();
      try {
        await _dio.request(
          req.path,
          data: req.data,
          queryParameters: req.queryParameters,
          options: Options(
            method: req.method,
            extra: const {_replayFlag: true},
          ),
        );
        succeeded++;
      } catch (_) {
        // Re-queue on failure
        _offlineQueue.addFirst(req);
        break;
      }
    }
    return succeeded;
  }

  int get pendingQueueCount => _offlineQueue.length;

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  Future<bool> _attemptTokenRefresh() async {
    try {
      // PkceAuthService.accessToken() transparently refreshes via the stored
      // refresh token and returns a valid token, or null if re-auth is needed.
      // It owns token storage (civitasone_at/_rt), so we don't touch keys here.
      final token = await auth.accessToken();
      return token != null;
    } catch (_) {
      return false;
    }
  }

  bool _isWriteMethod(String method) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].contains(method.toUpperCase());
  }
}

/// Represents a request queued while offline.
class _QueuedRequest {
  final String method;
  final String path;
  final dynamic data;
  final Map<String, dynamic>? queryParameters;
  final DateTime timestamp;

  _QueuedRequest({
    required this.method,
    required this.path,
    this.data,
    this.queryParameters,
    required this.timestamp,
  });
}
