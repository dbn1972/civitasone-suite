import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/features/workflow/my_tasks_screen.dart';

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
      child: const MaterialApp(
        home: MyTasksScreen(),
      ),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  // COMP-008 mytasks-cleanup — `pagination` mirrors the real
  // `/v1/workflow/tasks` response shape (`{data, pagination: {hasMore,
  // pageSize, cursor?}}` — see queries.listTasks); deliberately no `total`
  // key, since the real endpoint never sends one.
  Response<Map<String, dynamic>> _buildResponse(
    List<Map<String, dynamic>> tasks, {
    Map<String, dynamic>? pagination,
  }) {
    return Response(
      data: {
        'data': tasks,
        if (pagination != null) 'pagination': pagination,
      },
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/workflow/tasks'),
    );
  }

  group('MyTasksScreen', () {
    testWidgets('shows loading spinner initially', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async {
        await Future.delayed(const Duration(seconds: 5));
        return _buildResponse([]);
      });

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Drain the mocked response delay so no timer outlives the tree.
      await tester.pump(const Duration(seconds: 6));

      await pumpUntilSettled(tester);
    });

    testWidgets('shows error state with retry button on API failure',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/workflow/tasks'),
        type: DioExceptionType.connectionTimeout,
      ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load tasks'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
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
            requestOptions: RequestOptions(path: '/v1/workflow/tasks'),
            type: DioExceptionType.connectionTimeout,
          );
        }
        return _buildResponse([]);
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

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

      expect(find.text('No tasks'), findsOneWidget);
      expect(find.text('No pending tasks matching this filter'), findsOneWidget);
      expect(find.byIcon(Icons.task_alt), findsOneWidget);
    });

    testWidgets('renders task card with real name and due date (dueAt, not dueDate)',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Review Budget Proposal',
              // Real wire field is dueAt (ISO datetime), not dueDate.
              'dueAt': '2024-12-31T00:00:00.000Z',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Review Budget Proposal'), findsOneWidget);
      expect(find.textContaining('31/12/2024'), findsOneWidget);
    });

    testWidgets('a task with no dueAt shows no due-date row (not a crash)', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {'id': 'task-1', 'name': 'No due date task'},
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No due date task'), findsOneWidget);
      expect(find.textContaining('Due:'), findsNothing);
      expect(find.textContaining('Overdue:'), findsNothing);
    });

    testWidgets('shows a Complete action button and no Delegate button', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {'id': 'task-1', 'name': 'Review Doc'},
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Complete'), findsOneWidget);
      // COMP-008 mytasks-cleanup — the Delegate button posted to a route
      // that never existed (/v1/workflow/tasks/:id/delegate); removed
      // rather than left as a dead end.
      expect(find.text('Delegate'), findsNothing);
    });

    testWidgets('shows filter chips (All, Overdue, Due Today, Upcoming)',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('All (0)'), findsOneWidget);
      expect(find.text('Overdue (0)'), findsOneWidget);
      expect(find.text('Due Today (0)'), findsOneWidget);
      expect(find.text('Upcoming (0)'), findsOneWidget);
    });

    testWidgets('overdue tasks show red due date indicator', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Overdue Task',
              'dueAt': '2020-01-01T00:00:00.000Z', // clearly in the past
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Overdue:'), findsOneWidget);
    });

    testWidgets('filter chips filter the task list', (tester) async {
      final pastDate = '2020-01-01T00:00:00.000Z';
      final futureDate = '2099-12-31T00:00:00.000Z';

      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Overdue Task',
              'dueAt': pastDate,
            },
            {
              'id': 'task-2',
              'name': 'Future Task',
              'dueAt': futureDate,
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // All filter: both tasks visible
      expect(find.text('Overdue Task'), findsOneWidget);
      expect(find.text('Future Task'), findsOneWidget);

      // Chip labels carry a count badge, e.g. "Overdue (1)".
      expect(find.text('All (2)'), findsOneWidget);

      // Switch to Overdue filter
      await tester.tap(find.text('Overdue (1)'));
      await tester.pump();

      expect(find.text('Overdue Task'), findsOneWidget);
      expect(find.text('Future Task'), findsNothing);

      // Switch to Upcoming filter
      await tester.tap(find.text('Upcoming (1)'));
      await tester.pump();

      expect(find.text('Overdue Task'), findsNothing);
      expect(find.text('Future Task'), findsOneWidget);
    });

    testWidgets('has RefreshIndicator for pull-to-refresh', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {'id': 'task-1', 'name': 'Task'},
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(RefreshIndicator), findsOneWidget);
    });

    testWidgets('uses ListView.builder for task list', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {'id': 't-1', 'name': 'A'},
            {'id': 't-2', 'name': 'B'},
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('refresh button has tooltip', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      final iconButtons = tester.widgetList<IconButton>(find.byType(IconButton));
      final refreshBtn = iconButtons.firstWhere(
        (b) => b.tooltip == 'Refresh',
        orElse: () => throw TestFailure('Missing refresh tooltip'),
      );
      expect(refreshBtn.tooltip, 'Refresh');
    });

    testWidgets('complete button triggers dialog and API call', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {'id': 'task-1', 'name': 'Review Report'},
          ]));
      when(() => mockApi.post<dynamic>(
            any(),
            data: any(named: 'data'),
          )).thenAnswer((_) async => Response(
            data: {'data': {}},
            statusCode: 202,
            requestOptions: RequestOptions(path: ''),
          ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      await tester.tap(find.text('Complete'));
      await tester.pumpAndSettle();

      // Dialog should appear
      expect(find.text('Complete Task'), findsOneWidget);
      expect(find.textContaining('Review Report'), findsWidgets);

      // Confirm completion — scope to the dialog, the card behind it also has
      // a FilledButton labelled "Complete".
      await tester.tap(find.descendant(
        of: find.byType(AlertDialog),
        matching: find.widgetWithText(FilledButton, 'Complete'),
      ));
      await pumpUntilSettled(tester);

      verify(() => mockApi.post<dynamic>(
            '/v1/workflow/tasks/task-1/complete',
            data: any(named: 'data'),
          )).called(1);
    });

    // ── Pagination (COMP-008 mytasks-cleanup) ──────────────────────────────

    testWidgets('initial fetch requests an explicit limit and offset of 0', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      final captured = verify(() => mockApi.get<Map<String, dynamic>>(
            '/v1/workflow/tasks',
            params: captureAny(named: 'params'),
          )).captured;
      expect(captured.single, {
        'assignee': 'me',
        'status': 'pending',
        'limit': 50,
        'offset': 0,
      });
    });

    testWidgets('shows a Load more button when pagination.hasMore is true', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse(
            [
              {'id': 'task-1', 'name': 'Task 1'},
            ],
            pagination: {'hasMore': true, 'pageSize': 50},
          ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Load more'), findsOneWidget);
      expect(find.text('1 loaded'), findsOneWidget);
      // Honest footer — never a fabricated "of Y" total (the real endpoint
      // never returns one).
      expect(find.textContaining('of'), findsNothing);
    });

    testWidgets('no Load more button when hasMore is false or pagination is absent',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {'id': 'task-1', 'name': 'Task 1'},
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Load more'), findsNothing);
    });

    testWidgets('Load more requests the next page by offset and appends results',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((invocation) async {
        final params = invocation.namedArguments[#params] as Map<String, dynamic>?;
        final offset = params?['offset'] as int? ?? 0;
        if (offset == 0) {
          return _buildResponse(
            [
              {'id': 'task-1', 'name': 'First page task'},
            ],
            pagination: {'hasMore': true, 'pageSize': 50},
          );
        }
        expect(offset, 1, reason: 'offset should equal the number already loaded');
        return _buildResponse(
          [
            {'id': 'task-2', 'name': 'Second page task'},
          ],
          pagination: {'hasMore': false, 'pageSize': 50},
        );
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('First page task'), findsOneWidget);
      expect(find.text('Second page task'), findsNothing);

      await tester.tap(find.text('Load more'));
      await pumpUntilSettled(tester);

      expect(find.text('First page task'), findsOneWidget);
      expect(find.text('Second page task'), findsOneWidget);
      // hasMore is now false — footer withdrawn, not stuck offering more.
      expect(find.text('Load more'), findsNothing);
    });

    testWidgets('Load more footer is hidden on a non-All filter tab even if hasMore is true',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse(
            [
              {
                'id': 'task-1',
                'name': 'Overdue Task',
                'dueAt': '2020-01-01T00:00:00.000Z',
              },
            ],
            pagination: {'hasMore': true, 'pageSize': 50},
          ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Load more'), findsOneWidget);

      await tester.tap(find.text('Overdue (1)'));
      await tester.pump();

      // Scoped to the unfiltered ("All") view — offering to page a bucketed
      // tab could add nothing visible to it and would be confusing.
      expect(find.text('Load more'), findsNothing);
    });
  });
}
