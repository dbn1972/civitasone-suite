@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/hr/leave_screen.dart';
import 'package:civitasone_mobile/features/hr/leave_apply_screen.dart';

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

  testWidgets('leave screen — populated state golden', (tester) async {
    when(() => mockDb.listEntities('leave_requests')).thenAnswer((_) async => [
          {
            'id': 'l1',
            'mailbox': 'leave_requests',
            'data': {
              'employeeName': 'Anil Mehta',
              'leaveType': 'casual',
              'fromDate': '2026-06-25',
              'toDate': '2026-06-27',
              'days': 3,
              'reason': 'Family function',
              'status': 'pending',
            },
            'updated_at': '2026-06-20T10:00:00Z',
            'etag': null,
            'sync_state': 'synced',
          },
          {
            'id': 'l2',
            'mailbox': 'leave_requests',
            'data': {
              'employeeName': 'Kavya R',
              'leaveType': 'sick',
              'fromDate': '2026-06-23',
              'toDate': '2026-06-24',
              'days': 2,
              'reason': 'Medical leave',
              'status': 'approved',
            },
            'updated_at': '2026-06-19T14:00:00Z',
            'etag': null,
            'sync_state': 'synced',
          },
        ]);

    await tester.pumpWidget(_wrap(const LeaveScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(LeaveScreen),
      matchesGoldenFile('goldens/leave_populated.png'),
    );
  });

  testWidgets('leave apply screen — form golden', (tester) async {
    await tester.pumpWidget(_wrap(const LeaveApplyScreen()));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(LeaveApplyScreen),
      matchesGoldenFile('goldens/leave_apply_form.png'),
    );
  });
}
