import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/invoicing/invoice_list_screen.dart';

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
      child: const MaterialApp(home: InvoiceListScreen()),
    );
  }

  group('InvoiceListScreen', () {
    testWidgets('renders app bar with correct title', (tester) async {
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Invoices'), findsOneWidget);
    });

    testWidgets('shows empty state when no invoices exist', (tester) async {
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No invoices yet'), findsOneWidget);
      expect(find.text('Create your first invoice'), findsOneWidget);
    });

    testWidgets('shows filter chips', (tester) async {
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('All'), findsOneWidget);
      expect(find.text('Unpaid'), findsOneWidget);
      expect(find.text('This Month'), findsOneWidget);
    });

    testWidgets('shows list of invoices when data exists', (tester) async {
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => [
            {
              'id': 'inv-1',
              'mailbox': 'invoices',
              'data': {
                'id': 'inv-1',
                'invoiceNo': 'INV-2024-001',
                'customerName': 'Sharma Traders',
                'items': [],
                'status': 'unpaid',
                'total': 1180000,
                'createdAt': '2024-06-15T10:00:00Z',
              },
              'updated_at': '2024-06-15T10:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('INV-2024-001'), findsOneWidget);
      expect(find.text('Sharma Traders'), findsOneWidget);
      expect(find.text('UNPAID'), findsOneWidget);
    });

    testWidgets('filter chips filter the list', (tester) async {
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => [
            {
              'id': 'inv-1',
              'mailbox': 'invoices',
              'data': {
                'id': 'inv-1',
                'invoiceNo': 'INV-2024-001',
                'customerName': 'Paid Corp',
                'items': [],
                'status': 'paid',
                'total': 100000,
                'createdAt': '2024-01-15T10:00:00Z',
              },
              'updated_at': '2024-01-15T10:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
            {
              'id': 'inv-2',
              'mailbox': 'invoices',
              'data': {
                'id': 'inv-2',
                'invoiceNo': 'INV-2024-002',
                'customerName': 'Unpaid Corp',
                'items': [],
                'status': 'unpaid',
                'total': 200000,
                'createdAt': '2024-01-16T10:00:00Z',
              },
              'updated_at': '2024-01-16T10:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Both should be visible with "All" filter
      expect(find.text('INV-2024-001'), findsOneWidget);
      expect(find.text('INV-2024-002'), findsOneWidget);

      // Tap "Unpaid" filter
      await tester.tap(find.text('Unpaid'));
      await tester.pumpAndSettle();

      // Only unpaid should be visible
      expect(find.text('INV-2024-001'), findsNothing);
      expect(find.text('INV-2024-002'), findsOneWidget);
    });

    testWidgets('triggers initial sync on mount', (tester) async {
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('invoices')).called(1);
    });

    testWidgets('has FAB for creating new invoice', (tester) async {
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byType(FloatingActionButton), findsOneWidget);
      expect(find.text('Invoice'), findsOneWidget);
    });
  });
}
