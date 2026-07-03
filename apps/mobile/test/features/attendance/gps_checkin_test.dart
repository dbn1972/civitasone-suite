import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/attendance/gps_checkin_screen.dart';

class MockSyncDatabase extends Mock implements SyncDatabase {}

class MockSyncEngine extends Mock implements SyncEngine {}

void main() {
  late MockSyncDatabase mockDb;
  late MockSyncEngine mockEngine;

  setUp(() {
    mockDb = MockSyncDatabase();
    mockEngine = MockSyncEngine();
    when(() => mockEngine.syncMailbox(any())).thenAnswer((_) async {});
    when(() => mockDb.listEntities(any())).thenAnswer((_) async => []);
  });

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  Widget buildSubject({bool? connectivity}) {
    return ProviderScope(
      overrides: [
        dbProvider.overrideWith((_) => Future.value(mockDb)),
        syncEngineProvider.overrideWithValue(mockEngine),
      ],
      child: MaterialApp(
        home: GpsCheckInScreen(connectivityOverride: connectivity),
      ),
    );
  }

  group('GpsCheckInScreen', () {
    testWidgets('renders with title and GPS status', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pump(const Duration(seconds: 1));

      expect(find.text('GPS Check-In'), findsOneWidget);
      expect(find.text('GPS Status'), findsOneWidget);
    });

    testWidgets('shows GPS acquiring state initially', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      // Pump one frame, GPS timer (800ms) is still pending
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Acquiring location...'), findsOneWidget);

      // Complete the pending timer to avoid test teardown errors
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('shows GPS coordinates after acquisition', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pump(const Duration(seconds: 1));

      expect(find.textContaining('Lat:'), findsOneWidget);
      expect(find.textContaining('Accuracy:'), findsOneWidget);
    });

    testWidgets('shows selfie capture button', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pump(const Duration(seconds: 1));

      expect(find.text('Capture selfie'), findsOneWidget);
    });

    testWidgets('selfie capture changes state', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pump(const Duration(seconds: 1));

      await tester.tap(find.text('Capture selfie'));
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('Selfie captured'), findsOneWidget);
    });

    testWidgets('shows Check In button by default', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pump(const Duration(seconds: 1));

      expect(find.text('Check In'), findsOneWidget);
    });

    testWidgets('shows offline banner when disconnected', (tester) async {
      await tester.pumpWidget(buildSubject(connectivity: false));
      await tester.pump(const Duration(seconds: 1));

      expect(find.textContaining('Offline'), findsOneWidget);
    });

    testWidgets('submit triggers outbox enqueue', (tester) async {
      when(() => mockDb.enqueueOutbox(
            mailbox: any(named: 'mailbox'),
            operation: any(named: 'operation'),
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).thenAnswer((_) async => 'outbox-id');
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'),
            mailbox: any(named: 'mailbox'),
            data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'),
            syncState: any(named: 'syncState'),
          )).thenAnswer((_) async {});

      await tester.pumpWidget(buildSubject(connectivity: true));
      await tester.pump(const Duration(seconds: 1));

      await tester.tap(find.text('Check In'));
      await tester.pump(const Duration(seconds: 1));

      verify(() => mockDb.enqueueOutbox(
            mailbox: 'attendance',
            operation: 'create',
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).called(1);
    });
  });
}
