import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/stock_scanner/stock_scanner_screen.dart';
import 'package:civitasone_mobile/features/stock_scanner/models.dart';

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

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  Widget buildSubject({bool? connectivity}) {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: MaterialApp(
        home: StockScannerScreen(connectivityOverride: connectivity),
      ),
    );
  }

  group('StockScannerScreen', () {
    testWidgets('renders with title and mode chips', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      expect(find.text('Stock Scanner'), findsOneWidget);
      expect(find.text('Lookup'), findsOneWidget);
      expect(find.text('Receive'), findsOneWidget);
      expect(find.text('Adjust'), findsOneWidget);
    });

    testWidgets('Lookup mode selected by default', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      // Lookup chip should be selected (ChoiceChip selected state)
      final lookupChip = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'Lookup'),
      );
      expect(lookupChip.selected, isTrue);
    });

    testWidgets('shows scanner viewfinder initially', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      expect(find.text('Point at barcode'), findsOneWidget);
      expect(find.text('Scan'), findsOneWidget);
    });

    testWidgets('scan button triggers scan and shows result', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Scan'));
      await tester.pump(const Duration(seconds: 2));

      expect(find.text('A4 Paper Ream'), findsOneWidget);
      expect(find.text('SKU-001'), findsOneWidget);
    });

    testWidgets('shows stock info after scan', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Scan'));
      await tester.pump(const Duration(seconds: 2));

      expect(find.textContaining('150'), findsWidgets);
      expect(find.text('Shelf A-3'), findsOneWidget);
    });

    testWidgets('Receive mode shows goods receipt form', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      // Switch to Receive mode
      await tester.tap(find.text('Receive'));
      await tester.pumpAndSettle();

      // Trigger scan
      await tester.tap(find.text('Scan'));
      await tester.pump(const Duration(seconds: 2));

      expect(find.text('Goods Receipt'), findsOneWidget);
      expect(find.text('Quantity received'), findsOneWidget);
      expect(find.text('Confirm Receipt'), findsOneWidget);
    });

    testWidgets('Adjust mode shows adjustment form', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      // Switch to Adjust mode
      await tester.tap(find.text('Adjust'));
      await tester.pumpAndSettle();

      // Trigger scan
      await tester.tap(find.text('Scan'));
      await tester.pump(const Duration(seconds: 2));

      expect(find.text('Stock Adjustment'), findsOneWidget);
      expect(find.text('New quantity'), findsOneWidget);
      expect(find.text('Submit Adjustment'), findsOneWidget);
    });

    testWidgets('goods receipt submits to outbox', (tester) async {
      when(() => mockDb.enqueueOutbox(
            mailbox: any(named: 'mailbox'),
            operation: any(named: 'operation'),
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).thenAnswer((_) async => 'outbox-id');

      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      // Switch to Receive mode
      await tester.tap(find.text('Receive'));
      await tester.pumpAndSettle();

      // Scan
      await tester.tap(find.text('Scan'));
      await tester.pump(const Duration(seconds: 2));

      // Submit receipt
      await tester.tap(find.text('Confirm Receipt'));
      await tester.pump(const Duration(seconds: 1));

      verify(() => mockDb.enqueueOutbox(
            mailbox: 'goods_receipts',
            operation: 'create',
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).called(1);
    });

    testWidgets('shows offline banner when disconnected', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: false));
      await tester.pumpAndSettle();

      expect(find.textContaining('Offline'), findsOneWidget);
    });
  });

  group('StockItem model', () {
    test('isBelowMin returns true when below minimum', () {
      const item = StockItem(
        id: 'i1',
        tenantId: 't1',
        sku: 'SKU-001',
        name: 'Item',
        currentQty: 5,
        unit: 'pcs',
        minQty: 10,
      );
      expect(item.isBelowMin, isTrue);
    });

    test('isBelowMin returns false when above minimum', () {
      const item = StockItem(
        id: 'i1',
        tenantId: 't1',
        sku: 'SKU-001',
        name: 'Item',
        currentQty: 15,
        unit: 'pcs',
        minQty: 10,
      );
      expect(item.isBelowMin, isFalse);
    });

    test('varianceFromMin calculates correctly', () {
      const item = StockItem(
        id: 'i1',
        tenantId: 't1',
        sku: 'SKU-001',
        name: 'Item',
        currentQty: 7,
        unit: 'pcs',
        minQty: 10,
      );
      expect(item.varianceFromMin, -3);
    });

    test('isAboveMax returns true when over maximum', () {
      const item = StockItem(
        id: 'i1',
        tenantId: 't1',
        sku: 'SKU-001',
        name: 'Item',
        currentQty: 110,
        unit: 'pcs',
        maxQty: 100,
      );
      expect(item.isAboveMax, isTrue);
    });
  });

  group('StockAdjustment model', () {
    test('variance calculates correctly (increase)', () {
      final adj = StockAdjustment(
        id: 'a1',
        tenantId: 't1',
        itemId: 'i1',
        itemName: 'Item',
        previousQty: 50,
        adjustedQty: 75,
        reason: AdjustmentReason.found,
        adjustedAt: _demoDate,
        adjustedBy: 'user',
      );
      expect(adj.variance, 25);
    });

    test('variance calculates correctly (decrease)', () {
      final adj = StockAdjustment(
        id: 'a1',
        tenantId: 't1',
        itemId: 'i1',
        itemName: 'Item',
        previousQty: 100,
        adjustedQty: 80,
        reason: AdjustmentReason.damaged,
        adjustedAt: _demoDate,
        adjustedBy: 'user',
      );
      expect(adj.variance, -20);
      expect(adj.absoluteVariance, 20);
    });
  });
}

final _demoDate = DateTime(2024, 1, 15);
