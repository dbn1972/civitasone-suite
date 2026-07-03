import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/customers/customer_list_screen.dart';

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
      child: const MaterialApp(home: CustomerListScreen()),
    );
  }

  group('CustomerListScreen', () {
    testWidgets('renders app bar with title', (tester) async {
      when(() => mockDb.listEntities('customers'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Customers'), findsOneWidget);
    });

    testWidgets('shows search bar', (tester) async {
      when(() => mockDb.listEntities('customers'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.search), findsOneWidget);
      expect(find.text('Search customers...'), findsOneWidget);
    });

    testWidgets('shows empty state when no customers', (tester) async {
      when(() => mockDb.listEntities('customers'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No customers yet'), findsOneWidget);
    });

    testWidgets('shows customer list', (tester) async {
      when(() => mockDb.listEntities('customers')).thenAnswer((_) async => [
            {
              'id': 'c-1',
              'mailbox': 'customers',
              'data': {
                'id': 'c-1',
                'name': 'Sharma Traders',
                'phone': '9876543210',
                'outstandingBalance': 500000,
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
            {
              'id': 'c-2',
              'mailbox': 'customers',
              'data': {
                'id': 'c-2',
                'name': 'Patel Corp',
                'phone': '9123456789',
                'outstandingBalance': -200000,
              },
              'updated_at': '2024-01-02T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Sharma Traders'), findsOneWidget);
      expect(find.text('9876543210'), findsOneWidget);
      expect(find.text('Patel Corp'), findsOneWidget);
      expect(find.text('9123456789'), findsOneWidget);
    });

    testWidgets('shows balance in red when they owe', (tester) async {
      when(() => mockDb.listEntities('customers')).thenAnswer((_) async => [
            {
              'id': 'c-1',
              'mailbox': 'customers',
              'data': {
                'id': 'c-1',
                'name': 'Debtor',
                'outstandingBalance': 100000,
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Should show the balance amount
      expect(find.text('₹1000'), findsOneWidget);
    });

    testWidgets('search filters customer list', (tester) async {
      when(() => mockDb.listEntities('customers')).thenAnswer((_) async => [
            {
              'id': 'c-1',
              'mailbox': 'customers',
              'data': {
                'id': 'c-1',
                'name': 'Sharma Traders',
                'phone': '9876543210',
                'outstandingBalance': 0,
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
            {
              'id': 'c-2',
              'mailbox': 'customers',
              'data': {
                'id': 'c-2',
                'name': 'Patel Corp',
                'phone': '9123456789',
                'outstandingBalance': 0,
              },
              'updated_at': '2024-01-02T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Both visible
      expect(find.text('Sharma Traders'), findsOneWidget);
      expect(find.text('Patel Corp'), findsOneWidget);

      // Search for Sharma
      await tester.enterText(
          find.widgetWithText(TextField, 'Search customers...'), 'Sharma');
      await tester.pumpAndSettle();

      expect(find.text('Sharma Traders'), findsOneWidget);
      expect(find.text('Patel Corp'), findsNothing);
    });

    testWidgets('has FAB for adding customer', (tester) async {
      when(() => mockDb.listEntities('customers'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byType(FloatingActionButton), findsOneWidget);
      expect(find.text('Customer'), findsWidgets);
    });

    testWidgets('triggers initial sync', (tester) async {
      when(() => mockDb.listEntities('customers'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('customers')).called(1);
    });
  });
}
