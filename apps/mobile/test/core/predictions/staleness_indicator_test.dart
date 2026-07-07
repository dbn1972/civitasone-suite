import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/predictions/staleness_indicator.dart';

void main() {
  group('StalenessIndicator', () {
    testWidgets('renders nothing when prediction is fresh (< 1 hour)', (tester) async {
      final fresh = DateTime.now().toUtc().subtract(const Duration(minutes: 30));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StalenessIndicator(computedAt: fresh)),
        ),
      );
      await tester.pumpAndSettle();

      // Should render SizedBox.shrink
      expect(find.byType(SizedBox), findsOneWidget);
      expect(find.byIcon(Icons.access_time), findsNothing);
      expect(find.textContaining('Predicted'), findsNothing);
    });

    testWidgets('shows hours format when stale by hours', (tester) async {
      final stale = DateTime.now().toUtc().subtract(const Duration(hours: 3));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StalenessIndicator(computedAt: stale)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.access_time), findsOneWidget);
      expect(find.text('Predicted 3h ago'), findsOneWidget);
    });

    testWidgets('shows days format when stale by days', (tester) async {
      final stale = DateTime.now().toUtc().subtract(const Duration(days: 2));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StalenessIndicator(computedAt: stale)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Predicted 2d ago'), findsOneWidget);
    });

    testWidgets('shows 1h ago at exactly 1 hour boundary', (tester) async {
      final boundary = DateTime.now().toUtc().subtract(const Duration(hours: 1));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StalenessIndicator(computedAt: boundary)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Predicted 1h ago'), findsOneWidget);
    });

    testWidgets('has semantic label for screen readers', (tester) async {
      final stale = DateTime.now().toUtc().subtract(const Duration(hours: 5));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StalenessIndicator(computedAt: stale)),
        ),
      );
      await tester.pumpAndSettle();

      final semanticsWidgets = tester.widgetList<Semantics>(find.byType(Semantics));
      final stalenessSemantics = semanticsWidgets.where(
        (s) =>
            s.properties.label != null &&
            s.properties.label!.contains('Prediction is stale'),
      );
      expect(stalenessSemantics.isNotEmpty, isTrue);
    });

    testWidgets('shows clock icon', (tester) async {
      final stale = DateTime.now().toUtc().subtract(const Duration(hours: 2));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: StalenessIndicator(computedAt: stale)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.access_time), findsOneWidget);
    });
  });
}
