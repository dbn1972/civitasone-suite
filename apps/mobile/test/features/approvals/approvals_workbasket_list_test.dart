import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/core/widgets/status_pill.dart';
import 'package:civitasone_mobile/features/approvals/approvals_workbasket_list_screen.dart';

/// The status filter row shares label text ("Pending", "Completed", ...)
/// with the `StatusPill` a task card renders, so a plain `find.text(...)`
/// for a status word is ambiguous whenever both are on screen. Scope to the
/// pill specifically for those assertions (same convention as
/// `field_task_list_test.dart`).
Finder _statusPillText(String text) =>
    find.descendant(of: find.byType(StatusPill), matching: find.text(text));

class MockApiClient extends Mock implements ApiClient {}

class MockPkceAuthService extends Mock implements PkceAuthService {}

void main() {
  late MockApiClient mockApi;
  late MockPkceAuthService mockAuth;

  setUp(() {
    mockApi = MockApiClient();
    mockAuth = MockPkceAuthService();
    when(() => mockAuth.accessToken()).thenAnswer((_) async => 'test-token');
  });

  setUpAll(() {
    registerFallbackValue(Uri());
  });

  Widget buildSubject() {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockApi),
        authProvider.overrideWithValue(mockAuth),
      ],
      child: const MaterialApp(home: ApprovalsWorkbasketListScreen()),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  /// `scrollUntilVisible`'s `scrollable` argument must resolve to an actual
  /// `Scrollable` (it's cast internally), not merely a widget that contains
  /// one -- so this targets the `Scrollable` the keyed `ListView` builds
  /// internally, scoped to that list specifically. The screen has two other
  /// (horizontal, chip-row) Scrollables too, so an unscoped
  /// `find.byType(Scrollable)` would be ambiguous.
  Finder tasksScrollable() => find.descendant(
        of: find.byKey(const Key('approvalsTasksList')),
        matching: find.byType(Scrollable),
      );

  /// The "Load more" footer sits after 100 task cards inside a lazy
  /// `ListView.builder` -- it isn't built at all (not just scrolled past)
  /// until the list is actually scrolled down to it.
  Future<void> scrollToLoadMore(WidgetTester tester) async {
    await tester.scrollUntilVisible(
      find.text('Load more'),
      700.0,
      scrollable: tasksScrollable(),
    );
    await pumpUntilSettled(tester);
  }

  Response<Map<String, dynamic>> _workbasketsResponse(List<Map<String, dynamic>> baskets) {
    return Response(
      data: {'data': baskets, 'meta': {'total': baskets.length}},
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/workflow/workbaskets'),
    );
  }

  Response<Map<String, dynamic>> _tasksResponse(List<Map<String, dynamic>> tasks) {
    return Response(
      data: {'data': tasks, 'meta': {'total': tasks.length}},
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/workflow/workbaskets/w/tasks'),
    );
  }

  Map<String, dynamic> _workbasket(
    String code,
    String name, {
    Map<String, dynamic>? filter,
  }) =>
      {
        'id': 'wb-$code',
        'tenantId': 't1',
        'code': code,
        'name': name,
        'description': null,
        'filter': filter ?? <String, dynamic>{},
        'sortOrder': 'created_at',
        'createdAt': '2026-09-01T08:00:00.000Z',
        'updatedAt': '2026-09-01T08:00:00.000Z',
      };

  Map<String, dynamic> _task(
    String id, {
    String name = 'Approve leave request',
    String status = 'pending',
    String? refType = 'leave_app',
    String? roleRef = 'hr_admin',
    String? dueAt,
    int escalationCount = 0,
  }) =>
      {
        'id': id,
        'tenantId': 't1',
        'instanceId': 'inst-$id',
        'name': name,
        'status': status,
        'roleRef': roleRef,
        'nodeKey': 'node-1',
        'refType': refType,
        'refId': 'ref-$id',
        'decision': null,
        'assigneeId': null,
        'dueAt': dueAt,
        'escalationCount': escalationCount,
        'createdAt': '2026-09-10T08:00:00.000Z',
        'updatedAt': '2026-09-10T08:00:00.000Z',
        'version': 1,
      };

  /// Registers the workbaskets-list stub.
  void stubWorkbaskets(List<Map<String, dynamic>> baskets) {
    when(() => mockApi.get<Map<String, dynamic>>('/v1/workflow/workbaskets'))
        .thenAnswer((_) async => _workbasketsResponse(baskets));
  }

  /// Registers the per-workbasket tasks stub. [tasksByCode] maps a
  /// workbasket code to the tasks it should return; [limitToTasks], if
  /// given, overrides what's returned for a specific requested `limit` on a
  /// specific code (used for the load-more test, where the same code is
  /// fetched twice with two different limits).
  void stubTasks(
    Map<String, List<Map<String, dynamic>>> tasksByCode, {
    Map<String, Map<int, List<Map<String, dynamic>>>>? limitOverridesByCode,
  }) {
    when(() => mockApi.get<Map<String, dynamic>>(
          any(that: startsWith('/v1/workflow/workbaskets/')),
          params: any(named: 'params'),
        )).thenAnswer((invocation) async {
      final path = invocation.positionalArguments[0] as String;
      final params = invocation.namedArguments[#params] as Map<String, dynamic>?;
      final limit = params?['limit'] as int? ?? 100;
      final code = tasksByCode.keys.firstWhere(
        (c) => path.contains('/v1/workflow/workbaskets/$c/tasks'),
        orElse: () => '',
      );
      final override = limitOverridesByCode?[code]?[limit];
      return _tasksResponse(override ?? tasksByCode[code] ?? []);
    });
  }

  group('ApprovalsWorkbasketListScreen -- workbaskets load', () {
    testWidgets('shows loading spinner initially', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>('/v1/workflow/workbaskets'))
          .thenAnswer((_) async {
        await Future.delayed(const Duration(seconds: 2));
        return _workbasketsResponse([]);
      });

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      await pumpUntilSettled(tester);
    });

    testWidgets('shows error state with retry when workbaskets fetch fails', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>('/v1/workflow/workbaskets')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/workflow/workbaskets'),
          type: DioExceptionType.connectionTimeout,
        ),
      );

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load approvals'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('403 renders a permission-denied message, not raw error text', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>('/v1/workflow/workbaskets')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/workflow/workbaskets'),
          type: DioExceptionType.badResponse,
          response: Response(statusCode: 403, requestOptions: RequestOptions(path: '/v1/workflow/workbaskets')),
        ),
      );

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('do not have permission'), findsOneWidget);
    });

    testWidgets('shows offline banner on a connection error', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>('/v1/workflow/workbaskets')).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/workflow/workbaskets'),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Offline'), findsOneWidget);
    });

    testWidgets('empty workbasket list shows the "no workbaskets" empty state', (tester) async {
      stubWorkbaskets([]);

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No approval workbaskets yet'), findsOneWidget);
    });
  });

  group('ApprovalsWorkbasketListScreen -- tasks for the selected workbasket', () {
    testWidgets('auto-selects the first workbasket and renders its tasks', (tester) async {
      stubWorkbaskets([
        _workbasket('pending-leave', 'Pending Leave Approvals',
            filter: {'status': ['pending'], 'roleRef': 'hr_admin'}),
        _workbasket('escalated-po', 'Escalated Purchase Orders'),
      ]);
      stubTasks({
        'pending-leave': [_task('t1', name: 'Approve leave for R. Sharma')],
        'escalated-po': [_task('t2', name: 'Approve PO 4021', refType: 'procurement_po')],
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Pending Leave Approvals'), findsOneWidget);
      expect(find.text('Escalated Purchase Orders'), findsOneWidget);
      expect(find.text('Approve leave for R. Sharma'), findsOneWidget);
      expect(_statusPillText('Pending'), findsOneWidget);
      expect(find.text('Leave Application'), findsOneWidget);
      // Second workbasket's tasks aren't fetched until selected.
      expect(find.text('Approve PO 4021'), findsNothing);
    });

    testWidgets('shows the saved filter summary for the selected workbasket', (tester) async {
      stubWorkbaskets([
        _workbasket('pending-leave', 'Pending Leave Approvals',
            filter: {'status': ['pending', 'escalated'], 'roleRef': 'hr_admin'}),
      ]);
      stubTasks({'pending-leave': []});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Status: pending, escalated'), findsOneWidget);
      expect(find.textContaining('Role: hr_admin'), findsOneWidget);
    });

    testWidgets('a workbasket with no saved filter says so honestly', (tester) async {
      stubWorkbaskets([_workbasket('all-tasks', 'Everything')]);
      stubTasks({'all-tasks': []});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No filter criteria (all tasks)'), findsOneWidget);
    });

    testWidgets('empty workbasket shows the "no tasks" empty state', (tester) async {
      stubWorkbaskets([_workbasket('empty-basket', 'Nothing Here')]);
      stubTasks({'empty-basket': []});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No tasks in this workbasket'), findsOneWidget);
    });

    testWidgets('tasks-fetch failure for a valid workbasket shows its own error + retry', (tester) async {
      stubWorkbaskets([_workbasket('pending-leave', 'Pending Leave Approvals')]);
      when(() => mockApi.get<Map<String, dynamic>>(
            any(that: startsWith('/v1/workflow/workbaskets/')),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/workflow/workbaskets/pending-leave/tasks'),
        type: DioExceptionType.connectionTimeout,
      ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load approvals'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('switching workbaskets refetches tasks for the newly selected code', (tester) async {
      stubWorkbaskets([
        _workbasket('pending-leave', 'Pending Leave Approvals'),
        _workbasket('escalated-po', 'Escalated Purchase Orders'),
      ]);
      stubTasks({
        'pending-leave': [_task('t1', name: 'Approve leave for R. Sharma')],
        'escalated-po': [_task('t2', name: 'Approve PO 4021', refType: 'procurement_po')],
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);
      expect(find.text('Approve leave for R. Sharma'), findsOneWidget);

      await tester.tap(find.text('Escalated Purchase Orders'));
      await pumpUntilSettled(tester);

      expect(find.text('Approve PO 4021'), findsOneWidget);
      expect(find.text('Approve leave for R. Sharma'), findsNothing);
    });
  });

  group('ApprovalsWorkbasketListScreen -- client-side status filter and search', () {
    testWidgets('status chip narrows the visible list', (tester) async {
      stubWorkbaskets([_workbasket('mixed', 'Mixed Queue')]);
      stubTasks({
        'mixed': [
          _task('t1', name: 'Pending one', status: 'pending'),
          _task('t2', name: 'Escalated one', status: 'escalated'),
        ],
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Pending one'), findsOneWidget);
      expect(find.text('Escalated one'), findsOneWidget);

      // Not find.text('Escalated'): that word is ambiguous here -- it's both
      // the status filter chip's label and the text a StatusPill renders on
      // the second task's card. The chip has its own key for exactly this.
      await tester.tap(find.byKey(const ValueKey('statusChip_escalated')));
      await pumpUntilSettled(tester);

      expect(find.text('Pending one'), findsNothing);
      expect(find.text('Escalated one'), findsOneWidget);
    });

    testWidgets('search narrows the visible list by name', (tester) async {
      stubWorkbaskets([_workbasket('mixed', 'Mixed Queue')]);
      stubTasks({
        'mixed': [
          _task('t1', name: 'Approve leave for R. Sharma'),
          _task('t2', name: 'Approve PO 4021', refType: 'procurement_po'),
        ],
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.enterText(find.byType(TextField), 'sharma');
      await pumpUntilSettled(tester);

      expect(find.text('Approve leave for R. Sharma'), findsOneWidget);
      expect(find.text('Approve PO 4021'), findsNothing);
    });

    testWidgets('no matches shows the search empty state', (tester) async {
      stubWorkbaskets([_workbasket('mixed', 'Mixed Queue')]);
      stubTasks({'mixed': [_task('t1', name: 'Approve leave for R. Sharma')]});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.enterText(find.byType(TextField), 'zzz-no-match');
      await pumpUntilSettled(tester);

      expect(find.text('No matches'), findsOneWidget);
    });
  });

  group('ApprovalsWorkbasketListScreen -- honest pagination (no fabricated total)', () {
    testWidgets('"Load more" appears when a full page comes back, and never claims a total', (tester) async {
      final fullPage = List.generate(100, (i) => _task('t$i', name: 'Task $i'));
      stubWorkbaskets([_workbasket('big', 'Big Queue')]);
      stubTasks({'big': fullPage});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);
      await scrollToLoadMore(tester);

      expect(find.text('Load more'), findsOneWidget);
      expect(find.text('100 loaded'), findsOneWidget);
      // Never a "Showing X of Y" claim -- neither workbasket endpoint has a
      // true total (see approvals_models.dart's doc comment).
      expect(find.textContaining('Showing'), findsNothing);
      expect(find.textContaining(' of '), findsNothing);
    });

    testWidgets('tapping "Load more" re-fetches with a bigger limit', (tester) async {
      final page100 = List.generate(100, (i) => _task('t$i', name: 'Task $i'));
      // A genuinely full 200-item second page (not e.g. 130): the footer's
      // own "might be more" heuristic is `returned == requested`, so this
      // fixture must actually satisfy that to keep the footer around and
      // prove the bumped-limit re-fetch really happened, rather than
      // (correctly, but untestably here) hiding the footer as "reached the
      // end".
      final page200 = List.generate(200, (i) => _task('u$i', name: 'Bigger $i'));
      stubWorkbaskets([_workbasket('big', 'Big Queue')]);
      stubTasks(
        {'big': page100},
        limitOverridesByCode: {
          'big': {100: page100, 200: page200},
        },
      );

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);
      await scrollToLoadMore(tester);
      expect(find.text('Load more'), findsOneWidget);

      await tester.tap(find.text('Load more'));
      await pumpUntilSettled(tester);

      // The list is now taller (200 items + footer vs. 100 + footer), but
      // the ScrollPosition kept its previous pixel offset across the
      // rebuild -- that offset no longer reaches the footer's new, further
      // -away position, so it must be scrolled to again, not just found.
      await scrollToLoadMore(tester);
      // Still shows a footer (still a full page for the new, bigger limit)
      // -- but now counting the new 200-item page, not the stale 100.
      expect(find.text('200 loaded'), findsOneWidget);
      // The new page replaced the old one from scratch (no offset support on
      // this endpoint) -- scroll back up to confirm its first item is really
      // the bigger page's data, not just a bumped count on stale rows.
      await tester.scrollUntilVisible(
        find.text('Bigger 0'),
        -700.0,
        scrollable: tasksScrollable(),
      );
      expect(find.text('Bigger 0'), findsOneWidget);
    });

    testWidgets('"Load more" is hidden while a status filter is active', (tester) async {
      final fullPage = List.generate(100, (i) => _task('t$i', name: 'Task $i', status: 'pending'));
      stubWorkbaskets([_workbasket('big', 'Big Queue')]);
      stubTasks({'big': fullPage});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);
      await scrollToLoadMore(tester);
      expect(find.text('Load more'), findsOneWidget);

      // Not find.text('Pending'): every one of the 100 cards' StatusPill
      // also reads "Pending" here. The chip's key disambiguates.
      await tester.tap(find.byKey(const ValueKey('statusChip_pending')));
      await pumpUntilSettled(tester);

      expect(find.text('Load more'), findsNothing);
    });

    testWidgets('a short page (fewer than the limit) never offers "Load more"', (tester) async {
      stubWorkbaskets([_workbasket('small', 'Small Queue')]);
      stubTasks({'small': [_task('t1'), _task('t2')]});

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Load more'), findsNothing);
    });
  });

  group('ApprovalsWorkbasketListScreen -- overdue and defensive parsing', () {
    testWidgets('a task past its due date shows "Overdue"', (tester) async {
      stubWorkbaskets([_workbasket('mixed', 'Mixed Queue')]);
      stubTasks({
        'mixed': [_task('t1', dueAt: '2020-01-01T00:00:00.000Z')],
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Overdue'), findsOneWidget);
    });

    testWidgets('a completed task past its due date is not shown as overdue', (tester) async {
      stubWorkbaskets([_workbasket('mixed', 'Mixed Queue')]);
      stubTasks({
        'mixed': [_task('t1', status: 'completed', dueAt: '2020-01-01T00:00:00.000Z')],
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Overdue'), findsNothing);
    });

    testWidgets('a task with a null id does not crash the list', (tester) async {
      stubWorkbaskets([_workbasket('mixed', 'Mixed Queue')]);
      stubTasks({
        'mixed': [
          {
            'id': null,
            'tenantId': 't1',
            'instanceId': 'inst-1',
            'name': null,
            'status': 'bogus-future-status',
            'refType': null,
            'assigneeId': null,
            'dueAt': null,
            'escalationCount': null,
            'createdAt': null,
            'updatedAt': null,
            'version': null,
          },
        ],
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Untitled task'), findsOneWidget);
      expect(_statusPillText('Unknown'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
