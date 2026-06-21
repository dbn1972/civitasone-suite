@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/helpdesk/tickets_screen.dart';
import 'package:civitasone_mobile/features/helpdesk/ticket_create_screen.dart';

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

  Widget _wrap(Widget child) => ProviderScope(
        overrides: [
          dbProvider.overrideWith((_) => Future.value(mockDb)),
          syncEngineProvider.overrideWithValue(mockEngine),
        ],
        child: MaterialApp(
          theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF6366F1)),
          home: child,
        ),
      );

  testWidgets('tickets screen — populated state golden', (tester) async {
    when(() => mockDb.listEntities('helpdesk_tickets')).thenAnswer((_) async => [
          {
            'id': 't1',
            'mailbox': 'helpdesk_tickets',
            'data': {
              'ticketNo': 'TKT-001',
              'subject': 'Internet not working in Block B',
              'status': 'open',
              'priority': 'high',
              'category': 'it_support',
            },
            'updated_at': '2026-06-20T10:00:00Z',
            'etag': null,
            'sync_state': 'synced',
          },
          {
            'id': 't2',
            'mailbox': 'helpdesk_tickets',
            'data': {
              'ticketNo': 'TKT-002',
              'subject': 'Printer driver installation needed',
              'status': 'closed',
              'priority': 'low',
              'category': 'it_support',
            },
            'updated_at': '2026-06-19T16:00:00Z',
            'etag': null,
            'sync_state': 'synced',
          },
        ]);

    await tester.pumpWidget(_wrap(const TicketsScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(TicketsScreen),
      matchesGoldenFile('goldens/tickets_populated.png'),
    );
  });

  testWidgets('ticket create screen — form golden', (tester) async {
    await tester.pumpWidget(_wrap(const TicketCreateScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(TicketCreateScreen),
      matchesGoldenFile('goldens/ticket_create_form.png'),
    );
  });
}
