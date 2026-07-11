/// Court analytics / pendency / overdue models.
///
/// Mirrors the court-service REST payloads byte-for-byte:
///   GET /v1/court/cases/analytics  → CourtAnalytics
///   GET /v1/court/cases/pendency   → { summary: [PendencyBucket], total, source }
///   GET /v1/court/cases/overdue    → { items: [CourtCase], count, asOf }
///
/// Plain null-safe Dart (no freezed), matching the app's model style.

import 'court_case.dart';

/// Disposal / pendency KPIs for a period.
/// Live shape:
///   { "period": {"from","to"}, "instituted", "disposed", "pending",
///     "avgPendencyDays", "oldestPendingDays", "clearanceRatePct", "source" }
class CourtAnalytics {
  const CourtAnalytics({
    required this.instituted,
    required this.disposed,
    required this.pending,
    required this.avgPendencyDays,
    required this.oldestPendingDays,
    required this.clearanceRatePct,
    this.from,
    this.to,
    this.source,
  });

  final String? from;
  final String? to;
  final int instituted;
  final int disposed;
  final int pending;
  final int avgPendencyDays;
  final int oldestPendingDays;

  /// Clearance ratio as a whole-number percentage (disposed / instituted).
  final int clearanceRatePct;
  final String? source;

  static int _int(dynamic v) => (v as num?)?.toInt() ?? 0;

  factory CourtAnalytics.fromJson(Map<String, dynamic> json) {
    final period = json['period'] as Map<String, dynamic>?;
    return CourtAnalytics(
      from: period?['from'] as String?,
      to: period?['to'] as String?,
      instituted: _int(json['instituted']),
      disposed: _int(json['disposed']),
      pending: _int(json['pending']),
      avgPendencyDays: _int(json['avgPendencyDays']),
      oldestPendingDays: _int(json['oldestPendingDays']),
      clearanceRatePct: _int(json['clearanceRatePct']),
      source: json['source'] as String?,
    );
  }
}

/// One row of the pendency summary: a status and its case count.
class PendencyBucket {
  const PendencyBucket({required this.status, required this.count});

  final String status;
  final int count;

  factory PendencyBucket.fromJson(Map<String, dynamic> json) => PendencyBucket(
        status: json['status'] as String? ?? 'unknown',
        count: (json['count'] as num?)?.toInt() ?? 0,
      );
}

/// The full pendency response: per-status buckets plus the grand total.
class PendencySummary {
  const PendencySummary({
    required this.buckets,
    required this.total,
    this.source,
  });

  final List<PendencyBucket> buckets;
  final int total;
  final String? source;

  factory PendencySummary.fromJson(Map<String, dynamic> json) => PendencySummary(
        buckets: (json['summary'] as List<dynamic>?)
                ?.map((b) => PendencyBucket.fromJson(b as Map<String, dynamic>))
                .toList() ??
            const [],
        total: (json['total'] as num?)?.toInt() ?? 0,
        source: json['source'] as String?,
      );
}

/// The overdue response: cases past their target disposal date as of [asOf].
class OverdueCases {
  const OverdueCases({
    required this.items,
    required this.count,
    this.asOf,
  });

  final List<CourtCase> items;
  final int count;
  final String? asOf;

  factory OverdueCases.fromJson(Map<String, dynamic> json) => OverdueCases(
        items: (json['items'] as List<dynamic>?)
                ?.map((c) => CourtCase.fromJson(c as Map<String, dynamic>))
                .toList() ??
            const [],
        count: (json['count'] as num?)?.toInt() ?? 0,
        asOf: json['asOf'] as String?,
      );
}
