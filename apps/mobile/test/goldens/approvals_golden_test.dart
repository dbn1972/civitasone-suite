@Tags(['golden'])
library;

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

  testWidgets('approvals screen — populated state golden', (tester) async {
    when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => [
          {
            'id': 'a1',
            'mailbox': 'approvals',
            'data': {
              'title': 'Purchase Order #PO-2026-042',
              'type': 'purchase_order',
              'requestedBy': 'Priya Sharma',
              'status': 'pending',
              'amount': 125000,
            },
            'updated_at': '2026-06-20T09:00:00Z',
            'etag': null,
            'sync_state': 'synced',
          },
          {
            'id': 'a2',
            'mailbox': 'approvals',
            'data': {
              'title': 'Leave Request — Ram Kumar',
              'type': 'leave',
              'requestedBy': 'Ram Kumar',
              'status': 'approved',
            },
            'updated_at': '2026-06-20T08:30:00Z',
            'etag': null,
            'sync_state': 'synced',
          },
        ]);

    await tester.pumpWidget(_wrap(const ApprovalsScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(ApprovalsScreen),
      matchesGoldenFile('goldens/approvals_populated.png'),
    );
  });

  testWidgets('approvals screen — empty state golden', (tester) async {
    when(() => mockDb.listEntities('approvals')).thenAnswer((_) async => []);

    await tester.pumpWidget(_wrap(const ApprovalsScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(ApprovalsScreen),
      matchesGoldenFile('goldens/approvals_empty.png'),
    );
  });
}
