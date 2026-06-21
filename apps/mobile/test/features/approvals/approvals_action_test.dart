import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
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
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(home: ApprovalsScreen()),
    );
  }

  group('ApprovalsScreen list', () {
    testWidgets('renders without error on startup', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => []);
      when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byType(ApprovalsScreen), findsOneWidget);
    });

    testWidgets('shows empty state when no items', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => []);
      when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('No pending approvals'), findsOneWidget);
    });

    testWidgets('renders approval cards for each item', (tester) async {
      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
            {
              'id': 'a1',
              'mailbox': 'approvals',
              'data': {
                'title': 'PO Approval #42',
                'type': 'purchase_order',
                'requestedBy': 'Ram Kumar',
                'status': 'pending',
                'amount': 50000,
              },
              'updated_at': '2026-06-20T10:00:00Z',
              'etag': null,
              'sync_state': 'synced',
            },
          ]);
      when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('PO Approval #42'), findsOneWidget);
      expect(find.text('Tap to approve / reject →'), findsOneWidget);
    });

    testWidgets('approve action enqueues outbox with real payload', (tester) async {
      final items = [
        {
          'id': 'a1',
          'mailbox': 'approvals',
          'data': {
            'title': 'PO Approval #1',
            'type': 'purchase_order',
            'requestedBy': 'Priya S',
            'status': 'pending',
          },
          'updated_at': '2026-06-20T10:00:00Z',
          'etag': null,
          'sync_state': 'synced',
        }
      ];

      when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => items);
      when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
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
            etag: any(named: 'etag'),
          )).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      // Tap the card to open the action bottom sheet.
      await tester.tap(find.text('PO Approval #1'));
      await tester.pumpAndSettle();

      // Tap Approve.
      await tester.tap(find.text('Approve'));
      await tester.pumpAndSettle();

      // Verify enqueueOutbox was called with real payload.
      final captured = verify(() => mockDb.enqueueOutbox(
            mailbox: captureAny(named: 'mailbox'),
            operation: captureAny(named: 'operation'),
            entityId: captureAny(named: 'entityId'),
            payload: captureAny(named: 'payload'),
          )).captured;

      expect(captured[0], 'approvals');
      expect(captured[1], 'approved');
      expect(captured[2], 'a1');
      final payload = captured[3] as Map<String, dynamic>;
      expect(payload['decision'], 'approved');
      expect(payload['entityId'], 'a1');
    });
  });
}
