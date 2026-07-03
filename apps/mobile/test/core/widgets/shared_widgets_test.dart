import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/widgets/shared_widgets.dart';

void main() {
  group('AppGradientHeader', () {
    testWidgets('renders child widget', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppGradientHeader(
              child: const Text('Header Content'),
            ),
          ),
        ),
      );

      expect(find.text('Header Content'), findsOneWidget);
    });

    testWidgets('applies gradient decoration', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppGradientHeader(
              child: const Text('Header'),
            ),
          ),
        ),
      );

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.gradient, isA<LinearGradient>());
      expect(decoration.borderRadius, BorderRadius.circular(16));
    });

    testWidgets('accepts custom colors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppGradientHeader(
              colors: const [Colors.red, Colors.blue],
              child: const Text('Custom'),
            ),
          ),
        ),
      );

      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      final gradient = decoration.gradient as LinearGradient;
      expect(gradient.colors, [Colors.red, Colors.blue]);
    });
  });

  group('AppErrorState', () {
    testWidgets('renders error message and retry button', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppErrorState(
              message: 'Connection failed',
              onRetry: () {},
            ),
          ),
        ),
      );

      expect(find.text('Unable to load data'), findsOneWidget);
      expect(find.text('Connection failed'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.byIcon(Icons.wifi_off), findsOneWidget);
      expect(find.byIcon(Icons.refresh), findsOneWidget);
    });

    testWidgets('calls onRetry when retry button is pressed', (tester) async {
      var retryCalled = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppErrorState(
              message: 'Network error',
              onRetry: () => retryCalled = true,
            ),
          ),
        ),
      );

      await tester.tap(find.text('Retry'));
      expect(retryCalled, isTrue);
    });
  });

  group('AppEmptyState', () {
    testWidgets('renders icon and message', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppEmptyState(
              icon: Icons.inbox,
              message: 'No items found',
            ),
          ),
        ),
      );

      expect(find.text('No items found'), findsOneWidget);
      expect(find.byIcon(Icons.inbox), findsOneWidget);
    });

    testWidgets('renders subtitle when provided', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppEmptyState(
              icon: Icons.inbox,
              message: 'No items',
              subtitle: 'Try adding a new item',
            ),
          ),
        ),
      );

      expect(find.text('Try adding a new item'), findsOneWidget);
    });

    testWidgets('renders action button when label and callback provided',
        (tester) async {
      var actionCalled = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppEmptyState(
              icon: Icons.inbox,
              message: 'Empty',
              actionLabel: 'Add New',
              onAction: () => actionCalled = true,
            ),
          ),
        ),
      );

      expect(find.text('Add New'), findsOneWidget);
      await tester.tap(find.text('Add New'));
      expect(actionCalled, isTrue);
    });

    testWidgets('does not render action button when label is null',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppEmptyState(
              icon: Icons.inbox,
              message: 'Nothing here',
            ),
          ),
        ),
      );

      expect(find.byType(FilledButton), findsNothing);
    });
  });

  group('AppCacheBanner', () {
    testWidgets('renders offline message', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: AppCacheBanner()),
        ),
      );

      expect(find.text('Showing cached data'), findsOneWidget);
      expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    });

    testWidgets('has accessibility semantics', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: AppCacheBanner()),
        ),
      );

      final semanticsWidgets = tester.widgetList<Semantics>(find.byType(Semantics));
      final cacheSemantics = semanticsWidgets.where(
        (s) => s.properties.label == 'Showing cached data. You are offline.',
      );
      expect(cacheSemantics.length, 1);
    });
  });

  group('AppHapticButton', () {
    testWidgets('renders label text', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppHapticButton(
              onPressed: () {},
              label: 'Submit',
            ),
          ),
        ),
      );

      expect(find.text('Submit'), findsOneWidget);
    });

    testWidgets('renders loading state with progress indicator',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppHapticButton(
              onPressed: () {},
              label: 'Submit',
              loading: true,
            ),
          ),
        ),
      );

      expect(find.text('Processing…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('is disabled when onPressed is null', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppHapticButton(
              onPressed: null,
              label: 'Disabled',
            ),
          ),
        ),
      );

      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);
    });

    testWidgets('renders custom icon when provided', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppHapticButton(
              onPressed: () {},
              label: 'Save',
              icon: Icons.save,
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.save), findsOneWidget);
    });
  });

  group('AppSummaryRow', () {
    testWidgets('renders all stat items', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppSummaryRow(
              items: [
                (value: '12', label: 'Pending'),
                (value: '5', label: 'Approved'),
                (value: '3', label: 'Rejected'),
              ],
            ),
          ),
        ),
      );

      expect(find.text('12'), findsOneWidget);
      expect(find.text('Pending'), findsOneWidget);
      expect(find.text('5'), findsOneWidget);
      expect(find.text('Approved'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('Rejected'), findsOneWidget);
    });

    testWidgets('renders dividers between items', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppSummaryRow(
              items: [
                (value: '10', label: 'A'),
                (value: '20', label: 'B'),
              ],
            ),
          ),
        ),
      );

      // There should be one divider between two items
      final containers = tester.widgetList<Container>(find.byType(Container));
      final dividers = containers.where((c) => c.constraints?.maxWidth == 1);
      expect(dividers.length, 1);
    });
  });
}
