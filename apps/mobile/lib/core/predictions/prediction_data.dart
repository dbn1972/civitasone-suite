/// Data model for ML predictions synced from the server.
///
/// Predictions are included in the mobile sync payload per entity and cached
/// locally via SQLite for offline-first display.
///
/// **Validates: Requirements 22.6, 25.3**
class ExplainabilityFactor {
  const ExplainabilityFactor({
    required this.feature,
    required this.contribution,
    required this.direction,
  });

  /// The feature name driving this factor (e.g., "daysInStage").
  final String feature;

  /// Relative contribution weight of this factor.
  final double contribution;

  /// Whether this factor pushes the prediction up ("positive") or down ("negative").
  final String direction;

  factory ExplainabilityFactor.fromJson(Map<String, dynamic> json) {
    return ExplainabilityFactor(
      feature: json['feature'] as String? ?? '',
      contribution: (json['contribution'] as num?)?.toDouble() ?? 0.0,
      direction: json['direction'] as String? ?? 'positive',
    );
  }

  Map<String, dynamic> toJson() => {
        'feature': feature,
        'contribution': contribution,
        'direction': direction,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ExplainabilityFactor &&
          feature == other.feature &&
          contribution == other.contribution &&
          direction == other.direction;

  @override
  int get hashCode => Object.hash(feature, contribution, direction);
}

/// A single prediction result for an entity, as received from the sync payload.
class PredictionData {
  const PredictionData({
    required this.entityId,
    required this.domain,
    this.prediction,
    required this.confidence,
    required this.factors,
    required this.isFallback,
    required this.computedAt,
    this.modelVersion,
  });

  /// The entity this prediction belongs to.
  final String entityId;

  /// The prediction domain (leads, tickets, inventory, subscriptions, tasks, transactions).
  final String domain;

  /// The predicted value (0.0–1.0 for classification, null if fallback).
  final double? prediction;

  /// Confidence score (0.0–1.0).
  final double confidence;

  /// Top contributing factors (maximum 3).
  final List<ExplainabilityFactor> factors;

  /// Whether this prediction is a fallback (rule-based) result.
  final bool isFallback;

  /// When this prediction was computed on the server.
  final DateTime computedAt;

  /// The model version that produced this prediction.
  final int? modelVersion;

  /// Whether this prediction is stale (older than 1 hour).
  bool get isStale => DateTime.now().toUtc().difference(computedAt).inHours >= 1;

  /// Human-readable staleness label (e.g., "Predicted 3h ago").
  /// Returns empty string when the prediction is fresh (< 1 hour).
  String get stalenessLabel {
    if (!isStale) return '';
    final diff = DateTime.now().toUtc().difference(computedAt);
    if (diff.inDays > 0) {
      return 'Predicted ${diff.inDays}d ago';
    }
    return 'Predicted ${diff.inHours}h ago';
  }

  /// Color classification based on confidence:
  /// - green: > 0.70
  /// - amber: 0.40–0.70
  /// - red: < 0.40
  String get confidenceLevel {
    if (confidence > 0.70) return 'high';
    if (confidence >= 0.40) return 'medium';
    return 'low';
  }

  factory PredictionData.fromJson(Map<String, dynamic> json) {
    return PredictionData(
      entityId: json['entityId'] as String? ?? '',
      domain: json['domain'] as String? ?? '',
      prediction: (json['prediction'] as num?)?.toDouble(),
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0.0,
      factors: ((json['factors'] as List<dynamic>?) ?? [])
          .map((f) => ExplainabilityFactor.fromJson(f as Map<String, dynamic>))
          .toList(),
      isFallback: json['isFallback'] as bool? ?? false,
      computedAt: json['computedAt'] != null
          ? DateTime.parse(json['computedAt'] as String)
          : DateTime.now().toUtc(),
      modelVersion: json['modelVersion'] as int?,
    );
  }

  Map<String, dynamic> toJson() => {
        'entityId': entityId,
        'domain': domain,
        'prediction': prediction,
        'confidence': confidence,
        'factors': factors.map((f) => f.toJson()).toList(),
        'isFallback': isFallback,
        'computedAt': computedAt.toIso8601String(),
        'modelVersion': modelVersion,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PredictionData &&
          entityId == other.entityId &&
          domain == other.domain &&
          prediction == other.prediction &&
          confidence == other.confidence &&
          isFallback == other.isFallback &&
          computedAt == other.computedAt;

  @override
  int get hashCode =>
      Object.hash(entityId, domain, prediction, confidence, isFallback, computedAt);
}
