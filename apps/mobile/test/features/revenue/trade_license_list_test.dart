import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/features/revenue/trade_license_list_screen.dart';

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
      child: const MaterialApp(home: TradeLicenseListScreen()),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Response<Map<String, dynamic>> _buildResponse(List<Map<String, dynamic>> licenses) {
    return Response(
      data: {'data': licenses},
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/revenue/trade-licenses'),
    );
  }

  final sampleLicense = {
    'id': 'lic-1',
    'tenantId': 't1',
    'licenseNo': 'TL-2026-0001',
    'businessName': 'Sunrise Bakery',
    'proprietorName': 'Asha Rao',
    'address': '12 Market Road',
    'wardNo': '7',
    'businessType': 'retail',
    'category': 'A',
    'status': 'active',
    'issuedDate': '2026-04-01',
    'expiryDate': '2027-03-31',
    'feeMinor': '250000',
    'feePaidMinor': '150000',
    'renewalCount': 1,
  };

  group('TradeLicenseListScreen', () {
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
        requestOptions: RequestOptions(path: '/v1/revenue/trade-licenses'),
        type: DioExceptionType.connectionTimeout,
      ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load trade licenses'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('403 renders a permission-denied message, not raw error text',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/revenue/trade-licenses'),
        type: DioExceptionType.badResponse,
        response: Response(
          statusCode: 403,
          requestOptions: RequestOptions(path: '/v1/revenue/trade-licenses'),
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
            requestOptions: RequestOptions(path: '/v1/revenue/trade-licenses'),
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

    testWidgets('shows empty state when no licenses', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No trade licenses found'), findsOneWidget);
    });

    testWidgets('renders license cards with business name, license no, and status',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleLicense]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Sunrise Bakery'), findsOneWidget);
      expect(find.text('TL-2026-0001'), findsOneWidget);
      expect(find.text('Active'), findsOneWidget);
      // 250000 - 150000 = 100000 paise = ₹1,000 due.
      expect(find.textContaining('₹1,000'), findsOneWidget);
    });

    testWidgets('a license with no fee data shows "—" rather than a fabricated amount',
        (tester) async {
      final noFeeLicense = Map<String, dynamic>.from(sampleLicense)
        ..['feeMinor'] = null
        ..['feePaidMinor'] = null;
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([noFeeLicense]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.textContaining('Due'), findsNothing);
      expect(find.textContaining('Paid in full'), findsNothing);
    });

    testWidgets('search filters the list by business name', (tester) async {
      final other = Map<String, dynamic>.from(sampleLicense)
        ..['id'] = 'lic-2'
        ..['licenseNo'] = 'TL-2026-0002'
        ..['businessName'] = 'Riverside Hardware'
        ..['proprietorName'] = 'Vikram Singh';
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleLicense, other]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Sunrise Bakery'), findsOneWidget);
      expect(find.text('Riverside Hardware'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'riverside');
      await pumpUntilSettled(tester);

      expect(find.text('Sunrise Bakery'), findsNothing);
      expect(find.text('Riverside Hardware'), findsOneWidget);
    });

    testWidgets('has RefreshIndicator for pull-to-refresh', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([sampleLicense]));

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
  });
}
