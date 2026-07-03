import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/invoicing/invoice_create_screen.dart';

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
      child: const MaterialApp(home: InvoiceCreateScreen()),
    );
  }

  group('InvoiceCreateScreen', () {
    testWidgets('renders form with title and customer field', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('New Invoice'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Add item'), findsOneWidget);
      expect(find.text('Create Invoice'), findsOneWidget);
    });

    testWidgets('shows recent customer suggestions', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Sharma Traders'), findsOneWidget);
      expect(find.text('Patel Enterprises'), findsOneWidget);
      expect(find.text('Gupta & Sons'), findsOneWidget);
    });

    testWidgets('selecting recent customer fills the field', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Sharma Traders'));
      await tester.pumpAndSettle();

      final textField = tester.widget<TextField>(find.byType(TextField));
      expect(textField.controller?.text, 'Sharma Traders');
    });

    testWidgets('shows empty items state', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No items yet'), findsOneWidget);
    });

    testWidgets('add item button opens bottom sheet', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add item'));
      await tester.pumpAndSettle();

      // Sheet shows "Add Item" title + form fields
      expect(find.text('Add Item'), findsWidgets); // title + button in sheet
      expect(find.text('Item name'), findsOneWidget);
      expect(find.text('Qty'), findsOneWidget);
      expect(find.text('Rate (₹)'), findsOneWidget);
      expect(find.text('GST %'), findsOneWidget);
    });

    testWidgets('adding an item shows it in the list', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add item'));
      await tester.pumpAndSettle();

      // Fill item details
      await tester.enterText(
          find.widgetWithText(TextField, 'Item name'), 'Web Design');
      await tester.enterText(find.widgetWithText(TextField, 'Qty'), '2');
      await tester.enterText(find.widgetWithText(TextField, 'Rate (₹)'), '5000');

      // Tap add button in the bottom sheet
      await tester.tap(find.widgetWithText(FilledButton, 'Add Item'));
      await tester.pumpAndSettle();

      expect(find.text('Web Design'), findsOneWidget);
      expect(find.textContaining('2 ×'), findsOneWidget);
    });

    testWidgets('total auto-calculates with GST', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Add an item: qty=1, rate=1000, GST=18%
      await tester.tap(find.text('Add item'));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextField, 'Item name'), 'Service');
      await tester.enterText(find.widgetWithText(TextField, 'Qty'), '1');
      await tester.enterText(
          find.widgetWithText(TextField, 'Rate (₹)'), '1000');

      await tester.tap(find.widgetWithText(FilledButton, 'Add Item'));
      await tester.pumpAndSettle();

      // Rate = 1000 * 100 = 100000 paise, GST 18% = 18000, total = 118000 = ₹1180.00
      // Shows in both item card and sticky total bar
      expect(find.text('₹1180.00'), findsWidgets);
    });

    testWidgets('shows validation error when no customer entered',
        (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Create Invoice'));
      await tester.pumpAndSettle();

      expect(find.text('Please enter a customer name'), findsOneWidget);
    });

    testWidgets('shows validation error when no items added', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'Test Customer');
      await tester.tap(find.text('Create Invoice'));
      await tester.pumpAndSettle();

      expect(find.text('Please add at least one item'), findsOneWidget);
    });

    testWidgets('creates invoice and shows share sheet', (tester) async {
      // Use a larger surface to avoid overflow in the share sheet
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

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

      // Enter customer
      await tester.enterText(find.byType(TextField).first, 'Acme Corp');
      await tester.pumpAndSettle();

      // Add item
      await tester.tap(find.text('Add item'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.widgetWithText(TextField, 'Item name'), 'Consulting');
      await tester.enterText(find.widgetWithText(TextField, 'Qty'), '1');
      await tester.enterText(
          find.widgetWithText(TextField, 'Rate (₹)'), '500');
      await tester.tap(find.widgetWithText(FilledButton, 'Add Item'));
      await tester.pumpAndSettle();

      // Create invoice
      await tester.tap(find.text('Create Invoice'));
      await tester.pumpAndSettle();

      // Share sheet should appear
      expect(find.text('WhatsApp'), findsOneWidget);
      expect(find.text('Email'), findsOneWidget);
      expect(find.text('PDF'), findsOneWidget);
    });
  });
}
