import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/finance/payments_screen.dart';

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
      child: const MaterialApp(home: PaymentsScreen()),
    );
  }

  group('PaymentsScreen', () {
    testWidgets('renders app bar with correct title', (tester) async {
      when(() => mockDb.listEntities('payments')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Payments'), findsOneWidget);
      expect(find.byType(AppBar), findsOneWidget);
    });

    testWidgets('shows loading indicator while database initializes',
        (tester) async {
      when(() => mockDb.listEntities('payments')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      // Only pump once — the FutureProvider is still resolving on the first frame
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('shows empty state when no payments exist', (tester) async {
      when(() => mockDb.listEntities('payments')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No data — pull to refresh'), findsOneWidget);
    });

    testWidgets('shows list of payments when data exists', (tester) async {
      when(() => mockDb.listEntities('payments')).thenAnswer((_) async => [
            {
              'id': 'pay-1',
              'mailbox': 'payments',
              'data': {
                'reference': 'PAY-2024-001',
                'status': 'completed',
                'amountMinor': 1500000,
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
            {
              'id': 'pay-2',
              'mailbox': 'payments',
              'data': {
                'reference': 'PAY-2024-002',
                'status': 'pending',
                'amountMinor': 750000,
              },
              'updated_at': '2024-01-02T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('PAY-2024-001'), findsOneWidget);
      expect(find.text('completed'), findsOneWidget);
      expect(find.text('1500000'), findsOneWidget);
      expect(find.text('PAY-2024-002'), findsOneWidget);
      expect(find.text('pending'), findsOneWidget);
    });

    testWidgets('falls back to id when reference is missing', (tester) async {
      when(() => mockDb.listEntities('payments')).thenAnswer((_) async => [
            {
              'id': 'pay-fallback',
              'mailbox': 'payments',
              'data': <String, dynamic>{'status': 'draft'},
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('pay-fallback'), findsOneWidget);
    });

    testWidgets('pull-to-refresh triggers syncMailbox', (tester) async {
      when(() => mockDb.listEntities('payments')).thenAnswer((_) async => [
            {
              'id': 'pay-1',
              'mailbox': 'payments',
              'data': {
                'reference': 'PAY-001',
                'status': 'pending',
                'amountMinor': 100000,
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

      verify(() => mockEngine.syncMailbox('payments'))
          .called(greaterThanOrEqualTo(1));
    });

    testWidgets('triggers initial sync on mount', (tester) async {
      when(() => mockDb.listEntities('payments')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('payments')).called(1);
    });
  });
}
