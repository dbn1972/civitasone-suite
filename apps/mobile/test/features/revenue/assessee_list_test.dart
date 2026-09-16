import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/features/revenue/assessee_list_screen.dart';

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
      child: const MaterialApp(home: AssesseeListScreen()),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Response<Map<String, dynamic>> _buildResponse(
    List<Map<String, dynamic>> assessees, {
    Map<String, dynamic>? meta,
  }) {
    return Response(
      data: {
        'data': assessees,
        if (meta != null) 'meta': meta,
      },
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/revenue/assessees'),
    );
  }

  final sampleAssessee = {
    'id': 'ass-1',
    'tenantId': 't1',
    'assesseeType': 'property',
    'identifierNo': 'PROP-0001',
    'ownerName': 'Asha Rao',
    'address': '12 Market Road',
    'wardNo': '7',
    'zoneNo': 'Z3',
    'propertyType': 'residential',
    'builtUpArea': '1200',
    'isActive': true,
  };

  group('AssesseeListScreen', () {
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

    testWidgets('shows error state with retry button on API failure',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/revenue/assessees'),
        type: DioExceptionType.connectionTimeout,
      ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load assessees'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('403 renders a permission-denied message, not raw error text',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/revenue/assessees'),
        type: DioExceptionType.badResponse,
        response: Response(
          statusCode: 403,
          requestOptions: RequestOptions(path: '/v1/revenue/assessees'),
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
            requestOptions: RequestOptions(path: '/v1/revenue/assessees'),
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

    testWidgets('shows empty state when no assessees', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No assessees found'), findsOneWidget);
    });

    testWidgets('renders assessee cards with owner name, identifier, and type',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleAssessee]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('PROP-0001'), findsOneWidget);
      expect(find.text('Property'), findsOneWidget);
      expect(find.text('Active'), findsOneWidget);
    });

    testWidgets('search filters the list by owner name', (tester) async {
      final other = Map<String, dynamic>.from(sampleAssessee)
        ..['id'] = 'ass-2'
        ..['identifierNo'] = 'WC-0002'
        ..['ownerName'] = 'Vikram Singh'
        ..['assesseeType'] = 'water_connection';
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleAssessee, other]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Vikram Singh'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'vikram');
      await pumpUntilSettled(tester);

      expect(find.text('Asha Rao'), findsNothing);
      expect(find.text('Vikram Singh'), findsOneWidget);
    });

    testWidgets('has RefreshIndicator for pull-to-refresh', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleAssessee]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(RefreshIndicator), findsOneWidget);
    });

    testWidgets('refresh icon button has tooltip for accessibility',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      final iconButton = tester.widget<IconButton>(find.byType(IconButton));
      expect(iconButton.tooltip, 'Refresh');
    });

    // ── Pagination ───────────────────────────────────────────────────────────

    testWidgets('initial fetch requests limit and an explicit offset of 0',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleAssessee]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      final captured = verify(() => mockApi.get<Map<String, dynamic>>(
            '/v1/revenue/assessees',
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
            [sampleAssessee],
            meta: {'page': 1, 'pageSize': 1, 'total': 2},
          ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Showing 1 of 2'), findsOneWidget);
      expect(find.text('Load more'), findsOneWidget);
    });

    testWidgets('Load more requests the next page by offset and appends results',
        (tester) async {
      final second = Map<String, dynamic>.from(sampleAssessee)
        ..['id'] = 'ass-2'
        ..['identifierNo'] = 'WC-0002'
        ..['ownerName'] = 'Vikram Singh';

      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((invocation) async {
        final params =
            invocation.namedArguments[#params] as Map<String, dynamic>?;
        final offset = params?['offset'] as int? ?? 0;
        if (offset == 0) {
          return _buildResponse([sampleAssessee],
              meta: {'page': 1, 'pageSize': 1, 'total': 2});
        }
        expect(offset, 1, reason: 'offset should equal the number already loaded');
        return _buildResponse([second], meta: {'page': 2, 'pageSize': 1, 'total': 2});
      });

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Vikram Singh'), findsNothing);

      await tester.tap(find.text('Load more'));
      await pumpUntilSettled(tester);

      expect(find.text('Vikram Singh'), findsOneWidget);
      expect(find.text('Load more'), findsNothing);
    });

    // ── Defensive model parsing ─────────────────────────────────────────────────

    testWidgets('an assessee with a null id does not crash the list',
        (tester) async {
      final noId = Map<String, dynamic>.from(sampleAssessee)..['id'] = null;
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([noId]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Asha Rao'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an unrecognized assesseeType renders "Unknown"', (tester) async {
      final weirdType = Map<String, dynamic>.from(sampleAssessee)
        ..['assesseeType'] = 'some_future_type';
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([weirdType]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unknown'), findsOneWidget);
    });
  });
}
