import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/payments/payment_record_screen.dart';

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
      child: const MaterialApp(home: PaymentRecordScreen()),
    );
  }

  group('PaymentRecordScreen', () {
    testWidgets('renders form with all fields', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Record Payment'), findsWidgets); // AppBar + button
      expect(find.text('Customer / Vendor'), findsOneWidget);
      expect(find.text('Amount (₹)'), findsOneWidget);
      expect(find.text('Payment Mode'), findsOneWidget);
      expect(find.text('Reference # (optional)'), findsOneWidget);
      expect(find.text('Note (optional)'), findsOneWidget);
    });

    testWidgets('shows payment mode chips', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('UPI'), findsOneWidget);
      expect(find.text('CASH'), findsOneWidget);
      expect(find.text('BANK'), findsOneWidget);
      expect(find.text('CHEQUE'), findsOneWidget);
    });

    testWidgets('UPI is selected by default', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      final chip = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'UPI'),
      );
      expect(chip.selected, isTrue);
    });

    testWidgets('can switch payment mode', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('CASH'));
      await tester.pumpAndSettle();

      final cashChip = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'CASH'),
      );
      expect(cashChip.selected, isTrue);

      final upiChip = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'UPI'),
      );
      expect(upiChip.selected, isFalse);
    });

    testWidgets('shows validation error for empty customer', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(FilledButton, 'Record Payment'));
      await tester.pumpAndSettle();

      expect(
          find.text('Please enter a customer/vendor name'), findsOneWidget);
    });

    testWidgets('shows validation error for invalid amount', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextField, 'Customer / Vendor'), 'Test');
      await tester.tap(find.widgetWithText(FilledButton, 'Record Payment'));
      await tester.pumpAndSettle();

      expect(find.text('Please enter a valid amount'), findsOneWidget);
    });

    testWidgets('records payment and shows success state', (tester) async {
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
          find.widgetWithText(TextField, 'Customer / Vendor'), 'Acme Corp');
      await tester.enterText(
          find.widgetWithText(TextField, 'Amount (₹)'), '5000');
      await tester.tap(find.widgetWithText(FilledButton, 'Record Payment'));
      await tester.pumpAndSettle();

      // Success state
      expect(find.text('Payment Recorded'), findsOneWidget);
      expect(find.text('₹5000.00'), findsOneWidget);
      expect(find.text('Payment recorded successfully'), findsOneWidget);
      expect(find.text('Record Another'), findsOneWidget);
    });

    testWidgets('record another resets the form', (tester) async {
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
          find.widgetWithText(TextField, 'Customer / Vendor'), 'Acme');
      await tester.enterText(
          find.widgetWithText(TextField, 'Amount (₹)'), '100');
      await tester.tap(find.widgetWithText(FilledButton, 'Record Payment'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Record Another'));
      await tester.pumpAndSettle();

      // Back to the form — title + button both show
      expect(find.text('Record Payment'), findsWidgets);
      expect(find.text('Customer / Vendor'), findsOneWidget);
    });
  });
}
