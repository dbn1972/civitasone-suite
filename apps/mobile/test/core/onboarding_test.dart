import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/onboarding_screen.dart';

void main() {
  Widget buildSubject() {
    return MaterialApp(
      home: const OnboardingScreen(),
      routes: {
        '/login': (_) => const Scaffold(body: Text('Login Page')),
      },
    );
  }

  group('OnboardingScreen', () {
    testWidgets('renders the first page with Works Offline title',
        (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Works Offline'), findsOneWidget);
      expect(find.byIcon(Icons.offline_bolt), findsOneWidget);
    });

    testWidgets('renders Skip button', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Skip'), findsOneWidget);
    });

    testWidgets('renders Next button on first page', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Next'), findsOneWidget);
    });

    testWidgets('navigates to second page on Next tap', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('Secure & Simple'), findsOneWidget);
      expect(find.byIcon(Icons.fingerprint), findsOneWidget);
    });

    testWidgets('navigates to third page after two Next taps', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('3 Taps to Anything'), findsOneWidget);
      expect(find.byIcon(Icons.speed), findsOneWidget);
    });

    testWidgets('shows Get Started button on last page', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      expect(find.text('Get Started'), findsOneWidget);
    });

    testWidgets('renders page indicator dots', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // 3 pages = 3 dot containers within the bottom row
      final row = tester.widget<Row>(find.byType(Row).last);
      // First child of the Row is also a Row (dots row)
      expect(row.children.length, greaterThanOrEqualTo(3));
    });

    testWidgets('can swipe between pages', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Works Offline'), findsOneWidget);

      // Swipe left to go to next page
      await tester.drag(find.byType(PageView), const Offset(-400, 0));
      await tester.pumpAndSettle();

      expect(find.text('Secure & Simple'), findsOneWidget);
    });

    testWidgets('renders description text on each page', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // First page description mentions syncing
      expect(
        find.textContaining('syncs automatically'),
        findsOneWidget,
      );
    });
  });
}
