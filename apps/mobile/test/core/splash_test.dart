import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/splash_screen.dart';

void main() {
  Widget buildSubject({Brightness brightness = Brightness.light}) {
    return MaterialApp(
      theme: brightness == Brightness.light
          ? ThemeData.light(useMaterial3: true)
          : ThemeData.dark(useMaterial3: true),
      home: const SplashScreen(),
    );
  }

  group('SplashScreen', () {
    testWidgets('renders app name CivitasOne', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.text('CivitasOne'), findsOneWidget);
    });

    testWidgets('renders subtitle tagline', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.text('Government · PSU · Enterprise'), findsOneWidget);
    });

    testWidgets('shows loading spinner', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('renders brand icon', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.byIcon(Icons.account_balance), findsOneWidget);
    });

    testWidgets('shows security footer text', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.text('Secured with device encryption'), findsOneWidget);
      expect(find.text('Offline-first · PKCE · Encrypted'), findsOneWidget);
    });

    testWidgets('shows shield icon in footer', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.byIcon(Icons.shield_outlined), findsOneWidget);
    });

    testWidgets('renders full-screen gradient background', (tester) async {
      await tester.pumpWidget(buildSubject());

      final container = tester.widgetList<Container>(find.byType(Container));
      final gradientContainer = container.where((c) {
        final decoration = c.decoration;
        return decoration is BoxDecoration && decoration.gradient != null;
      });
      expect(gradientContainer, isNotEmpty);
    });

    testWidgets('renders correctly in dark mode', (tester) async {
      await tester.pumpWidget(buildSubject(brightness: Brightness.dark));

      expect(find.text('CivitasOne'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('uses SafeArea for content', (tester) async {
      await tester.pumpWidget(buildSubject());

      expect(find.byType(SafeArea), findsOneWidget);
    });
  });
}
