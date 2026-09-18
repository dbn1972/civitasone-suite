import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/core/widgets/status_pill.dart';
import 'package:civitasone_mobile/features/field/field_task_list_screen.dart';
import 'package:civitasone_mobile/features/field/field_task_models.dart';

/// The status filter row is always visible and shares label text
/// ("Assigned", "Completed", ...) with the `StatusPill` a task card renders,
/// so a plain `find.text(...)` for a status word is ambiguous whenever both
/// are on screen. Scope to the pill specifically for those assertions.
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
      child: const MaterialApp(home: FieldTaskListScreen()),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Response<Map<String, dynamic>> _buildResponse(
    List<Map<String, dynamic>> tasks, {
    Map<String, dynamic>? meta,
  }) {
    return Response(
      data: {
        'data': tasks,
        if (meta != null) 'meta': meta,
      },
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/field/tasks'),
    );
  }

  final sampleTask = {
    'id': 'task-1',
    'tenantId': 't1',
    'assigneeId': 'agent-7',
    'taskType': 'meter-reading',
    'title': 'Read water meter at Ward 5',
    'description': 'Check for tampering',
    'status': 'assigned',
    'priority': 2,
    'latitude': '12.9716000',
    'longitude': '77.5946000',
    'address': '12 MG Road',
    'dueDate': '2026-09-20T10:00:00.000Z',
    'completedAt': null,
    'cancelledAt': null,
    'createdAt': '2026-09-15T08:00:00.000Z',
    'updatedAt': '2026-09-15T08:00:00.000Z',
    'version': 1,
  };

  group('FieldTaskListScreen', () {
    testWidgets('shows loading spinner initially', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async {
        await Future.delayed(const Duration(seconds: 2));
        return _buildResponse([]);
      });

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      await pumpUntilSettled(tester);
    });

    testWidgets('shows error state with retry button on API failure', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/field/tasks'),
        type: DioExceptionType.connectionTimeout,
      ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load field tasks'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('403 renders a permission-denied message, not raw error text', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/field/tasks'),
        type: DioExceptionType.badResponse,
        response: Response(
          statusCode: 403,
          requestOptions: RequestOptions(path: '/v1/field/tasks'),
        ),
      ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('do not have permission'), findsOneWidget);
    });

    testWidgets('retry button triggers re-fetch', (tester) async {
      int callCount = 0;
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async {
        callCount++;
        if (callCount == 1) {
          throw DioException(
            requestOptions: RequestOptions(path: '/v1/field/tasks'),
            type: DioExceptionType.connectionTimeout,
          );
        }
        return _buildResponse([]);
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Retry'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await pumpUntilSettled(tester);

      expect(callCount, 2);
    });

    testWidgets('shows empty state when no tasks', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No field tasks found'), findsOneWidget);
    });

    testWidgets('renders task cards with title, task type, and status', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleTask]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Read water meter at Ward 5'), findsOneWidget);
      expect(find.text('meter-reading'), findsOneWidget);
      expect(_statusPillText('Assigned'), findsOneWidget);
      expect(find.text('P2'), findsOneWidget);
    });

    testWidgets('a task with no due date shows no due/overdue text', (tester) async {
      final noDue = Map<String, dynamic>.from(sampleTask)..['dueDate'] = null;
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([noDue]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Due'), findsNothing);
      expect(find.text('Overdue'), findsNothing);
    });

    testWidgets('an overdue open task shows "Overdue" on its card', (tester) async {
      final overdue = Map<String, dynamic>.from(sampleTask)
        ..['dueDate'] = '2020-01-01T00:00:00.000Z'
        ..['status'] = 'in_progress';
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([overdue]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Overdue'), findsOneWidget);
    });

    testWidgets('a completed task past its due date is not flagged overdue', (tester) async {
      final done = Map<String, dynamic>.from(sampleTask)
        ..['dueDate'] = '2020-01-01T00:00:00.000Z'
        ..['status'] = 'completed'
        ..['completedAt'] = '2020-01-02T00:00:00.000Z';
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([done]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Overdue'), findsNothing);
    });

    testWidgets('search filters the list by title', (tester) async {
      final other = Map<String, dynamic>.from(sampleTask)
        ..['id'] = 'task-2'
        ..['title'] = 'Inspect transformer at Sector 9';
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleTask, other]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Read water meter at Ward 5'), findsOneWidget);
      expect(find.text('Inspect transformer at Sector 9'), findsOneWidget);

      await tester.enterText(find.byType(TextField).last, 'transformer');
      await pumpUntilSettled(tester);

      expect(find.text('Read water meter at Ward 5'), findsNothing);
      expect(find.text('Inspect transformer at Sector 9'), findsOneWidget);
    });

    testWidgets('has RefreshIndicator for pull-to-refresh', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleTask]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(RefreshIndicator), findsOneWidget);
    });

    testWidgets('refresh icon button has tooltip for accessibility', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byTooltip('Refresh'), findsOneWidget);
      expect(find.byTooltip('Filters'), findsOneWidget);
    });

    // ── Defensive model parsing ─────────────────────────────────────────────

    testWidgets('a task with a null id does not crash the list', (tester) async {
      final noId = Map<String, dynamic>.from(sampleTask)..['id'] = null;
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([noId]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Read water meter at Ward 5'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an unrecognized status renders "Unknown", not "Unassigned"', (tester) async {
      final weird = Map<String, dynamic>.from(sampleTask)..['status'] = 'some_future_status';
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([weird]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(_statusPillText('Unknown'), findsOneWidget);
      expect(_statusPillText('Unassigned'), findsNothing);
    });

    testWidgets('a missing status renders "Unknown", not "Unassigned"', (tester) async {
      final noStatus = Map<String, dynamic>.from(sampleTask)..remove('status');
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([noStatus]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(_statusPillText('Unknown'), findsOneWidget);
      expect(_statusPillText('Unassigned'), findsNothing);
    });

    // ── Pagination ───────────────────────────────────────────────────────────

    testWidgets('initial fetch requests limit and an explicit offset of 0, no filters',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleTask]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      final captured = verify(() => mockApi.get<Map<String, dynamic>>(
            '/v1/field/tasks',
            params: captureAny(named: 'params'),
          )).captured;
      expect(captured.single, {'limit': 100, 'offset': 0});
    });

    testWidgets(
        'shows "Showing X of Y" and a Load more button when meta.total exceeds the loaded count',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse(
            [sampleTask],
            meta: {'page': 1, 'pageSize': 1, 'total': 2},
          ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Showing 1 of 2'), findsOneWidget);
      expect(find.text('Load more'), findsOneWidget);
    });

    testWidgets('no pagination footer when meta is absent (backwards compatible) or fully loaded',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleTask]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Showing'), findsNothing);
      expect(find.text('Load more'), findsNothing);
    });

    testWidgets('Load more requests the next page by offset and appends results', (tester) async {
      final second = Map<String, dynamic>.from(sampleTask)
        ..['id'] = 'task-2'
        ..['title'] = 'Inspect transformer at Sector 9';

      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((invocation) async {
        final params = invocation.namedArguments[#params] as Map<String, dynamic>?;
        final offset = params?['offset'] as int? ?? 0;
        if (offset == 0) {
          return _buildResponse([sampleTask], meta: {'page': 1, 'pageSize': 1, 'total': 2});
        }
        expect(offset, 1, reason: 'offset should equal the number already loaded');
        return _buildResponse([second], meta: {'page': 2, 'pageSize': 1, 'total': 2});
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Read water meter at Ward 5'), findsOneWidget);
      expect(find.text('Inspect transformer at Sector 9'), findsNothing);

      await tester.tap(find.text('Load more'));
      await pumpUntilSettled(tester);

      expect(find.text('Inspect transformer at Sector 9'), findsOneWidget);
      // Fully loaded now (2 of 2) -- footer/button withdrawn, not stuck at "2 of 2".
      expect(find.text('Load more'), findsNothing);
      expect(find.textContaining('Showing'), findsNothing);
    });

    // ── Server-side filters (status / assignee / due date) ─────────────────

    testWidgets('tapping a status chip re-fetches with that status in params', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.tap(find.text('In Progress'));
      await pumpUntilSettled(tester);

      final captured = verify(() => mockApi.get<Map<String, dynamic>>(
            '/v1/field/tasks',
            params: captureAny(named: 'params'),
          )).captured;
      expect(captured.last, {'limit': 100, 'offset': 0, 'status': 'in_progress'});
    });

    testWidgets('tapping All after a status filter clears it from params', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.tap(find.text('Completed'));
      await pumpUntilSettled(tester);
      await tester.tap(find.text('All'));
      await pumpUntilSettled(tester);

      final captured = verify(() => mockApi.get<Map<String, dynamic>>(
            '/v1/field/tasks',
            params: captureAny(named: 'params'),
          )).captured;
      expect(captured.last, {'limit': 100, 'offset': 0});
    });

    testWidgets('entering an assignee id and applying re-fetches with assigneeId param',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.tap(find.byTooltip('Filters'));
      await pumpUntilSettled(tester);
      await tester.enterText(find.byKey(const Key('fieldTaskAssigneeFilter')), 'agent-42');
      await tester.tap(find.text('Apply'));
      await pumpUntilSettled(tester);

      final captured = verify(() => mockApi.get<Map<String, dynamic>>(
            '/v1/field/tasks',
            params: captureAny(named: 'params'),
          )).captured;
      expect(captured.last, {'limit': 100, 'offset': 0, 'assigneeId': 'agent-42'});
    });

    testWidgets('Clear resets the assignee filter and re-fetches without it', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.tap(find.byTooltip('Filters'));
      await pumpUntilSettled(tester);
      await tester.enterText(find.byKey(const Key('fieldTaskAssigneeFilter')), 'agent-42');
      await tester.tap(find.text('Apply'));
      await pumpUntilSettled(tester);
      await tester.tap(find.text('Clear'));
      await pumpUntilSettled(tester);

      final captured = verify(() => mockApi.get<Map<String, dynamic>>(
            '/v1/field/tasks',
            params: captureAny(named: 'params'),
          )).captured;
      expect(captured.last, {'limit': 100, 'offset': 0});
    });
  });

  group('buildFieldTaskQueryParams', () {
    test('omits every optional filter when unset', () {
      expect(
        buildFieldTaskQueryParams(limit: 20, offset: 0),
        {'limit': 20, 'offset': 0},
      );
    });

    test('includes the status wire value, not the Dart enum name', () {
      expect(
        buildFieldTaskQueryParams(limit: 20, offset: 0, status: FieldTaskStatus.inProgress),
        {'limit': 20, 'offset': 0, 'status': 'in_progress'},
      );
    });

    test('trims assigneeId and omits it when blank', () {
      expect(
        buildFieldTaskQueryParams(limit: 20, offset: 0, assigneeId: '  agent-9  '),
        {'limit': 20, 'offset': 0, 'assigneeId': 'agent-9'},
      );
      expect(
        buildFieldTaskQueryParams(limit: 20, offset: 0, assigneeId: '   '),
        {'limit': 20, 'offset': 0},
      );
    });

    test('dueAfter becomes the start of that UTC day', () {
      final params = buildFieldTaskQueryParams(
        limit: 20,
        offset: 0,
        dueAfter: DateTime(2026, 9, 20, 15, 30),
      );
      expect(params['dueAfter'], '2026-09-20T00:00:00.000Z');
    });

    test('dueBefore becomes the end of that UTC day, inclusive of the whole day', () {
      final params = buildFieldTaskQueryParams(
        limit: 20,
        offset: 0,
        dueBefore: DateTime(2026, 9, 20, 8, 0),
      );
      expect(params['dueBefore'], '2026-09-20T23:59:59.000Z');
    });

    test('combines status, assignee, and both due-date bounds together', () {
      final params = buildFieldTaskQueryParams(
        limit: 50,
        offset: 100,
        status: FieldTaskStatus.unassigned,
        assigneeId: 'agent-1',
        dueAfter: DateTime(2026, 1, 1),
        dueBefore: DateTime(2026, 1, 31),
      );
      expect(params, {
        'limit': 50,
        'offset': 100,
        'status': 'unassigned',
        'assigneeId': 'agent-1',
        'dueAfter': '2026-01-01T00:00:00.000Z',
        'dueBefore': '2026-01-31T23:59:59.000Z',
      });
    });
  });
}
