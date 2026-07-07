import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/predictions/prediction_data.dart';
import 'package:civitasone_mobile/core/predictions/prediction_chip.dart';
import 'package:civitasone_mobile/core/predictions/explainability_sheet.dart';
import 'package:civitasone_mobile/core/predictions/staleness_indicator.dart';

void main() {
  group('PredictionChip', () {
    PredictionData _makePrediction({
      double confidence = 0.75,
      bool isFallback = false,
      DateTime? computedAt,
      List<ExplainabilityFactor> factors = const [],
    }) {
      return PredictionData(
        entityId: 'test-entity',
        domain: 'leads',
        prediction: confidence,
        confidence: confidence,
        factors: factors,
        isFallback: isFallback,
        computedAt: computedAt ?? DateTime.now().toUtc(),
      );
    }

    testWidgets('displays confidence percentage as label', (tester) async {
      final prediction = _makePrediction(confidence: 0.72);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('72%'), findsOneWidget);
    });

    testWidgets('uses custom label when provided', (tester) async {
      final prediction = _makePrediction(confidence: 0.72);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PredictionChip(prediction: prediction, label: 'High Risk'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('High Risk'), findsOneWidget);
      expect(find.text('72%'), findsNothing);
    });

    testWidgets('shows green colors for high confidence (> 0.70)', (tester) async {
      final prediction = _makePrediction(confidence: 0.85);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();

      // Find the decorated container
      final containers = tester.widgetList<Container>(find.byType(Container));
      final decorated = containers.where((c) => c.decoration is BoxDecoration);
      expect(decorated.isNotEmpty, isTrue);

      // Verify green background color
      final greenBox = decorated.where((c) {
        final d = c.decoration as BoxDecoration;
        return d.color == const Color(0xFFDCFCE7);
      });
      expect(greenBox.isNotEmpty, isTrue);
    });

    testWidgets('shows amber colors for medium confidence (0.40-0.70)', (tester) async {
      final prediction = _makePrediction(confidence: 0.55);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();

      final containers = tester.widgetList<Container>(find.byType(Container));
      final decorated = containers.where((c) => c.decoration is BoxDecoration);
      final amberBox = decorated.where((c) {
        final d = c.decoration as BoxDecoration;
        return d.color == const Color(0xFFFEF3C7);
      });
      expect(amberBox.isNotEmpty, isTrue);
    });

    testWidgets('shows red colors for low confidence (< 0.40)', (tester) async {
      final prediction = _makePrediction(confidence: 0.25);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();

      final containers = tester.widgetList<Container>(find.byType(Container));
      final decorated = containers.where((c) => c.decoration is BoxDecoration);
      final redBox = decorated.where((c) {
        final d = c.decoration as BoxDecoration;
        return d.color == const Color(0xFFFEE2E2);
      });
      expect(redBox.isNotEmpty, isTrue);
    });

    testWidgets('shows info icon for fallback predictions', (tester) async {
      final prediction = _makePrediction(isFallback: true);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.info_outline), findsOneWidget);
    });

    testWidgets('does not show info icon for non-fallback predictions', (tester) async {
      final prediction = _makePrediction(isFallback: false);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.info_outline), findsNothing);
    });

    testWidgets('shows staleness indicator when prediction is stale', (tester) async {
      final prediction = _makePrediction(
        computedAt: DateTime.now().toUtc().subtract(const Duration(hours: 3)),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(StalenessIndicator), findsOneWidget);
      expect(find.text('Predicted 3h ago'), findsOneWidget);
    });

    testWidgets('hides staleness indicator when prediction is fresh', (tester) async {
      final prediction = _makePrediction(
        computedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 10)),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();
      // StalenessIndicator exists but renders SizedBox.shrink
      expect(find.text('Predicted'), findsNothing);
    });

    testWidgets('hides staleness indicator when showStaleness is false', (tester) async {
      final prediction = _makePrediction(
        computedAt: DateTime.now().toUtc().subtract(const Duration(hours: 5)),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PredictionChip(prediction: prediction, showStaleness: false),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(StalenessIndicator), findsNothing);
    });

    testWidgets('opens ExplainabilitySheet on tap', (tester) async {
      final prediction = _makePrediction(
        factors: const [
          ExplainabilityFactor(feature: 'daysInStage', contribution: 0.5, direction: 'positive'),
        ],
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(InkWell));
      await tester.pumpAndSettle();

      expect(find.byType(ExplainabilitySheet), findsOneWidget);
    });

    testWidgets('calls onTap callback when provided instead of opening sheet', (tester) async {
      var tapped = false;
      final prediction = _makePrediction();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PredictionChip(
              prediction: prediction,
              onTap: () => tapped = true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(InkWell));
      expect(tapped, isTrue);
    });

    testWidgets('has accessible touch target ≥ 48dp', (tester) async {
      final prediction = _makePrediction();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();

      final constrainedBoxes = tester.widgetList<ConstrainedBox>(
        find.byType(ConstrainedBox),
      );
      final touchTarget = constrainedBoxes.where(
        (box) => box.constraints.minWidth >= 48 && box.constraints.minHeight >= 48,
      );
      expect(touchTarget.isNotEmpty, isTrue,
          reason: 'Should have a ConstrainedBox with ≥48dp min size');
    });

    testWidgets('has semantic label with prediction details', (tester) async {
      final prediction = _makePrediction(confidence: 0.72);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PredictionChip(prediction: prediction)),
        ),
      );
      await tester.pumpAndSettle();

      final semanticsWidgets = tester.widgetList<Semantics>(find.byType(Semantics));
      final predictionSemantics = semanticsWidgets.where(
        (s) => s.properties.label != null && s.properties.label!.contains('Prediction'),
      );
      expect(predictionSemantics.isNotEmpty, isTrue);
      expect(predictionSemantics.first.properties.button, isTrue);
    });
  });
}
