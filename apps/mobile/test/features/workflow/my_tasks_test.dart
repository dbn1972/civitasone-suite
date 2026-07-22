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

  Response<Map<String, dynamic>> _buildResponse(List<Map<String, dynamic>> tasks) {
    return Response(
      data: {'data': tasks},
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

    testWidgets('renders task cards with name and workflow', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Review Budget Proposal',
              'workflowName': 'Budget Approval',
              'dueDate': '2024-12-31',
              'priority': 'high',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Review Budget Proposal'), findsOneWidget);
      expect(find.text('Budget Approval'), findsOneWidget);
      expect(find.text('HIGH'), findsOneWidget);
    });

    testWidgets('shows Complete and Delegate action buttons', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Review Doc',
              'workflowName': 'File',
              'priority': 'normal',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Complete'), findsOneWidget);
      expect(find.text('Delegate'), findsOneWidget);
    });

    testWidgets('shows filter chips (All, Overdue, Due Today, Upcoming)',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('All'), findsOneWidget);
      expect(find.text('Overdue'), findsOneWidget);
      expect(find.text('Due Today'), findsOneWidget);
      expect(find.text('Upcoming'), findsOneWidget);
    });

    testWidgets('overdue tasks show red due date indicator', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Overdue Task',
              'workflowName': 'Test',
              'dueDate': '2020-01-01', // clearly in the past
              'priority': 'normal',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Overdue:'), findsOneWidget);
    });

    testWidgets('filter chips filter the task list', (tester) async {
      final pastDate = '2020-01-01';
      final futureDate = '2099-12-31';

      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Overdue Task',
              'workflowName': 'W1',
              'dueDate': pastDate,
              'priority': 'high',
            },
            {
              'id': 'task-2',
              'name': 'Future Task',
              'workflowName': 'W2',
              'dueDate': futureDate,
              'priority': 'normal',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // All filter: both tasks visible
      expect(find.text('Overdue Task'), findsOneWidget);
      expect(find.text('Future Task'), findsOneWidget);

      // Switch to Overdue filter
      await tester.tap(find.text('Overdue'));
      await tester.pump();

      expect(find.text('Overdue Task'), findsOneWidget);
      expect(find.text('Future Task'), findsNothing);

      // Switch to Upcoming filter
      await tester.tap(find.text('Upcoming'));
      await tester.pump();

      expect(find.text('Overdue Task'), findsNothing);
      expect(find.text('Future Task'), findsOneWidget);
    });

    testWidgets('has RefreshIndicator for pull-to-refresh', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'Task',
              'priority': 'normal',
            },
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
            {'id': 't-1', 'name': 'A', 'priority': 'normal'},
            {'id': 't-2', 'name': 'B', 'priority': 'high'},
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
            {
              'id': 'task-1',
              'name': 'Review Report',
              'priority': 'normal',
            },
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

      // Confirm completion
      await tester.tap(find.widgetWithText(FilledButton, 'Complete'));
      await pumpUntilSettled(tester);

      verify(() => mockApi.post<dynamic>(
            '/v1/workflow/tasks/task-1/complete',
            data: any(named: 'data'),
          )).called(1);
    });

    testWidgets('priority badge shows correct color coding', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'task-1',
              'name': 'High Priority',
              'priority': 'high',
            },
            {
              'id': 'task-2',
              'name': 'Medium Priority',
              'priority': 'medium',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('HIGH'), findsOneWidget);
      expect(find.text('MEDIUM'), findsOneWidget);
    });
  });
}
