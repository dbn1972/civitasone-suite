import 'dart:async';
import 'package:dio/dio.dart';
import '../auth/pkce_auth.dart';
import 'write_outbox.dart';

/// Maximum number of retries before dead-lettering a write command.
///
/// Exponential backoff intervals: 1s, 2s, 4s (requirement 4.6).
const int kMaxPushRetries = 3;

/// Backoff durations for each retry attempt (requirement 4.6).
const List<Duration> kRetryBackoffs = [
  Duration(seconds: 1),
  Duration(seconds: 2),
  Duration(seconds: 4),
];

/// Pushes queued write commands from the local [WriteOutbox] to domain service
/// endpoints via HTTP (Dio).
///
/// Handles:
/// - Auth token injection (Bearer token from current session)
/// - Non-retryable 4xx (excl 401/429) → dead-letter immediately
/// - Retryable 5xx/timeout → 3 retries with exponential backoff → dead-letter
/// - 401 → trigger token refresh (do NOT dead-letter)
/// - 429 → respect Retry-After header (do NOT dead-letter)
/// - Success (2xx) → mark synced within 2 seconds
///
/// **Validates: Requirements 4.5, 4.6, 4.7**
class SyncPushService {
  SyncPushService({
    required this.outbox,
    required this.auth,
    required this.gatewayBase,
    Dio? dio,
    Duration? timeout,
  })  : _dio = dio ?? Dio(),
        _timeout = timeout ?? const Duration(seconds: 15);

  final WriteOutbox outbox;
  final PkceAuthService auth;
  final String gatewayBase;
  final Dio _dio;
  final Duration _timeout;

  /// Whether a push cycle is currently in progress.
  bool _pushing = false;

  /// Callback invoked when a 401 is received and token refresh is needed.
  /// The caller (typically a Riverpod provider) should set this to trigger
  /// the app's token refresh flow. Returns true if refresh succeeded.
  Future<bool> Function()? onTokenRefreshNeeded;

  /// Callback invoked when a 429 is received with a Retry-After header.
  /// The duration indicates how long to wait before retrying.
  void Function(Duration retryAfter)? onRateLimited;

  /// Push all pending entries from the outbox to their domain service endpoints.
  ///
  /// Processes entries sequentially in creation order. Stops on 401 (triggers
  /// refresh) or 429 (respects Retry-After). Non-retryable errors dead-letter
  /// the entry and continue processing remaining entries.
  Future<void> pushPending() async {
    if (_pushing) return;
    _pushing = true;
    try {
      final entries = await outbox.getPending();
      for (final entry in entries) {
        await _pushEntry(entry);
      }
    } finally {
      _pushing = false;
    }
  }

  /// Push a single outbox entry to its domain service endpoint.
  Future<void> _pushEntry(WriteOutboxEntry entry) async {
    await outbox.markSyncing(entry.id);

    final endpoint = entry.endpoint;
    final method = entry.method ?? 'POST';

    if (endpoint == null || endpoint.isEmpty) {
      // No endpoint configured — dead-letter immediately.
      await outbox.moveToDead(entry.id, 'No endpoint configured for topic: ${entry.topic}');
      return;
    }

    final url = '$gatewayBase$endpoint';

    try {
      final response = await _makeRequest(
        url: url,
        method: method,
        payload: entry.payload,
      );

      final statusCode = response.statusCode ?? 0;

      if (statusCode >= 200 && statusCode < 300) {
        // Success — mark synced (requirement 4.7: within 2 seconds).
        await outbox.markSynced(entry.id);
      } else {
        // Unexpected: Dio should throw on non-2xx, but handle gracefully.
        await _handleErrorStatus(entry, statusCode, response);
      }
    } on DioException catch (e) {
      await _handleDioException(entry, e);
    }
  }

  /// Make the HTTP request with auth token injection.
  Future<Response> _makeRequest({
    required String url,
    required String method,
    required Map<String, dynamic> payload,
  }) async {
    final token = await auth.accessToken();
    final headers = <String, String>{
      'content-type': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
    };

    final options = Options(
      method: method,
      headers: headers,
      sendTimeout: _timeout,
      receiveTimeout: _timeout,
      // Prevent Dio from throwing on non-2xx — we handle status codes ourselves.
      validateStatus: (_) => true,
    );

    return _dio.request(
      url,
      data: payload,
      options: options,
    );
  }

