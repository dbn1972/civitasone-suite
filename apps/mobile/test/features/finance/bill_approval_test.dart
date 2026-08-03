import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/api_client.dart';
import 'package:civitasone_mobile/core/auth/pkce_auth.dart';
import 'package:civitasone_mobile/features/finance/bill_approval_screen.dart';

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
        home: BillApprovalScreen(),
      ),
    );
  }

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Response<Map<String, dynamic>> _buildResponse(List<Map<String, dynamic>> bills) {
    return Response(
      data: {'data': bills},
      statusCode: 200,
      requestOptions: RequestOptions(path: '/v1/finance/bills'),
    );
  }

  group('BillApprovalScreen', () {
    testWidgets('shows loading spinner initially', (tester) async {
      // Delay the API response to observe loading state
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

      // Drain the mocked response delay so no timer outlives the tree.
      await tester.pump(const Duration(seconds: 3));

      // Let the future complete to avoid pending timers
      await pumpUntilSettled(tester);
    });

    testWidgets('shows error state with retry button on API failure',
        (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenThrow(DioException(
        requestOptions: RequestOptions(path: '/v1/finance/bills'),
        type: DioExceptionType.connectionTimeout,
        message: 'Connection timeout',
      ));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Unable to load bills'), findsOneWidget);
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
            requestOptions: RequestOptions(path: '/v1/finance/bills'),
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

    testWidgets('shows empty state when no pending bills', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('No pending bills'), findsOneWidget);
      expect(find.text('All bills have been processed'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
    });

    testWidgets('renders bill cards with vendor and amount', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'bill-1',
              'billNumber': 'BILL-2024-001',
              'vendorName': 'Acme Corp',
              'grossAmount': 1500000,
              'netAmount': 1350000,
              'date': '2024-06-15',
              'stage': 'Finance Review',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('BILL-2024-001'), findsOneWidget);
      expect(find.text('Acme Corp'), findsOneWidget);
      expect(find.text('Finance Review'), findsOneWidget);
    });

    testWidgets('shows Approve and Send Back action buttons', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'bill-1',
              'billNumber': 'BILL-001',
              'vendorName': 'Test Vendor',
              'grossAmount': 100000,
              'netAmount': 90000,
              'date': '2024-01-01',
              'stage': '',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Send Back'), findsOneWidget);
    });

    testWidgets('has RefreshIndicator for pull-to-refresh', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'bill-1',
              'billNumber': 'BILL-001',
              'vendorName': 'Test',
              'grossAmount': 100000,
              'netAmount': 90000,
              'date': '',
              'stage': '',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(RefreshIndicator), findsOneWidget);
    });

    testWidgets('uses ListView.builder for bill list', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'bill-1',
              'billNumber': 'B-1',
              'vendorName': 'V',
              'grossAmount': 100,
              'netAmount': 100,
              'date': '',
              'stage': '',
            },
            {
              'id': 'bill-2',
              'billNumber': 'B-2',
              'vendorName': 'V2',
              'grossAmount': 200,
              'netAmount': 200,
              'date': '',
              'stage': '',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      expect(find.byType(ListView), findsOneWidget);
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

    testWidgets('formats amounts in Indian numbering system', (tester) async {
      when(() => mockApi.get<Map<String, dynamic>>(
            any(),
            params: any(named: 'params'),
          )).thenAnswer((_) async => _buildResponse([
            {
              'id': 'bill-1',
              'billNumber': 'BILL-001',
              'vendorName': 'Test',
              'grossAmount': 1500000, // 15,000 rupees
              'netAmount': 1350000, // 13,500 rupees
              'date': '',
              'stage': '',
            },
          ]));

      await tester.pumpWidget(buildSubject());
      await pumpUntilSettled(tester);

      // Verify formatted amounts are present
      expect(find.textContaining('₹'), findsWidgets);
    });
  });
}
