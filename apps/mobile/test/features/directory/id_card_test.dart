import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart' hide VerificationResult;
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/directory/id_card_screen.dart';
import 'package:civitasone_mobile/features/directory/models.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  final validIdCard = {
    'data': {
      'employee': {
        'id': 'emp-1',
        'tenantId': 't1',
        'employeeCode': 'EMP-001',
        'firstName': 'Rajesh',
        'lastName': 'Kumar',
        'designation': 'Section Officer',
        'department': 'Finance',
        'email': 'rajesh@gov.in',
        'status': 'active',
        'joiningDate': '2020-03-15T00:00:00.000Z',
      },
      'cardId': 'card-001',
      'issuedAt': '2024-01-01T00:00:00.000Z',
      'validUntil': '2026-12-31T00:00:00.000Z',
      'qrPayload': 'signed-jwt-token',
    },
  };

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
  });

  Widget buildSubject({List<Map<String, dynamic>>? idCards}) {
    when(() => mockDb.listEntities('id_cards'))
        .thenAnswer((_) async => idCards ?? [validIdCard]);

    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(home: IdCardScreen()),
    );
  }

  group('IdCardScreen', () {
    testWidgets('renders with title', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('ID Card'), findsOneWidget);
    });

    testWidgets('shows employee name on card', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Rajesh Kumar'), findsOneWidget);
    });

    testWidgets('shows designation and department', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Section Officer'), findsOneWidget);
      expect(find.text('Finance'), findsOneWidget);
    });

    testWidgets('shows employee code', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('EMP-001'), findsOneWidget);
    });

    testWidgets('shows VALID badge for valid card', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('VALID'), findsOneWidget);
    });

    testWidgets('shows QR code icon', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.qr_code_2), findsOneWidget);
    });

    testWidgets('shows verify button in app bar', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.qr_code_scanner), findsOneWidget);
    });

    testWidgets('shows empty state when no card issued', (tester) async {
      await tester.pumpWidget(buildSubject(idCards: []));
      await tester.pumpAndSettle();

      expect(find.text('No ID card issued'), findsOneWidget);
    });
  });

  group('IdCard model', () {
    test('isValid returns true for future validUntil', () {
      final card = IdCard(
        employee: Employee(
          id: 'e1',
          tenantId: 't1',
          employeeCode: 'E001',
          firstName: 'Test',
          lastName: 'User',
          designation: 'Officer',
          department: 'IT',
          email: 'test@gov.in',
          status: EmployeeStatus.active,
          joiningDate: DateTime(2020, 1, 1),
        ),
        cardId: 'c1',
        issuedAt: DateTime(2024, 1, 1),
        validUntil: DateTime.now().add(const Duration(days: 365)),
      );
      expect(card.isValid, isTrue);
    });

    test('isValid returns false for past validUntil', () {
      final card = IdCard(
        employee: Employee(
          id: 'e1',
          tenantId: 't1',
          employeeCode: 'E001',
          firstName: 'Test',
          lastName: 'User',
          designation: 'Officer',
          department: 'IT',
          email: 'test@gov.in',
          status: EmployeeStatus.active,
          joiningDate: DateTime(2020, 1, 1),
        ),
        cardId: 'c1',
        issuedAt: DateTime(2022, 1, 1),
        validUntil: DateTime(2023, 1, 1),
      );
      expect(card.isValid, isFalse);
    });
  });

  group('VerificationResult model', () {
    test('isVerified returns true for valid status', () {
      final result = VerificationResult(
        status: VerificationStatus.valid,
        verifiedAt: DateTime.now(),
      );
      expect(result.isVerified, isTrue);
    });

    test('isVerified returns false for expired status', () {
      final result = VerificationResult(
        status: VerificationStatus.expired,
        verifiedAt: DateTime.now(),
      );
      expect(result.isVerified, isFalse);
    });
  });
}
