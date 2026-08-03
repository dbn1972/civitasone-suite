import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/widgets/skeleton_card.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/finance/journal_screen.dart';

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
      child: const MaterialApp(home: JournalScreen()),
    );
  }

  group('JournalScreen', () {
    testWidgets('renders app bar with correct title', (tester) async {
      when(() => mockDb.listEntities('journals')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Journal Entries'), findsOneWidget);
      expect(find.byType(AppBar), findsOneWidget);
    });

    testWidgets('shows skeleton loader while database initializes',
        (tester) async {
      when(() => mockDb.listEntities('journals')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      // Only pump once — the FutureProvider is still resolving on the first frame
      await tester.pump();

      expect(find.byType(SkeletonList), findsOneWidget);
    });

    testWidgets('shows empty state when no journal entries exist',
        (tester) async {
      when(() => mockDb.listEntities('journals')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No journal entries'), findsOneWidget);
      expect(find.text('Entries will appear when vouchers are posted'), findsOneWidget);
      expect(find.byIcon(Icons.inbox_outlined), findsOneWidget);
    });

    testWidgets('shows list of journal entries when data exists',
        (tester) async {
      when(() => mockDb.listEntities('journals')).thenAnswer((_) async => [
            {
              'id': 'jv-1',
              'mailbox': 'journals',
              'data': {
                'voucherNo': 'JV-2024-001',
                'status': 'posted',
                'totalDebitMinor': 2500000,
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
            {
              'id': 'jv-2',
              'mailbox': 'journals',
              'data': {
                'voucherNo': 'JV-2024-002',
                'status': 'draft',
                'totalDebitMinor': 1000000,
              },
              'updated_at': '2024-01-02T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('JV-2024-001'), findsOneWidget);
      expect(find.text('posted'), findsOneWidget);
      expect(find.text('2500000'), findsOneWidget);
      expect(find.text('JV-2024-002'), findsOneWidget);
      expect(find.text('draft'), findsOneWidget);
    });

    testWidgets('falls back to id when voucherNo is missing', (tester) async {
      when(() => mockDb.listEntities('journals')).thenAnswer((_) async => [
            {
              'id': 'jv-fallback',
              'mailbox': 'journals',
              'data': <String, dynamic>{'status': 'pending'},
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('jv-fallback'), findsOneWidget);
    });

    testWidgets('pull-to-refresh triggers syncMailbox', (tester) async {
      when(() => mockDb.listEntities('journals')).thenAnswer((_) async => [
            {
              'id': 'jv-1',
              'mailbox': 'journals',
              'data': {
                'voucherNo': 'JV-001',
                'status': 'draft',
                'totalDebitMinor': 500000,
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

      verify(() => mockEngine.syncMailbox('journals'))
          .called(greaterThanOrEqualTo(1));
    });

    testWidgets('triggers initial sync on mount', (tester) async {
      when(() => mockDb.listEntities('journals')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('journals')).called(1);
    });
  });
}