  /// Handle a non-2xx status code from a successful HTTP response.
  Future<void> _handleErrorStatus(
    WriteOutboxEntry entry,
    int statusCode,
    Response response,
  ) async {
    if (statusCode == 401) {
      await _handle401(entry);
    } else if (statusCode == 429) {
      await _handle429(entry, response);
    } else if (statusCode >= 400 && statusCode < 500) {
      // Non-retryable 4xx (excl 401/429) → dead-letter immediately (requirement 4.5).
      final reason = _extractErrorMessage(response) ??
          'HTTP $statusCode: Client error';
      await outbox.moveToDead(entry.id, reason);
    } else if (statusCode >= 500) {
      // Retryable 5xx → increment retry, apply backoff (requirement 4.6).
      final reason = _extractErrorMessage(response) ??
          'HTTP $statusCode: Server error';
      await _handleRetryableError(entry, reason);
    } else {
      // Other unexpected status — dead-letter.
      await outbox.moveToDead(
        entry.id,
        'Unexpected HTTP $statusCode',
      );
    }
  }

  /// Handle a DioException (timeout, network failure, etc.).
  Future<void> _handleDioException(WriteOutboxEntry entry, DioException e) async {
    final statusCode = e.response?.statusCode;

    if (statusCode == 401) {
      await _handle401(entry);
      return;
    }

    if (statusCode == 429) {
      await _handle429(entry, e.response);
      return;
    }

    if (statusCode != null && statusCode >= 400 && statusCode < 500) {
      // Non-retryable 4xx (excl 401/429) → dead-letter immediately.
      final reason = _extractErrorMessage(e.response) ??
          'HTTP $statusCode: ${e.message ?? 'Client error'}';
      await outbox.moveToDead(entry.id, reason);
      return;
    }

    // Retryable: 5xx, timeout, connection error, or unknown network failure.
    final reason = statusCode != null
        ? 'HTTP $statusCode: ${e.message ?? 'Server error'}'
        : e.type == DioExceptionType.connectionTimeout ||
                e.type == DioExceptionType.sendTimeout ||
                e.type == DioExceptionType.receiveTimeout
            ? 'Timeout: ${e.message ?? 'Request timed out'}'
            : 'Network error: ${e.message ?? 'Connection failed'}';

    await _handleRetryableError(entry, reason);
  }

  /// Handle 401 Unauthorized — trigger token refresh, do NOT dead-letter.
  ///
  /// Resets the entry to pending so it can be retried after refresh.
  Future<void> _handle401(WriteOutboxEntry entry) async {
    // Reset to pending — will be retried after token refresh.
    await outbox.incrementRetry(entry.id, '401: Token expired');

    // Trigger the token refresh flow.
    if (onTokenRefreshNeeded != null) {
      await onTokenRefreshNeeded!();
    }
  }

  /// Handle 429 Too Many Requests — respect Retry-After, do NOT dead-letter.
  ///
  /// Resets the entry to pending so it can be retried after the backoff period.
  Future<void> _handle429(WriteOutboxEntry entry, Response? response) async {
    // Parse Retry-After header.
    final retryAfter = _parseRetryAfter(response);

    // Reset to pending — will be retried after Retry-After delay.
    await outbox.incrementRetry(entry.id, '429: Rate limited');

    // Notify caller of rate limiting so it can schedule retry.
    if (onRateLimited != null && retryAfter != null) {
      onRateLimited!(retryAfter);
    }
  }

  /// Handle retryable errors with exponential backoff (requirement 4.6).
  ///
  /// After 3 failed retries, the entry is moved to dead-letter (requirement 4.6).
  Future<void> _handleRetryableError(WriteOutboxEntry entry, String error) async {
    final currentRetries = entry.retryCount;

    if (currentRetries >= kMaxPushRetries - 1) {
      // Exhausted retries — dead-letter (requirement 4.6).
      await outbox.moveToDead(entry.id, error);
    } else {
      // Schedule retry with backoff.
      await outbox.incrementRetry(entry.id, error);
    }
  }

