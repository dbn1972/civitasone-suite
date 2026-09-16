import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/features/revenue/assessee_detail_screen.dart';

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

  Widget buildSubject({String assesseeId = 'ass-1'}) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockApi),
        authProvider.overrideWithValue(mockAuth),
      ],
      child: MaterialApp(
        home: AssesseeDetailScreen(assesseeId: assesseeId),
      ),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Response<Map<String, dynamic>> _buildResponse(Map<String, dynamic>? assessee) {
    return Response(
      data: {'data': assessee},
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/revenue/assessees/ass-1'),
    );
  }

  final sampleAssessee = {
    'id': 'ass-1',
    'tenantId': 't1',
    'assesseeType': 'water_connection',
    'identifierNo': 'WC-0001',
    'ownerName': 'Asha Rao',
    'address': '12 Market Road',
    'wardNo': '7',
    'zoneNo': 'Z3',
    'connectionSize': '0.75"',
    'isActive': true,
  };

  group('AssesseeDetailScreen', () {
    testWidgets('shows loading spinner initially', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async {
        await Future.delayed(const Duration(seconds: 2));
        return _buildResponse(sampleAssessee);
      });

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      await pumpUntilSettled(tester);
    });

    testWidgets('renders assessee fields', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(sampleAssessee));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Asha Rao'), findsOneWidget);
      // Appears twice: the AppBar title and the "Identifier No." detail row.
      expect(find.text('WC-0001'), findsNWidgets(2));
      expect(find.text('Water Connection'), findsOneWidget);
      expect(find.text('Active'), findsOneWidget);
      expect(find.text('0.75"'), findsOneWidget);
    });

    testWidgets('shows error state with retry on API failure', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/revenue/assessees/ass-1'),
          type: DioExceptionType.connectionTimeout,
        ),
      );

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load this assessee'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('shows "Assessee not found" when the server returns no data',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(null));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Assessee not found'), findsOneWidget);
    });
  });
}
