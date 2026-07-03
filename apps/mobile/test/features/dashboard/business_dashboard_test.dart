import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/dashboard/business_dashboard_screen.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
    // Default: all mailboxes return empty
    when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => []);
    when(() => mockDb.listEntities('biz_payments')).thenAnswer((_) async => []);
    when(() => mockDb.listEntities('expenses')).thenAnswer((_) async => []);
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(
        home: BusinessDashboardScreen(connectivityOverride: true),
      ),
    );
  }

  /// Pump enough frames for async operations (data load) to complete.
  Future<void> pumpUntilLoaded(WidgetTester tester) async {
    // The widget has multiple async operations: dbProvider resolves, then
    // syncEngine calls, then listEntities calls. Give enough frames.
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  group('BusinessDashboardScreen', () {
    testWidgets('renders header with today text', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      expect(find.text('Today'), findsOneWidget);
    });

    testWidgets('shows stat cards', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      expect(find.text('Sales'), findsOneWidget);
      expect(find.text('Expenses'), findsOneWidget);
      expect(find.text('Receivables'), findsOneWidget);
    });

    testWidgets('shows quick actions', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      expect(find.text('Quick Actions'), findsOneWidget);
      expect(find.text('Invoice'), findsOneWidget);
      expect(find.text('Payment'), findsOneWidget);
      expect(find.text('Expense'), findsOneWidget);
      expect(find.text('Customers'), findsOneWidget);
    });

    testWidgets('shows recent activity section', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      expect(find.text('Recent Activity'), findsOneWidget);
    });

    testWidgets('shows no activity text when empty', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      expect(find.text('No activity yet'), findsOneWidget);
    });

    testWidgets('syncs multiple mailboxes on load', (tester) async {
      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      verify(() => mockEngine.syncMailbox('invoices')).called(1);
      verify(() => mockEngine.syncMailbox('biz_payments')).called(1);
      verify(() => mockEngine.syncMailbox('expenses')).called(1);
    });

    testWidgets('shows recent activity when data exists', (tester) async {
      final todayStr = DateTime.now().toUtc().toIso8601String();
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => [
            {
              'id': 'inv-1',
              'mailbox': 'invoices',
              'data': {
                'invoiceNo': 'INV-2024-001',
                'customerName': 'Test Corp',
                'total': 500000,
                'status': 'unpaid',
                'createdAt': todayStr,
              },
              'updated_at': todayStr,
              'etag': null,
              'sync_state': 'synced',
            },
          ]);
      when(() => mockDb.listEntities('biz_payments'))
          .thenAnswer((_) async => []);
      when(() => mockDb.listEntities('expenses'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      expect(find.text('Invoice INV-2024-001'), findsOneWidget);
      expect(find.text('Test Corp'), findsOneWidget);
    });

    testWidgets('calculates stats from data', (tester) async {
      final todayStr = DateTime.now().toUtc().toIso8601String();
      when(() => mockDb.listEntities('invoices')).thenAnswer((_) async => [
            {
              'id': 'inv-1',
              'mailbox': 'invoices',
              'data': {
                'invoiceNo': 'INV-001',
                'customerName': 'Corp',
                'total': 100000,
                'status': 'unpaid',
                'createdAt': todayStr,
              },
              'updated_at': todayStr,
              'etag': null,
              'sync_state': 'synced',
            },
          ]);
      when(() => mockDb.listEntities('biz_payments'))
          .thenAnswer((_) async => []);
      when(() => mockDb.listEntities('expenses')).thenAnswer((_) async => [
            {
              'id': 'exp-1',
              'mailbox': 'expenses',
              'data': {
                'amountMinor': 50000,
                'category': 'food',
                'createdAt': todayStr,
              },
              'updated_at': todayStr,
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilLoaded(tester);

      // Sales: 100000 paise = ₹1000 = ₹1.0K (shows in Sales + Receivables since status=unpaid)
      expect(find.text('₹1.0K'), findsWidgets);
      // Expenses: 50000 paise = ₹500
      expect(find.text('₹500'), findsOneWidget);
    });
  });
}
