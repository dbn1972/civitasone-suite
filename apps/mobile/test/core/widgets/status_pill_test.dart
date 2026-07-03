import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/widgets/status_pill.dart';

void main() {
  Widget buildSubject(String status, {Brightness brightness = Brightness.light}) {
    return MaterialApp(
      theme: brightness == Brightness.light
          ? ThemeData.light(useMaterial3: true)
          : ThemeData.dark(useMaterial3: true),
      home: Scaffold(body: StatusPill(status: status)),
    );
  }

  group('StatusPill', () {
    testWidgets('renders capitalized label text', (tester) async {
      await tester.pumpWidget(buildSubject('approved'));
      expect(find.text('Approved'), findsOneWidget);
    });

    testWidgets('renders status with underscore replacement', (tester) async {
      await tester.pumpWidget(buildSubject('in_review'));
      expect(find.text('In review'), findsOneWidget);
    });

    testWidgets('provides accessibility semantics', (tester) async {
      await tester.pumpWidget(buildSubject('pending'));

      final semantics = tester.getSemantics(find.byType(StatusPill));
      expect(semantics.label, contains('Status: Pending'));
    });

    testWidgets('renders with green theme for approved status in light mode',
        (tester) async {
      await tester.pumpWidget(buildSubject('approved'));
      await tester.pumpAndSettle();

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFDCFCE7));
    });

    testWidgets('renders with green theme for approved status in dark mode',
        (tester) async {
      await tester.pumpWidget(buildSubject('approved', brightness: Brightness.dark));
      await tester.pumpAndSettle();

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFF14532D));
    });

    testWidgets('renders with yellow/amber theme for pending in light mode',
        (tester) async {
      await tester.pumpWidget(buildSubject('pending'));
      await tester.pumpAndSettle();

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFFEF3C7));
    });

    testWidgets('renders with red theme for rejected in light mode',
        (tester) async {
      await tester.pumpWidget(buildSubject('rejected'));
      await tester.pumpAndSettle();

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFFEE2E2));
    });

    testWidgets('renders with blue theme for draft in light mode',
        (tester) async {
      await tester.pumpWidget(buildSubject('draft'));
      await tester.pumpAndSettle();

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFDBEAFE));
    });

    testWidgets('renders with default grey theme for unknown status',
        (tester) async {
      await tester.pumpWidget(buildSubject('unknown_status'));
      await tester.pumpAndSettle();

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFF1F5F9));
    });

    testWidgets('renders critical status with dark red in light mode',
        (tester) async {
      await tester.pumpWidget(buildSubject('critical'));
      await tester.pumpAndSettle();

      expect(find.text('Critical'), findsOneWidget);
      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFFCA5A5));
    });

    testWidgets('renders with pill shape (rounded border)', (tester) async {
      await tester.pumpWidget(buildSubject('active'));
      await tester.pumpAndSettle();

      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.borderRadius, BorderRadius.circular(20));
    });

    testWidgets('handles empty status string gracefully', (tester) async {
      await tester.pumpWidget(buildSubject(''));
      await tester.pumpAndSettle();

      // Should not crash — renders the default color scheme
      expect(find.byType(StatusPill), findsOneWidget);
    });

    testWidgets('is case-insensitive for status matching', (tester) async {
      await tester.pumpWidget(buildSubject('APPROVED'));
      await tester.pumpAndSettle();

      // Should use green for approved regardless of case
      final container = tester.widget<Container>(
        find.descendant(
          of: find.byType(StatusPill),
          matching: find.byType(Container),
        ),
      );
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, const Color(0xFFDCFCE7));
    });
  });
}