  /// Push a single entry with inline retry logic (exponential backoff).
  ///
  /// This method retries immediately in a loop for transient failures,
  /// useful when the caller wants synchronous retry behavior (e.g., manual retry).
  Future<bool> pushWithRetry(WriteOutboxEntry entry) async {
    await outbox.markSyncing(entry.id);

    final endpoint = entry.endpoint;
    final method = entry.method ?? 'POST';

    if (endpoint == null || endpoint.isEmpty) {
      await outbox.moveToDead(entry.id, 'No endpoint configured for topic: ${entry.topic}');
      return false;
    }

    final url = '$gatewayBase$endpoint';

    for (var attempt = 0; attempt <= kMaxPushRetries - 1; attempt++) {
      try {
        final response = await _makeRequest(
          url: url,
          method: method,
          payload: entry.payload,
        );

        final statusCode = response.statusCode ?? 0;

        if (statusCode >= 200 && statusCode < 300) {
          await outbox.markSynced(entry.id);
          return true;
        }

        if (statusCode == 401) {
          await _handle401(entry);
          return false; // Caller should retry after refresh.
        }

        if (statusCode == 429) {
          await _handle429(entry, response);
          return false; // Caller should wait and retry.
        }

        if (statusCode >= 400 && statusCode < 500) {
          // Non-retryable — dead-letter.
          final reason = _extractErrorMessage(response) ??
              'HTTP $statusCode: Client error';
          await outbox.moveToDead(entry.id, reason);
          return false;
        }

        // 5xx — retry with backoff.
        if (attempt < kMaxPushRetries - 1) {
          await outbox.incrementRetry(
            entry.id,
            'HTTP $statusCode: Server error (attempt ${attempt + 1})',
          );
          await Future.delayed(kRetryBackoffs[attempt]);
        } else {
          // Final attempt failed — dead-letter.
          await outbox.moveToDead(
            entry.id,
            'HTTP $statusCode: Server error after $kMaxPushRetries retries',
          );
          return false;
        }
      } on DioException catch (e) {
        final statusCode = e.response?.statusCode;

        if (statusCode == 401) {
          await _handle401(entry);
          return false;
        }
        if (statusCode == 429) {
          await _handle429(entry, e.response);
          return false;
        }
        if (statusCode != null && statusCode >= 400 && statusCode < 500) {
          final reason = _extractErrorMessage(e.response) ??
              'HTTP $statusCode: ${e.message ?? 'Client error'}';
          await outbox.moveToDead(entry.id, reason);
          return false;
        }

        // Retryable failure (timeout, network, 5xx).
        if (attempt < kMaxPushRetries - 1) {
          final reason = _errorReasonFromDio(e, attempt);
          await outbox.incrementRetry(entry.id, reason);
          await Future.delayed(kRetryBackoffs[attempt]);
        } else {
          final reason = _errorReasonFromDio(e, attempt);
          await outbox.moveToDead(entry.id, reason);
          return false;
        }
      }
    }
    return false;
  }

  /// Extract error message from response body (standard CivitasOne error envelope).
  String? _extractErrorMessage(Response? response) {
    if (response?.data == null) return null;
    try {
      final data = response!.data;
      if (data is Map<String, dynamic>) {
        final error = data['error'];
        if (error is Map<String, dynamic>) {
          return error['message'] as String?;
        }
        if (error is String) return error;
      }
    } catch (_) {}
    return null;
  }

  /// Parse the Retry-After header from a 429 response.
  Duration? _parseRetryAfter(Response? response) {
    if (response == null) return null;
    final headerValue = response.headers.value('retry-after');
    if (headerValue == null) return null;

    // Retry-After can be seconds (integer) or HTTP-date.
    final seconds = int.tryParse(headerValue);
    if (seconds != null) {
      return Duration(seconds: seconds);
    }

    // Try parsing as HTTP-date.
    try {
      final date = DateTime.parse(headerValue);
      final diff = date.difference(DateTime.now().toUtc());
      return diff.isNegative ? Duration.zero : diff;
    } catch (_) {
      return null;
    }
  }

  /// Build an error reason string from a DioException.
  String _errorReasonFromDio(DioException e, int attempt) {
    final statusCode = e.response?.statusCode;
    if (statusCode != null) {
      return 'HTTP $statusCode: ${e.message ?? 'Server error'} (attempt ${attempt + 1})';
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return 'Timeout (attempt ${attempt + 1})';
    }
    return 'Network error: ${e.message ?? 'Connection failed'} (attempt ${attempt + 1})';
  }
}
