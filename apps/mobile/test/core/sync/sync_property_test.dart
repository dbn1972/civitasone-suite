import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_error_classifier.dart';

/// Property-based tests for mobile sync namespace and error routing.
///
/// Uses a manual property-based testing approach: generate N random inputs
/// and verify that the invariant holds for every input.
///
/// **Validates: Requirements 4.3, 4.5**
void main() {
  const int numTrials = 500;
  final random = Random(42); // Fixed seed for reproducibility

  // ── Helpers ───────────────────────────────────────────────────────────────

  /// Generate a random UUID-like string (the format used for tenant/user IDs).
  String randomUuid(Random rng) {
    final chars = '0123456789abcdef';
    String hex(int n) => List.generate(n, (_) => chars[rng.nextInt(16)]).join();
    return '${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}';
  }

  /// Generate a random string of length 1..maxLen using alphanumeric + hyphens.
  String randomId(Random rng, {int maxLen = 36}) {
    final chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
    final len = rng.nextInt(maxLen) + 1;
    return List.generate(len, (_) => chars[rng.nextInt(chars.length)]).join();
  }

  /// Generate a random 4xx status code excluding 401 and 429.
  int randomNonRetryable4xx(Random rng) {
    // Valid non-retryable codes: 400, 402-428, 430-499
    final candidates = <int>[
      400,
      ...List.generate(27, (i) => 402 + i), // 402..428
      ...List.generate(70, (i) => 430 + i), // 430..499
    ];
    return candidates[rng.nextInt(candidates.length)];
  }

  // ── Property 4: SyncDatabase Namespace Uniqueness ─────────────────────────

  group('Property 4: Mobile SyncDatabase Namespace Uniqueness', () {
    /// **Validates: Requirements 4.3**
    ///
    /// For any tenant ID and user ID combination, the SyncDatabase path SHALL
    /// equal `civitasone_{tenantId}_{userId}`, ensuring no overlap between any
    /// two distinct (tenant, user) pairs.

    test('namespace format is always civitasone_{tenantId}_{userId}', () {
      // Property: For any (tenantId, userId), namespaceFor returns the
      // string "civitasone_{tenantId}_{userId}" exactly.
      for (var i = 0; i < numTrials; i++) {
        final tenantId = randomUuid(random);
        final userId = randomUuid(random);

        final namespace = SyncDatabase.namespaceFor(tenantId, userId);

        expect(
          namespace,
          equals('civitasone_${tenantId}_$userId'),
          reason: 'Trial $i: namespace must follow format '
              'civitasone_{tenantId}_{userId} '
              'for tenant=$tenantId, user=$userId',
        );
      }
    });

    test('two different (tenant, user) pairs never produce the same namespace', () {
      // Property: For any two distinct (tenantId, userId) pairs where the
      // pairs differ (not just individual components), the generated namespace
      // strings must be different.
      //
      // This relies on the injective property of the format: if
      // civitasone_{t1}_{u1} == civitasone_{t2}_{u2}, then t1==t2 AND u1==u2
      // (when IDs don't contain underscores, which UUIDs don't).
      final seen = <String, String>{}; // namespace → "(tenantId, userId)"

      for (var i = 0; i < numTrials; i++) {
        final tenantId = randomUuid(random);
        final userId = randomUuid(random);
        final pairKey = '($tenantId, $userId)';

        final namespace = SyncDatabase.namespaceFor(tenantId, userId);

        if (seen.containsKey(namespace)) {
          // Only a collision if the pair is actually different.
          expect(
            seen[namespace],
            equals(pairKey),
            reason: 'Trial $i: collision detected! '
                'Namespace "$namespace" produced by both '
                '${seen[namespace]} and $pairKey',
          );
        }
        seen[namespace] = pairKey;
      }
    });

    test('namespace is deterministic (same inputs always produce same output)', () {
      // Property: For any (tenantId, userId), calling namespaceFor multiple
      // times with the same inputs always returns the same result.
      for (var i = 0; i < numTrials; i++) {
        final tenantId = randomUuid(random);
        final userId = randomUuid(random);

        final ns1 = SyncDatabase.namespaceFor(tenantId, userId);
        final ns2 = SyncDatabase.namespaceFor(tenantId, userId);

        expect(
          ns1,
          equals(ns2),
          reason: 'Trial $i: namespaceFor must be deterministic '
              'for tenant=$tenantId, user=$userId',
        );
      }
    });

    test('namespace always starts with civitasone_ prefix', () {
      // Property: For any inputs, the namespace always has the civitasone_ prefix.
      for (var i = 0; i < numTrials; i++) {
        final tenantId = randomId(random);
        final userId = randomId(random);

        final namespace = SyncDatabase.namespaceFor(tenantId, userId);

        expect(
          namespace,
          startsWith('civitasone_'),
          reason: 'Trial $i: namespace must start with civitasone_ '
              'for tenant=$tenantId, user=$userId',
        );
      }
    });

    test('namespace always contains both tenantId and userId', () {
      // Property: For any inputs, both the tenantId and userId are present
      // in the generated namespace string.
      for (var i = 0; i < numTrials; i++) {
        final tenantId = randomUuid(random);
        final userId = randomUuid(random);

        final namespace = SyncDatabase.namespaceFor(tenantId, userId);

        expect(
          namespace,
          contains(tenantId),
          reason: 'Trial $i: namespace must contain tenantId=$tenantId',
        );
        expect(
          namespace,
          contains(userId),
          reason: 'Trial $i: namespace must contain userId=$userId',
        );
      }
    });

    test('swapping tenantId and userId produces different namespaces', () {
      // Property: For any tenantId != userId, swapping them produces a
      // different namespace (the order matters).
      for (var i = 0; i < numTrials; i++) {
        final tenantId = randomUuid(random);
        final userId = randomUuid(random);

        // Skip the degenerate case where tenant == user
        if (tenantId == userId) continue;

        final ns1 = SyncDatabase.namespaceFor(tenantId, userId);
        final ns2 = SyncDatabase.namespaceFor(userId, tenantId);

        expect(
          ns1,
          isNot(equals(ns2)),
          reason: 'Trial $i: swapping tenant and user must produce different '
              'namespaces. tenant=$tenantId, user=$userId',
        );
      }
    });
  });

  // ── Property 5: Mobile Non-Retryable Error Routing ────────────────────────

  group('Property 5: Mobile Non-Retryable Error Routing', () {
    /// **Validates: Requirements 4.5**
    ///
    /// For any write command that receives a 4xx response (excluding 401 and
    /// 429), the Mobile_App SHALL move the command to the dead-letter store
    /// immediately without any retry attempt.

    test('all non-retryable 4xx codes are classified as dead-letter (no retry)', () {
      // Property: For any HTTP status code in range [400..499] excluding
      // 401 and 429, isNonRetryable returns true.
      for (var i = 0; i < numTrials; i++) {
        final statusCode = randomNonRetryable4xx(random);

        expect(
          SyncErrorClassifier.isNonRetryable(statusCode),
          isTrue,
          reason: 'Trial $i: status $statusCode should be non-retryable',
        );
        expect(
          SyncErrorClassifier.classify(statusCode),
          equals(SyncErrorAction.deadLetter),
          reason: 'Trial $i: status $statusCode should route to dead-letter',
        );
      }
    });

    test('401 and 429 are never classified as non-retryable', () {
      // Property: 401 (Unauthorized) and 429 (Too Many Requests) are
      // explicitly excluded from non-retryable routing.
      expect(SyncErrorClassifier.isNonRetryable(401), isFalse,
          reason: '401 must not be dead-lettered (triggers token refresh)');
      expect(SyncErrorClassifier.isNonRetryable(429), isFalse,
          reason: '429 must not be dead-lettered (retry after backoff)');

      expect(SyncErrorClassifier.classify(401), equals(SyncErrorAction.retry),
          reason: '401 should be retryable (token refresh)');
      expect(SyncErrorClassifier.classify(429), equals(SyncErrorAction.retry),
          reason: '429 should be retryable (rate limit backoff)');
    });

    test('all 5xx codes are classified as retryable (not dead-lettered)', () {
      // Property: For any HTTP 5xx status code, the error is transient and
      // should be retried (not dead-lettered immediately).
      for (var i = 0; i < numTrials; i++) {
        final statusCode = 500 + random.nextInt(100); // 500..599

        expect(
          SyncErrorClassifier.isNonRetryable(statusCode),
          isFalse,
          reason: 'Trial $i: status $statusCode (5xx) must not be non-retryable',
        );
        expect(
          SyncErrorClassifier.isRetryable(statusCode),
          isTrue,
          reason: 'Trial $i: status $statusCode (5xx) should be retryable',
        );
        expect(
          SyncErrorClassifier.classify(statusCode),
          equals(SyncErrorAction.retry),
          reason: 'Trial $i: status $statusCode (5xx) should route to retry',
        );
      }
    });

    test('success codes (2xx) are never classified as non-retryable or retryable', () {
      // Property: For any 2xx status, the code represents success.
      for (var i = 0; i < numTrials; i++) {
        final statusCode = 200 + random.nextInt(100); // 200..299

        expect(
          SyncErrorClassifier.isNonRetryable(statusCode),
          isFalse,
          reason: 'Trial $i: status $statusCode (2xx) must not be non-retryable',
        );
        expect(
          SyncErrorClassifier.isRetryable(statusCode),
          isFalse,
          reason: 'Trial $i: status $statusCode (2xx) must not be retryable',
        );
        expect(
          SyncErrorClassifier.classify(statusCode),
          equals(SyncErrorAction.success),
          reason: 'Trial $i: status $statusCode (2xx) should be success',
        );
      }
    });

    test('exhaustive 4xx coverage: exactly 401 and 429 are excluded from dead-letter', () {
      // Property: For EVERY code in [400..499], only 401 and 429 are NOT
      // non-retryable. All others are non-retryable.
      for (var statusCode = 400; statusCode <= 499; statusCode++) {
        final expected = (statusCode != 401 && statusCode != 429);
        expect(
          SyncErrorClassifier.isNonRetryable(statusCode),
          equals(expected),
          reason: 'Status $statusCode: isNonRetryable should be $expected',
        );
      }
    });

    test('non-retryable errors result in immediate dead-letter (no retry action)', () {
      // Property: The classify function maps non-retryable codes directly
      // to deadLetter — there is no intermediate state.
      final nonRetryableCodes = [
        400, 402, 403, 404, 405, 406, 407, 408, 409, 410,
        411, 412, 413, 414, 415, 416, 417, 418, 421, 422,
        423, 424, 425, 426, 428, 430, 431, 451, 499,
      ];

      for (final code in nonRetryableCodes) {
        final action = SyncErrorClassifier.classify(code);
        expect(
          action,
          equals(SyncErrorAction.deadLetter),
          reason: 'Status $code should be immediately dead-lettered',
        );
        // Verify it's NOT retry
        expect(
          action,
          isNot(equals(SyncErrorAction.retry)),
          reason: 'Status $code must NOT be retried',
        );
      }
    });

    test('random 4xx codes (excl 401/429) always dead-letter without retry', () {
      // Property: generating random non-retryable codes and verifying the
      // full routing decision holds. This simulates what SyncPushService does.
      for (var i = 0; i < numTrials; i++) {
        final statusCode = randomNonRetryable4xx(random);

        // The command should go to dead-letter immediately
        final action = SyncErrorClassifier.classify(statusCode);
        expect(action, equals(SyncErrorAction.deadLetter),
            reason: 'Trial $i: HTTP $statusCode → dead-letter (no retry)');

        // Verify it is NOT retryable
        expect(SyncErrorClassifier.isRetryable(statusCode), isFalse,
            reason: 'Trial $i: HTTP $statusCode must not be retryable');
      }
    });
  });
}
