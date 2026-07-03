import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/attendance/attendance_history_screen.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
  });

  Widget buildSubject({
    List<Map<String, dynamic>> records = const [],
    bool? connectivity,
  }) {
    when(() => mockDb.listEntities('attendance'))
        .thenAnswer((_) async => records);

    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: MaterialApp(
        home: AttendanceHistoryScreen(connectivityOverride: connectivity),
      ),
    );
  }

  group('AttendanceHistoryScreen', () {
    testWidgets('renders with title', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      expect(find.text('Attendance History'), findsOneWidget);
    });

    testWidgets('shows empty state when no records', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pumpAndSettle();

      expect(find.text('No attendance records yet'), findsOneWidget);
    });

    testWidgets('displays records sorted by date', (tester) async {
      final records = [
        {
          'data': {
            'id': '1',
            'tenantId': 't1',
            'employeeId': 'e1',
            'type': 'checkIn',
            'position': {
              'latitude': 28.6139,
              'longitude': 77.2090,
              'accuracy': 10.0,
              'timestamp': '2024-01-15T09:00:00.000Z',
            },
            'createdAt': '2024-01-15T09:00:00.000Z',
          },
        },
        {
          'data': {
            'id': '2',
            'tenantId': 't1',
            'employeeId': 'e1',
            'type': 'checkOut',
            'position': {
              'latitude': 28.6139,
              'longitude': 77.2090,
              'accuracy': 10.0,
              'timestamp': '2024-01-15T17:30:00.000Z',
            },
            'createdAt': '2024-01-15T17:30:00.000Z',
          },
        },
      ];

      await tester.pumpWidget(
          buildSubject(records: records, connectivity: true));
      await tester.pumpAndSettle();

      expect(find.text('Check In'), findsOneWidget);
      expect(find.text('Check Out'), findsOneWidget);
    });

    testWidgets('shows offline banner when disconnected', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: false));
      await tester.pumpAndSettle();

      expect(find.textContaining('Offline'), findsOneWidget);
    });
  });
}
