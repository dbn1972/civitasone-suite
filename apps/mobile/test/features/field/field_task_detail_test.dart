import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/features/field/field_task_detail_screen.dart';

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

  Widget buildSubject({String taskId = 'task-1'}) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockApi),
        authProvider.overrideWithValue(mockAuth),
      ],
      child: MaterialApp(
        home: FieldTaskDetailScreen(taskId: taskId),
      ),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Response<Map<String, dynamic>> _buildResponse(Map<String, dynamic>? task) {
    return Response(
      data: {'data': task},
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/field/tasks/task-1'),
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

  group('FieldTaskDetailScreen', () {
    testWidgets('shows loading spinner initially', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any())).thenAnswer((_) async {
        await Future.delayed(const Duration(seconds: 2));
        return _buildResponse(sampleTask);
      });

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      await pumpUntilSettled(tester);
    });

    testWidgets('renders task fields', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(sampleTask));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // Appears twice: the AppBar title and the header card title.
      expect(find.text('Read water meter at Ward 5'), findsNWidgets(2));
      expect(find.text('meter-reading'), findsOneWidget);
      expect(find.text('Assigned'), findsOneWidget);
      expect(find.text('Check for tampering'), findsOneWidget);
      expect(find.text('P2'), findsOneWidget);
      expect(find.text('agent-7'), findsOneWidget);
      expect(find.text('12 MG Road'), findsOneWidget);
      expect(find.text('12.971600, 77.594600'), findsOneWidget);
    });

    testWidgets('shows error state with retry on API failure', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/field/tasks/task-1'),
          type: DioExceptionType.connectionTimeout,
        ),
      );

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load this task'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('shows "Task not found" when the server returns no data', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(null));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Task not found'), findsOneWidget);
    });

    testWidgets('shows an overdue banner for an open task past its due date', (tester) async {
      final overdue = Map<String, dynamic>.from(sampleTask)
        ..['dueDate'] = '2020-01-01T00:00:00.000Z'
        ..['status'] = 'in_progress';
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(overdue));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('This task is overdue.'), findsOneWidget);
    });

    testWidgets('does not show an overdue banner once the task is completed', (tester) async {
      final done = Map<String, dynamic>.from(sampleTask)
        ..['dueDate'] = '2020-01-01T00:00:00.000Z'
        ..['status'] = 'completed'
        ..['completedAt'] = '2020-01-02T00:00:00.000Z';
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(done));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('This task is overdue.'), findsNothing);
      // The Schedule card should surface the completion time once known.
      expect(find.text('Completed At'), findsOneWidget);
    });

    testWidgets('an unassigned task with no location shows "—" and no coordinates row',
        (tester) async {
      final bare = Map<String, dynamic>.from(sampleTask)
        ..['assigneeId'] = null
        ..['address'] = null
        ..['latitude'] = null
        ..['longitude'] = null;
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(bare));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unassigned'), findsOneWidget);
      expect(find.text('—'), findsOneWidget); // Address only; no Coordinates row at all.
      expect(find.text('Coordinates'), findsNothing);
    });

    testWidgets('an unrecognized status renders "Unknown"', (tester) async {
      final weird = Map<String, dynamic>.from(sampleTask)..['status'] = 'some_future_status';
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(weird));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unknown'), findsOneWidget);
    });
  });
}
