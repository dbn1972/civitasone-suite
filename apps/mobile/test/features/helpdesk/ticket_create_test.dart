import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/helpdesk/ticket_create_screen.dart';

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
      child: const MaterialApp(home: TicketCreateScreen()),
    );
  }

  group('TicketCreateScreen', () {
    testWidgets('renders all required form fields', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('New Ticket'), findsOneWidget);
      expect(find.text('Subject *'), findsOneWidget);
      expect(find.text('Category *'), findsOneWidget);
      expect(find.text('Priority *'), findsOneWidget);
      expect(find.text('Description *'), findsOneWidget);
      expect(find.text('Create Ticket'), findsOneWidget);
    });

    testWidgets('shows validation error when subject is empty', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Create Ticket'));
      await tester.pumpAndSettle();

      expect(find.text('Subject is required'), findsOneWidget);
    });

    testWidgets('shows validation error when description is too short', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Subject *'),
        'Network issue',
      );
      // Description too short.
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Description *'),
        'Short',
      );
      await tester.tap(find.text('Create Ticket'));
      await tester.pumpAndSettle();

      expect(find.text('Please provide at least 10 characters'), findsOneWidget);
    });

    testWidgets('enqueues outbox with real payload on valid form', (tester) async {
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
      when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Subject *'),
        'Internet down in block B',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Description *'),
        'All workstations in Block B cannot access the internet since 9 AM.',
      );

      await tester.tap(find.text('Create Ticket'));
      await tester.pumpAndSettle();

      // Verify enqueueOutbox called with correct mailbox and operation.
      final captured = verify(() => mockDb.enqueueOutbox(
            mailbox: captureAny(named: 'mailbox'),
            operation: captureAny(named: 'operation'),
            entityId: captureAny(named: 'entityId'),
            payload: captureAny(named: 'payload'),
          )).captured;

      expect(captured[0], 'helpdesk_tickets');
      expect(captured[1], 'create');

      final payload = captured[3] as Map<String, dynamic>;
      expect(payload['subject'], 'Internet down in block B');
      expect(payload['status'], 'open');
      expect(payload['priority'], isA<String>());
      // Payload is real — not empty.
      expect((payload as Map).isEmpty, false);
    });

    testWidgets('priority defaults to medium', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Medium'), findsOneWidget);
    });
  });
}
