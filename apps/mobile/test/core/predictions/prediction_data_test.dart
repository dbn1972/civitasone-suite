import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/predictions/prediction_data.dart';

void main() {
  group('ExplainabilityFactor', () {
    test('fromJson parses valid JSON', () {
      final json = {
        'feature': 'daysInStage',
        'contribution': 0.45,
        'direction': 'positive',
      };
      final factor = ExplainabilityFactor.fromJson(json);
      expect(factor.feature, 'daysInStage');
      expect(factor.contribution, 0.45);
      expect(factor.direction, 'positive');
    });

    test('fromJson handles missing fields with defaults', () {
      final factor = ExplainabilityFactor.fromJson({});
      expect(factor.feature, '');
      expect(factor.contribution, 0.0);
      expect(factor.direction, 'positive');
    });

    test('toJson produces correct output', () {
      const factor = ExplainabilityFactor(
        feature: 'interactionCount',
        contribution: 0.30,
        direction: 'negative',
      );
      final json = factor.toJson();
      expect(json['feature'], 'interactionCount');
      expect(json['contribution'], 0.30);
      expect(json['direction'], 'negative');
    });

    test('equality works correctly', () {
      const a = ExplainabilityFactor(
        feature: 'x',
        contribution: 0.5,
        direction: 'positive',
      );
      const b = ExplainabilityFactor(
        feature: 'x',
        contribution: 0.5,
        direction: 'positive',
      );
      const c = ExplainabilityFactor(
        feature: 'y',
        contribution: 0.5,
        direction: 'positive',
      );
      expect(a, equals(b));
      expect(a, isNot(equals(c)));
    });
  });

  group('PredictionData', () {
    test('fromJson parses complete JSON', () {
      final json = {
        'entityId': 'lead-123',
        'domain': 'leads',
        'prediction': 0.72,
        'confidence': 0.85,
        'factors': [
          {'feature': 'daysInStage', 'contribution': 0.4, 'direction': 'positive'},
          {'feature': 'interactionCount', 'contribution': 0.35, 'direction': 'positive'},
        ],
        'isFallback': false,
        'computedAt': '2025-07-01T10:00:00.000Z',
        'modelVersion': 3,
      };
      final prediction = PredictionData.fromJson(json);
      expect(prediction.entityId, 'lead-123');
      expect(prediction.domain, 'leads');
      expect(prediction.prediction, 0.72);
      expect(prediction.confidence, 0.85);
      expect(prediction.factors.length, 2);
      expect(prediction.isFallback, false);
      expect(prediction.modelVersion, 3);
    });

    test('fromJson handles null prediction (fallback)', () {
      final json = {
        'entityId': 'ticket-456',
        'domain': 'tickets',
        'prediction': null,
        'confidence': 0.0,
        'factors': <dynamic>[],
        'isFallback': true,
        'computedAt': '2025-07-01T10:00:00.000Z',
      };
      final prediction = PredictionData.fromJson(json);
      expect(prediction.prediction, isNull);
      expect(prediction.isFallback, true);
      expect(prediction.confidence, 0.0);
    });

    test('toJson round-trips correctly', () {
      final original = PredictionData(
        entityId: 'item-789',
        domain: 'inventory',
        prediction: 0.55,
        confidence: 0.60,
        factors: const [
          ExplainabilityFactor(feature: 'avgDailyMovement', contribution: 0.7, direction: 'positive'),
        ],
        isFallback: false,
        computedAt: DateTime.utc(2025, 7, 1, 10, 0, 0),
        modelVersion: 2,
      );
      final json = original.toJson();
      final restored = PredictionData.fromJson(json);
      expect(restored.entityId, original.entityId);
      expect(restored.domain, original.domain);
      expect(restored.prediction, original.prediction);
      expect(restored.confidence, original.confidence);
      expect(restored.factors.length, 1);
      expect(restored.isFallback, original.isFallback);
      expect(restored.modelVersion, original.modelVersion);
    });

    test('isStale returns true when > 1 hour old', () {
      final stale = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.5,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc().subtract(const Duration(hours: 2)),
      );
      expect(stale.isStale, true);
    });

    test('isStale returns false when < 1 hour old', () {
      final fresh = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.5,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 30)),
      );
      expect(fresh.isStale, false);
    });

    test('stalenessLabel returns empty string when fresh', () {
      final fresh = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.5,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 30)),
      );
      expect(fresh.stalenessLabel, '');
    });

    test('stalenessLabel returns hours format', () {
      final stale = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.5,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc().subtract(const Duration(hours: 3)),
      );
      expect(stale.stalenessLabel, 'Predicted 3h ago');
    });

    test('stalenessLabel returns days format', () {
      final stale = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.5,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc().subtract(const Duration(days: 2)),
      );
      expect(stale.stalenessLabel, 'Predicted 2d ago');
    });

    test('confidenceLevel returns high for > 0.70', () {
      final p = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.85,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc(),
      );
      expect(p.confidenceLevel, 'high');
    });

    test('confidenceLevel returns medium for 0.40–0.70', () {
      final p = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.55,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc(),
      );
      expect(p.confidenceLevel, 'medium');
    });

    test('confidenceLevel returns low for < 0.40', () {
      final p = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.25,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc(),
      );
      expect(p.confidenceLevel, 'low');
    });

    test('confidenceLevel boundary at 0.70 is medium', () {
      final p = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.70,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc(),
      );
      expect(p.confidenceLevel, 'medium');
    });

    test('confidenceLevel boundary at 0.40 is medium', () {
      final p = PredictionData(
        entityId: 'e1',
        domain: 'leads',
        confidence: 0.40,
        factors: const [],
        isFallback: false,
        computedAt: DateTime.now().toUtc(),
      );
      expect(p.confidenceLevel, 'medium');
    });
  });
}
