/// Error classification logic for the mobile sync push service.
///
/// Determines how to route write command failures based on the HTTP status code
/// returned by the domain service. This is the core decision logic used by
/// [SyncPushService] to decide whether to dead-letter or retry a command.
///
/// **Validates: Requirement 4.5**
class SyncErrorClassifier {
  /// Returns `true` if the given HTTP status code is non-retryable and the
  /// command should be moved to the dead-letter store immediately.
  ///
  /// Non-retryable: any 4xx status code EXCLUDING:
  /// - 401 (Unauthorized — triggers token refresh flow)
  /// - 429 (Too Many Requests — retryable after backoff)
  ///
  /// **Requirement 4.5:** IF a write command fails to sync and the server
  /// responds with a non-retryable error (4xx status excluding 401 and 429),
  /// THEN the Mobile_App SHALL move the command to the dead-letter store
  /// immediately without further retry.
  static bool isNonRetryable(int statusCode) {
    if (statusCode < 400 || statusCode > 499) return false;
    if (statusCode == 401 || statusCode == 429) return false;
    return true;
  }

  /// Returns `true` if the given HTTP status code indicates a transient error
  /// that should be retried with exponential backoff.
  ///
  /// Retryable: 5xx server errors, network timeouts, or specific retryable
  /// client errors (401 for token refresh, 429 for rate limiting).
  static bool isRetryable(int statusCode) {
    if (statusCode == 401 || statusCode == 429) return true;
    if (statusCode >= 500 && statusCode <= 599) return true;
    return false;
  }

  /// Classify the error routing decision for a given status code.
  ///
  /// Returns [SyncErrorAction.deadLetter] for non-retryable 4xx errors,
  /// [SyncErrorAction.retry] for transient errors, and [SyncErrorAction.ignore]
  /// for success codes or unknown status ranges.
  static SyncErrorAction classify(int statusCode) {
    if (statusCode >= 200 && statusCode < 300) return SyncErrorAction.success;
    if (isNonRetryable(statusCode)) return SyncErrorAction.deadLetter;
    if (isRetryable(statusCode)) return SyncErrorAction.retry;
    return SyncErrorAction.deadLetter; // unknown error — don't retry
  }
}

/// The action to take when a sync push command encounters an error.
enum SyncErrorAction {
  /// Command synced successfully — remove from outbox.
  success,

  /// Move to dead-letter store immediately — no retry.
  deadLetter,

  /// Retry with exponential backoff.
  retry,
}
