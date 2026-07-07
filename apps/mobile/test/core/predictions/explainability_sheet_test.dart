import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/predictions/prediction_data.dart';
import 'package:civitasone_mobile/core/predictions/explainability_sheet.dart';
import 'package:civitasone_mobile/core/predictions/staleness_indicator.dart';

void main() {
  group('ExplainabilitySheet', () {
    PredictionData _makePrediction({
      double confidence = 0.75,
      bool isFallback = false,
      DateTime? computedAt,
      List<ExplainabilityFactor> factors = const [],
      int? modelVersion,
    }) {
      return PredictionData(
        entityId: 'test-entity',
        domain: 'leads',
        prediction: confidence,
        confidence: confidence,
        factors: factors,
        isFallback: isFallback,
        computedAt: computedAt ?? DateTime.now().toUtc(),
        modelVersion: modelVersion,
      );
    }

    testWidgets('displays Prediction Details header', (tester) async {
      final prediction = _makePrediction();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Prediction Details'), findsOneWidget);
      expect(find.byIcon(Icons.insights), findsOneWidget);
    });

    testWidgets('displays confidence percentage', (tester) async {
      final prediction = _makePrediction(confidence: 0.82);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('82%'), findsOneWidget);
      expect(find.text('Confidence'), findsOneWidget);
    });

    testWidgets('displays contributing factors with bars', (tester) async {
      final prediction = _makePrediction(
        factors: const [
          ExplainabilityFactor(feature: 'daysInStage', contribution: 0.45, direction: 'positive'),
          ExplainabilityFactor(feature: 'interactionCount', contribution: 0.30, direction: 'negative'),
        ],
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ExplainabilitySheet(prediction: prediction),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Contributing Factors'), findsOneWidget);
      expect(find.text('Days In Stage'), findsOneWidget);
      expect(find.text('Interaction Count'), findsOneWidget);
      expect(find.text('45%'), findsOneWidget);
      expect(find.text('30%'), findsOneWidget);
    });

    testWidgets('shows direction arrows (up for positive, down for negative)', (tester) async {
      final prediction = _makePrediction(
        factors: const [
          ExplainabilityFactor(feature: 'f1', contribution: 0.5, direction: 'positive'),
          ExplainabilityFactor(feature: 'f2', contribution: 0.3, direction: 'negative'),
        ],
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ExplainabilitySheet(prediction: prediction),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.arrow_upward), findsOneWidget);
      expect(find.byIcon(Icons.arrow_downward), findsOneWidget);
    });

    testWidgets('shows "No explainability factors available" when empty', (tester) async {
      final prediction = _makePrediction(factors: const []);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('No explainability factors available.'), findsOneWidget);
    });

    testWidgets('shows fallback notice when isFallback is true', (tester) async {
      final prediction = _makePrediction(isFallback: true);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ExplainabilitySheet(prediction: prediction),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('rule-based fallback'),
        findsOneWidget,
      );
    });

    testWidgets('does not show fallback notice when isFallback is false', (tester) async {
      final prediction = _makePrediction(isFallback: false);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('rule-based fallback'), findsNothing);
    });

    testWidgets('shows model version when available', (tester) async {
      final prediction = _makePrediction(modelVersion: 5);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Model v5'), findsOneWidget);
    });

    testWidgets('does not show model version when null', (tester) async {
      final prediction = _makePrediction(modelVersion: null);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Model v'), findsNothing);
    });

    testWidgets('shows staleness indicator when prediction is stale', (tester) async {
      final prediction = _makePrediction(
        computedAt: DateTime.now().toUtc().subtract(const Duration(hours: 4)),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(StalenessIndicator), findsOneWidget);
      expect(find.text('Predicted 4h ago'), findsOneWidget);
    });

    testWidgets('does not show staleness indicator when fresh', (tester) async {
      final prediction = _makePrediction(
        computedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 15)),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExplainabilitySheet(prediction: prediction),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // StalenessIndicator renders SizedBox.shrink when fresh
      expect(find.text('Predicted'), findsNothing);
    });
  });
}
