import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/directory/employee_directory_screen.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  final sampleEmployees = [
    {
      'data': {
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
    },
    {
      'data': {
        'id': 'emp-2',
        'tenantId': 't1',
        'employeeCode': 'EMP-002',
        'firstName': 'Priya',
        'lastName': 'Sharma',
        'designation': 'Deputy Director',
        'department': 'IT',
        'email': 'priya@gov.in',
        'status': 'active',
        'joiningDate': '2018-07-01T00:00:00.000Z',
      },
    },
  ];

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
  });

  Widget buildSubject({List<Map<String, dynamic>>? employees}) {
    when(() => mockDb.listEntities('employees'))
        .thenAnswer((_) async => employees ?? sampleEmployees);

    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: const MaterialApp(home: EmployeeDirectoryScreen(connectivityOverride: true)),
    );
  }

  group('EmployeeDirectoryScreen', () {
    testWidgets('renders with title and search field', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Employee Directory'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('displays employee list', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('Rajesh Kumar'), findsOneWidget);
      expect(find.text('Priya Sharma'), findsOneWidget);
    });

    testWidgets('shows designation and department', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.textContaining('Section Officer'), findsOneWidget);
      expect(find.textContaining('Finance'), findsOneWidget);
    });

    testWidgets('search filters results', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'Priya');
      await tester.pumpAndSettle();

      expect(find.text('Priya Sharma'), findsOneWidget);
      expect(find.text('Rajesh Kumar'), findsNothing);
    });

    testWidgets('search by department works', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'IT');
      await tester.pumpAndSettle();

      expect(find.text('Priya Sharma'), findsOneWidget);
      expect(find.text('Rajesh Kumar'), findsNothing);
    });

    testWidgets('shows empty state when no results', (tester) async {
      await tester.pumpWidget(buildSubject(employees: []));
      await tester.pumpAndSettle();

      expect(find.text('No employees found'), findsOneWidget);
    });

    testWidgets('shows no results message for search', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'nonexistent');
      await tester.pumpAndSettle();

      expect(find.textContaining('No results for'), findsOneWidget);
    });

    testWidgets('displays initials in avatar', (tester) async {
      await tester.pumpWidget(buildSubject());
      await tester.pumpAndSettle();

      expect(find.text('RK'), findsOneWidget); // Rajesh Kumar
      expect(find.text('PS'), findsOneWidget); // Priya Sharma
    });
  });
}
