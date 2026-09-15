import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/features/revenue/trade_license_detail_screen.dart';

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

  Widget buildSubject({String licenseId = 'lic-1'}) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockApi),
        authProvider.overrideWithValue(mockAuth),
      ],
      child: MaterialApp(
        home: TradeLicenseDetailScreen(licenseId: licenseId),
      ),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Response<Map<String, dynamic>> _buildResponse(Map<String, dynamic>? license) {
    return Response(
      data: {'data': license},
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/revenue/trade-licenses/lic-1'),
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

  group('TradeLicenseDetailScreen', () {
    testWidgets('shows loading spinner initially', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async {
        await Future.delayed(const Duration(seconds: 2));
        return _buildResponse(sampleLicense);
      });

      await tester.pumpWidget(buildSubject());
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.pump(const Duration(seconds: 3));
      await pumpUntilSettled(tester);
    });

    testWidgets('renders license fields and computed balance due', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(sampleLicense));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Sunrise Bakery'), findsOneWidget);
      expect(find.text('Asha Rao'), findsOneWidget);
      // Appears twice: the AppBar title and the "License No." detail row.
      expect(find.text('TL-2026-0001'), findsNWidgets(2));
      // Fee ₹2,500 - Paid ₹1,500 = Due ₹1,000.
      expect(find.text('₹2,500'), findsOneWidget);
      expect(find.text('₹1,500'), findsOneWidget);
      expect(find.text('₹1,000'), findsOneWidget);
    });

    testWidgets('a license with no fee data shows "—", never a fabricated ₹0',
        (tester) async {
      final noFeeLicense = Map<String, dynamic>.from(sampleLicense)
        ..['feeMinor'] = null
        ..['feePaidMinor'] = null;
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(noFeeLicense));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('—'), findsWidgets);
      expect(find.textContaining('₹0'), findsNothing);
    });

    testWidgets('shows error state with retry on API failure', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/v1/revenue/trade-licenses/lic-1'),
          type: DioExceptionType.connectionTimeout,
        ),
      );

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load this license'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('shows "License not found" when the server returns no data',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(null));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('License not found'), findsOneWidget);
    });

    testWidgets('shows an expiring-soon banner when expiry is within 30 days',
        (tester) async {
      final soon = DateTime.now().toUtc().add(const Duration(days: 10));
      final expiringLicense = Map<String, dynamic>.from(sampleLicense)
        ..['expiryDate'] =
            '${soon.year}-${soon.month.toString().padLeft(2, '0')}-${soon.day.toString().padLeft(2, '0')}';
      when(() => mockApi.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _buildResponse(expiringLicense));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // The banner sits below the Header/Fees cards, past the default test
      // viewport — scroll the detail ListView until it is realized.
      await tester.scrollUntilVisible(
        find.textContaining('expires within 30 days'),
        300,
        scrollable: find.byType(Scrollable),
      );
      expect(find.textContaining('expires within 30 days'), findsOneWidget);
    });
  });
}
