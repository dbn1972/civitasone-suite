import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/expenses/expense_capture_screen.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
  });

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(home: ExpenseCaptureScreen()),
    );
  }

  group('ExpenseCaptureScreen', () {
    testWidgets('renders form with all elements', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Add Expense'), findsOneWidget);
      expect(find.text('Tap to photograph receipt'), findsOneWidget);
      expect(find.text('Amount (₹)'), findsOneWidget);
      expect(find.text('Category'), findsOneWidget);
      expect(find.text('Save Expense'), findsOneWidget);
    });

    testWidgets('shows category chips', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Travel'), findsOneWidget);
      expect(find.text('Food'), findsOneWidget);
      expect(find.text('Office'), findsOneWidget);
      expect(find.text('Utilities'), findsOneWidget);
      expect(find.text('Salary'), findsOneWidget);
      expect(find.text('Other'), findsOneWidget);
    });

    testWidgets('office category is selected by default', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      final chip = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'Office'),
      );
      expect(chip.selected, isTrue);
    });

    testWidgets('can select different category', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Travel'));
      await tester.pumpAndSettle();

      final travelChip = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'Travel'),
      );
      expect(travelChip.selected, isTrue);
    });

    testWidgets('tapping receipt area updates state', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Tap to photograph receipt'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Receipt captured'), findsWidgets);
    });

    testWidgets('shows validation error for empty amount', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save Expense'));
      await tester.pumpAndSettle();

      expect(find.text('Please enter a valid amount'), findsOneWidget);
    });

    testWidgets('saves expense and shows saved state', (tester) async {
      when(() => mockDb.enqueueOutbox(
            mailbox: any(named: 'mailbox'),
            operation: any(named: 'operation'),
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).thenAnswer((_) async => 'outbox-id');
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'),
            mailbox: any(named: 'mailbox'),
            data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'),
            syncState: any(named: 'syncState'),
          )).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextField, 'Amount (₹)'), '250');
      await tester.tap(find.text('Food'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save Expense'));
      await tester.pumpAndSettle();

      // Saved state shows card
      expect(find.text('Expense Saved'), findsOneWidget);
      expect(find.text('₹250'), findsOneWidget);
      expect(find.text('Food'), findsOneWidget);
      expect(find.text('Add Another'), findsOneWidget);
    });

    testWidgets('add another resets the form', (tester) async {
      when(() => mockDb.enqueueOutbox(
            mailbox: any(named: 'mailbox'),
            operation: any(named: 'operation'),
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).thenAnswer((_) async => 'outbox-id');
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'),
            mailbox: any(named: 'mailbox'),
            data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'),
            syncState: any(named: 'syncState'),
          )).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextField, 'Amount (₹)'), '100');
      await tester.tap(find.text('Save Expense'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add Another'));
      await tester.pumpAndSettle();

      expect(find.text('Add Expense'), findsOneWidget);
      expect(find.text('Tap to photograph receipt'), findsOneWidget);
    });
  });
}
