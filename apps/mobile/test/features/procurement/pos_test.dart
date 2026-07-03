import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/procurement/pos_screen.dart';

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

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(home: PurchaseOrdersScreen()),
    );
  }

  group('PurchaseOrdersScreen', () {
    testWidgets('renders app bar with correct title', (tester) async {
      when(() => mockDb.listEntities('purchase_orders'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Purchase Orders'), findsOneWidget);
      expect(find.byType(AppBar), findsOneWidget);
    });

    testWidgets('shows loading indicator while database initializes',
        (tester) async {
      when(() => mockDb.listEntities('purchase_orders'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      // Only pump once — the FutureProvider is still resolving on the first frame
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('shows empty state when no purchase orders exist',
        (tester) async {
      when(() => mockDb.listEntities('purchase_orders'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No data — pull to refresh'), findsOneWidget);
    });

    testWidgets('shows list of purchase orders when data exists',
        (tester) async {
      when(() => mockDb.listEntities('purchase_orders'))
          .thenAnswer((_) async => [
                {
                  'id': 'po-1',
                  'mailbox': 'purchase_orders',
                  'data': {
                    'poNumber': 'PO-2024-001',
                    'vendor': 'Acme Corp',
                    'amountMinor': 500000,
                    'status': 'approved',
                  },
                  'updated_at': '2024-01-01T00:00:00Z',
                  'etag': null,
                  'sync_state': 'synced',
                },
                {
                  'id': 'po-2',
                  'mailbox': 'purchase_orders',
                  'data': {
                    'poNumber': 'PO-2024-002',
                    'vendor': 'Widget Inc',
                    'amountMinor': 250000,
                    'status': 'pending',
                  },
                  'updated_at': '2024-01-02T00:00:00Z',
                  'etag': null,
                  'sync_state': 'synced',
                },
              ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('PO-2024-001'), findsOneWidget);
      expect(find.text('Acme Corp'), findsOneWidget);
      expect(find.text('500000'), findsOneWidget);
      expect(find.text('approved'), findsOneWidget);
      expect(find.text('PO-2024-002'), findsOneWidget);
      expect(find.text('Widget Inc'), findsOneWidget);
    });

    testWidgets('falls back to id when poNumber is missing', (tester) async {
      when(() => mockDb.listEntities('purchase_orders'))
          .thenAnswer((_) async => [
                {
                  'id': 'po-fallback',
                  'mailbox': 'purchase_orders',
                  'data': <String, dynamic>{'vendor': 'Test Vendor'},
                  'updated_at': '2024-01-01T00:00:00Z',
                  'etag': null,
                  'sync_state': 'synced',
                },
              ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('po-fallback'), findsOneWidget);
      expect(find.text('Test Vendor'), findsOneWidget);
    });

    testWidgets('pull-to-refresh triggers syncMailbox', (tester) async {
      when(() => mockDb.listEntities('purchase_orders'))
          .thenAnswer((_) async => [
                {
                  'id': 'po-1',
                  'mailbox': 'purchase_orders',
                  'data': {
                    'poNumber': 'PO-001',
                    'vendor': 'Vendor A',
                    'amountMinor': 100000,
                    'status': 'draft',
                  },
                  'updated_at': '2024-01-01T00:00:00Z',
                  'etag': null,
                  'sync_state': 'synced',
                },
              ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('purchase_orders'))
          .called(greaterThanOrEqualTo(1));
    });

    testWidgets('triggers initial sync on mount', (tester) async {
      when(() => mockDb.listEntities('purchase_orders'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('purchase_orders')).called(1);
    });
  });
}
