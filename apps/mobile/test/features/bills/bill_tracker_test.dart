import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/bills/bill_tracker_screen.dart';
import 'package:civitasone_mobile/features/bills/models.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  final sampleBills = [
    {
      'data': {
        'id': 'bill-1',
        'tenantId': 't1',
        'billNo': 'BILL-2024-001',
        'vendorName': 'Office Supplies Co.',
        'description': 'Stationery for Q1',
        'amountMinor': 1500000,
        'currency': 'INR',
        'status': 'submitted',
        'createdAt': '2024-01-15T10:00:00.000Z',
        'timeline': [
          {
            'id': 'tl-1',
            'action': 'Bill submitted',
            'actor': 'Clerk A',
            'timestamp': '2024-01-15T10:00:00.000Z',
            'toStatus': 'submitted',
          }
        ],
      },
    },
    {
      'data': {
        'id': 'bill-2',
        'tenantId': 't1',
        'billNo': 'BILL-2024-002',
        'vendorName': 'Tech Solutions',
        'description': 'Server maintenance',
        'amountMinor': 5000000,
        'currency': 'INR',
        'status': 'approved',
        'createdAt': '2024-01-10T09:00:00.000Z',
        'timeline': [],
      },
    },
  ];

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
  });

  Widget buildSubject({List<Map<String, dynamic>>? bills}) {
    when(() => mockDb.listEntities('bills'))
        .thenAnswer((_) async => bills ?? sampleBills);

    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(home: BillTrackerScreen(connectivityOverride: true)),
    );
  }

  group('BillTrackerScreen', () {
    testWidgets('renders with title and search', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Bill Tracker'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('displays bill list', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('BILL-2024-001'), findsOneWidget);
      expect(find.text('BILL-2024-002'), findsOneWidget);
    });

    testWidgets('shows vendor names', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Office Supplies Co.'), findsOneWidget);
      expect(find.text('Tech Solutions'), findsOneWidget);
    });

    testWidgets('shows status badges', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('submitted'), findsOneWidget);
      expect(find.text('approved'), findsOneWidget);
    });

    testWidgets('search filters by bill number', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), '001');
      await tester.pumpAndSettle();

      expect(find.text('BILL-2024-001'), findsOneWidget);
      expect(find.text('BILL-2024-002'), findsNothing);
    });

    testWidgets('search filters by vendor', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'Tech');
      await tester.pumpAndSettle();

      expect(find.text('Tech Solutions'), findsOneWidget);
      expect(find.text('Office Supplies Co.'), findsNothing);
    });

    testWidgets('shows empty state when no bills', (tester) async {
      await tester.pumpWidget(buildSubject(bills: []));
      await tester.pumpAndSettle();

      expect(find.text('No bills found'), findsOneWidget);
    });
  });

  group('Bill model', () {
    test('isOverdue returns true for past due unpaid bill', () {
      final bill = Bill(
        id: 'b1',
        tenantId: 't1',
        billNo: 'B-001',
        vendorName: 'V',
        description: 'D',
        amountMinor: 100000,
        currency: 'INR',
        status: BillStatus.submitted,
        createdAt: DateTime(2024, 1, 1),
        timeline: [],
        dueDate: DateTime(2024, 1, 2), // in the past
      );
      expect(bill.isOverdue, isTrue);
    });

    test('isOverdue returns false for paid bill', () {
      final bill = Bill(
        id: 'b1',
        tenantId: 't1',
        billNo: 'B-001',
        vendorName: 'V',
        description: 'D',
        amountMinor: 100000,
        currency: 'INR',
        status: BillStatus.paid,
        createdAt: DateTime(2024, 1, 1),
        timeline: [],
        dueDate: DateTime(2024, 1, 2), // in the past but paid
      );
      expect(bill.isOverdue, isFalse);
    });

    test('amountMajor converts paise to rupees', () {
      final bill = Bill(
        id: 'b1',
        tenantId: 't1',
        billNo: 'B-001',
        vendorName: 'V',
        description: 'D',
        amountMinor: 1500050,
        currency: 'INR',
        status: BillStatus.draft,
        createdAt: DateTime(2024, 1, 1),
        timeline: [],
      );
      expect(bill.amountMajor, closeTo(15000.50, 0.01));
    });

    test('timeline fromJson works correctly', () {
      final entry = BillTimelineEntry.fromJson({
        'id': 'tl-1',
        'action': 'Approved',
        'actor': 'Officer X',
        'timestamp': '2024-01-15T10:00:00.000Z',
        'fromStatus': 'submitted',
        'toStatus': 'approved',
        'remarks': 'Looks good',
      });
      expect(entry.action, 'Approved');
      expect(entry.fromStatus, BillStatus.submitted);
      expect(entry.toStatus, BillStatus.approved);
      expect(entry.remarks, 'Looks good');
    });
  });
}
