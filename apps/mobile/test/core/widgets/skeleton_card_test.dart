import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/widgets/skeleton_card.dart';

void main() {
  group('SkeletonCard', () {
    testWidgets('renders without crashing', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonCard()),
        ),
      );

      expect(find.byType(SkeletonCard), findsOneWidget);
    });

    testWidgets('has accessibility semantics for loading state',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonCard()),
        ),
      );

      final semanticsWidgets = tester.widgetList<Semantics>(find.byType(Semantics));
      final loadingSemantics = semanticsWidgets.where(
        (s) => s.properties.label == 'Loading content',
      );
      expect(loadingSemantics.length, 1);
    });

    testWidgets('renders a Card widget', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonCard()),
        ),
      );

      expect(find.byType(Card), findsOneWidget);
    });

    testWidgets('animates opacity (FadeTransition)', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonCard()),
        ),
      );

      // FadeTransition is used by the skeleton card for shimmer animation
      expect(find.byType(FadeTransition), findsWidgets);
    });

    testWidgets('renders in dark mode without errors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(useMaterial3: true),
          home: const Scaffold(body: SkeletonCard()),
        ),
      );

      expect(find.byType(SkeletonCard), findsOneWidget);
      expect(find.byType(Card), findsOneWidget);
    });

    testWidgets('renders placeholder rectangles', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonCard()),
        ),
      );

      // The skeleton card has 3 placeholder boxes inside its Column
      final column = tester.widget<Column>(find.descendant(
        of: find.byType(Card),
        matching: find.byType(Column),
      ));
      // The Column has 3 containers + 2 SizedBoxes = structural children
      expect(column.children.length, 5);
    });
  });

  group('SkeletonList', () {
    testWidgets('renders default 5 skeleton cards', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonList()),
        ),
      );

      expect(find.byType(SkeletonCard), findsNWidgets(5));
    });

    testWidgets('renders custom count of skeleton cards', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonList(count: 3)),
        ),
      );

      expect(find.byType(SkeletonCard), findsNWidgets(3));
    });

    testWidgets('has accessibility semantics for loading list', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonList()),
        ),
      );

      final semanticsWidgets = tester.widgetList<Semantics>(find.byType(Semantics));
      final listSemantics = semanticsWidgets.where((s) => s.properties.label == 'Loading list');
      expect(listSemantics.length, 1);
    });

    testWidgets('uses NeverScrollableScrollPhysics', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: SkeletonList()),
        ),
      );

      final listView = tester.widget<ListView>(find.byType(ListView));
      expect(listView.physics, isA<NeverScrollableScrollPhysics>());
    });
  });
}
