import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/widgets/skeleton_card.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/procurement/approvals_screen.dart';

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

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(
        home: ApprovalsScreen(),
      ),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  group('ApprovalsScreen (Procurement)', () {
    testWidgets('shows skeleton loading while database loads', (tester) async {
      // Override dbProvider with a future that never resolves (simulates
      // loading) without leaving a pending timer behind.
      final never = Completer<SyncDatabase>();
      addTearDown(() => never.complete(mockDb));
      final widget = ProviderScope(
        overrides: [
          dbProvider.overrideWith((_) => never.future),
          syncEngineProvider.overrideWithValue(mockEngine),
        ],
        child: const MaterialApp(
          home: ApprovalsScreen(),
        ),
      );

      await tester.pumpWidget(widget);
      await tester.pump();

      expect(find.text('Approvals'), findsOneWidget); // AppBar title
      expect(find.byType(SkeletonList), findsOneWidget);
    });

    testWidgets('shows empty state when no pending approvals', (tester) async {
      when(() => mockDb.listEntities('approvals'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No pending approvals'), findsOneWidget);
      expect(find.byIcon(Icons.approval), findsOneWidget);
    });

    testWidgets('renders approval cards with title and status', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'apr-1',
              'mailbox': 'approvals',
              'data': {
                'title': 'Purchase Order #PO-2024-001',
                'type': 'Purchase Order',
                'requestedBy': 'John Doe',
                'status': 'pending',
                'amount': 5000000, // 50,000 rupees
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Purchase Order #PO-2024-001'), findsOneWidget);
      expect(find.textContaining('Purchase Order'), findsWidgets);
      expect(find.textContaining('John Doe'), findsOneWidget);
      expect(find.textContaining('₹50,000'), findsOneWidget);
    });

    testWidgets('shows "Tap to approve / reject" hint on pending items',
        (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'apr-1',
              'mailbox': 'approvals',
              'data': {
                'title': 'Indent Request',
                'type': 'Indent',
                'requestedBy': 'User',
                'status': 'pending',
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Tap to approve / reject'), findsOneWidget);
    });

    testWidgets('does not show action hint on already decided items',
        (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'apr-1',
              'mailbox': 'approvals',
              'data': {
                'title': 'Decided Item',
                'type': 'PO',
                'requestedBy': 'User',
                'status': 'approved',
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Tap to approve / reject'), findsNothing);
    });

    testWidgets('shows action sheet on tap of pending item', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'apr-1',
              'mailbox': 'approvals',
              'data': {
                'title': 'Test Approval',
                'type': 'PO',
                'requestedBy': 'Jane',
                'status': 'pending',
                'amount': 100000,
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.tap(find.text('Test Approval'));
      await tester.pumpAndSettle();

      // Bottom sheet should show approve/reject buttons
      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Reject'), findsOneWidget);
      expect(find.text('Comment (optional)'), findsOneWidget);
    });

    testWidgets('syncs approvals mailbox on init', (tester) async {
      when(() => mockDb.listEntities('approvals'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      verify(() => mockEngine.syncMailbox('approvals')).called(1);
    });

    testWidgets('has RefreshIndicator on list', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'apr-1',
              'mailbox': 'approvals',
              'data': {
                'title': 'Item',
                'status': 'pending',
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(RefreshIndicator), findsOneWidget);
    });

    testWidgets('uses ListView.builder (not Column)', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'apr-1',
              'mailbox': 'approvals',
              'data': {'title': 'Item', 'status': 'pending'},
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('refresh button has tooltip for accessibility', (tester) async {
      when(() => mockDb.listEntities('approvals'))
          .thenAnswer((_) async => []);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      final iconButtons = tester.widgetList<IconButton>(find.byType(IconButton));
      final refreshButton = iconButtons.firstWhere(
        (btn) => btn.tooltip == 'Refresh',
        orElse: () => throw TestFailure('No refresh button with tooltip found'),
      );
      expect(refreshButton.tooltip, 'Refresh');
    });

    testWidgets('approval enqueues to outbox for offline sync', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'apr-1',
              'mailbox': 'approvals',
              'data': {
                'title': 'Test',
                'type': 'PO',
                'requestedBy': 'User',
                'status': 'pending',
              },
              'updated_at': '2024-01-01T00:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);
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
          )).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // Tap to open action sheet
      await tester.tap(find.text('Test'));
      await tester.pumpAndSettle();

      // Tap Approve
      await tester.tap(find.text('Approve'));
      await pumpUntilSettled(tester);

      verify(() => mockDb.enqueueOutbox(
            mailbox: 'approvals',
            operation: 'approved',
            entityId: 'apr-1',
            payload: any(named: 'payload'),
          )).called(1);
    });
  });
}
