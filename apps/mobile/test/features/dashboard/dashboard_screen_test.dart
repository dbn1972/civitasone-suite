import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/core/module_gating.dart';
import 'package:civitasone_mobile/main.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
    when(() => mockDb.listEntities(any())).thenAnswer((_) async => []);
  });

  Widget buildSubject({List<String>? enabledModules}) {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
        if (enabledModules != null)
          enabledModulesProvider.overrideWith((_) => Future.value(enabledModules)),
      ],
      child: const MaterialApp(
        home: DashboardScreen(),
      ),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  group('DashboardScreen (Main Employee Dashboard)', () {
    testWidgets('renders greeting based on time of day', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // Should show some form of greeting
      expect(
        find.textContaining('Good '),
        findsOneWidget,
      );
    });

    testWidgets('renders "What would you like to do today?" prompt',
        (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(
        find.text('What would you like to do today?'),
        findsOneWidget,
      );
    });

    testWidgets('shows quick action grid items', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Check In'), findsOneWidget);
      expect(find.text('Leave'), findsOneWidget);
      expect(find.text('Payslip'), findsOneWidget);
      expect(find.text('Approvals'), findsOneWidget);
      expect(find.text('Directory'), findsOneWidget);
      expect(find.text('Bills'), findsOneWidget);
    });

    testWidgets('shows module section heading', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Modules'), findsOneWidget);
    });

    testWidgets('shows module cards with descriptions', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('HR & Self-Service'), findsOneWidget);
      expect(find.text('GPS Attendance'), findsOneWidget);
      expect(find.text('Finance'), findsOneWidget);
      expect(find.text('Procurement'), findsOneWidget);
    });

    testWidgets('filters modules based on enabled modules list',
        (tester) async {
      await tester.pumpWidget(buildSubject(enabledModules: ['hrms', 'finance']));
      await pumpUntilSettled(tester);

      // HR and Finance should be visible
      expect(find.text('HR & Self-Service'), findsOneWidget);
      expect(find.text('Finance'), findsOneWidget);

      // Procurement should be hidden
      expect(find.text('Procurement'), findsNothing);
    });

    testWidgets('shows all modules when enabledModules is null (backward compat)',
        (tester) async {
      await tester.pumpWidget(buildSubject(enabledModules: null));
      await pumpUntilSettled(tester);

      // All modules should show
      expect(find.text('HR & Self-Service'), findsOneWidget);
      expect(find.text('Finance'), findsOneWidget);
      expect(find.text('Procurement'), findsOneWidget);
      expect(find.text('CRM'), findsOneWidget);
    });

    testWidgets('uses ListView (not Column) for scrollable content',
        (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('quick actions have InkWell for tap handling', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // Verify InkWell widgets exist (one per quick action visible)
      expect(find.byType(InkWell), findsWidgets);
    });

    testWidgets('module cards use ListTile with trailing chevron',
        (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(ListTile), findsWidgets);
      expect(find.byIcon(Icons.chevron_right), findsWidgets);
    });

    // Accessibility tests
    testWidgets('accessibility: module cards have descriptive subtitle',
        (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // Check that descriptions exist for screen readers
      expect(
        find.text('Leave, attendance, payslip, profile'),
        findsOneWidget,
      );
      expect(
        find.text('Payments, journals, vouchers'),
        findsOneWidget,
      );
    });
  });
}
