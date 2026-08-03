import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/widgets/skeleton_card.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/procurement/indents_screen.dart';

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
      child: const MaterialApp(home: IndentsScreen()),
    );
  }

  group('IndentsScreen', () {
    testWidgets('renders app bar with correct title', (tester) async {
      when(() => mockDb.listEntities('indents')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Purchase Indents'), findsOneWidget);
      expect(find.byType(AppBar), findsOneWidget);
    });

    testWidgets('shows skeleton loader while database initializes',
        (tester) async {
      when(() => mockDb.listEntities('indents')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      // Only pump once — the FutureProvider is still resolving on the first frame
      await tester.pump();

      expect(find.byType(SkeletonList), findsOneWidget);
    });

    testWidgets('shows empty state when no indents exist', (tester) async {
      when(() => mockDb.listEntities('indents')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No indent requests'), findsOneWidget);
      expect(find.text('Create an indent from the web portal to see it here'), findsOneWidget);
      expect(find.byIcon(Icons.inbox_outlined), findsOneWidget);
    });

    testWidgets('shows list of indents when data exists', (tester) async {
      when(() => mockDb.listEntities('indents')).thenAnswer((_) async => [
            {
              'id': 'indent-1',
              'mailbox': 'indents',
              'data': {'indentNo': 'IND-2024-001', 'department': 'Finance', 'status': 'pending'},
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
            {
              'id': 'indent-2',
              'mailbox': 'indents',
              'data': {'indentNo': 'IND-2024-002', 'department': 'IT', 'status': 'approved'},
              'updated_at': '2024-01-02T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('IND-2024-001'), findsOneWidget);
      expect(find.text('Finance'), findsOneWidget);
      expect(find.text('pending'), findsOneWidget);
      expect(find.text('IND-2024-002'), findsOneWidget);
      expect(find.text('IT'), findsOneWidget);
      expect(find.text('approved'), findsOneWidget);
    });

    testWidgets('falls back to id when indentNo is missing', (tester) async {
      when(() => mockDb.listEntities('indents')).thenAnswer((_) async => [
            {
              'id': 'indent-fallback',
              'mailbox': 'indents',
              'data': <String, dynamic>{},
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('indent-fallback'), findsOneWidget);
    });

    testWidgets('pull-to-refresh triggers syncMailbox', (tester) async {
      when(() => mockDb.listEntities('indents')).thenAnswer((_) async => [
            {
              'id': 'indent-1',
              'mailbox': 'indents',
              'data': {'indentNo': 'IND-001', 'department': 'HR', 'status': 'draft'},
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Perform pull-to-refresh
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('indents')).called(greaterThanOrEqualTo(1));
    });

    testWidgets('triggers initial sync on mount', (tester) async {
      when(() => mockDb.listEntities('indents')).thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      verify(() => mockEngine.syncMailbox('indents')).called(1);
    });
  });
}
