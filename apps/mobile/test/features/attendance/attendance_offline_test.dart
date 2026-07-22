import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/providers.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/sync/sync_engine.dart';
import 'package:civitasone_mobile/features/attendance/gps_checkin_screen.dart';
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
    when(() => mockDb.listEntities(any())).thenAnswer((_) async => []);
  });

  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  Widget buildCheckInScreen({bool? connectivity}) {
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

  Future<void> pumpUntilSettled(WidgetTester tester) async {
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  group('Attendance — Offline-First Sync', () {
    testWidgets('check-in works when offline (queues to outbox)',
        (tester) async {
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

      // Build with connectivity = false (offline)
      await tester.pumpWidget(buildCheckInScreen(connectivity: false));
      await pumpUntilSettled(tester);

      // Verify offline banner is shown
      expect(find.textContaining('Offline'), findsOneWidget);

      // Tap Check In (GPS has acquired by this point)
      await tester.tap(find.text('Check In'));
      await pumpUntilSettled(tester);

      // Verify the write went to outbox
      verify(() => mockDb.enqueueOutbox(
            mailbox: 'attendance',
            operation: 'create',
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).called(1);

      // Verify local entity was created (optimistic)
      verify(() => mockDb.upsertEntity(
            id: any(named: 'id'),
            mailbox: 'attendance',
            data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'),
            syncState: 'pending',
          )).called(1);
    });

    testWidgets('check-in triggers sync when online', (tester) async {
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

      await tester.pumpWidget(buildCheckInScreen(connectivity: true));
      await pumpUntilSettled(tester);

      // No offline banner when online
      expect(find.textContaining('Offline'), findsNothing);

      await tester.tap(find.text('Check In'));
      await pumpUntilSettled(tester);

      // Sync should be triggered for the attendance mailbox
      verify(() => mockEngine.syncMailbox('attendance')).called(greaterThan(0));
    });

    testWidgets('offline banner is visible with correct message', (tester) async {
      await tester.pumpWidget(buildCheckInScreen(connectivity: false));
      await pumpUntilSettled(tester);

      expect(
        find.text('Offline — will sync when connected'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.cloud_off), findsOneWidget);
    });

    testWidgets('online mode hides offline banner', (tester) async {
      await tester.pumpWidget(buildCheckInScreen(connectivity: true));
      await pumpUntilSettled(tester);

      expect(find.textContaining('Offline'), findsNothing);
      expect(find.byIcon(Icons.cloud_off), findsNothing);
    });

    testWidgets('check-in payload includes GPS coordinates', (tester) async {
      Map<String, dynamic>? capturedPayload;
      when(() => mockDb.enqueueOutbox(
            mailbox: any(named: 'mailbox'),
            operation: any(named: 'operation'),
            entityId: any(named: 'entityId'),
            payload: any(named: 'payload'),
          )).thenAnswer((inv) async {
        capturedPayload = inv.namedArguments[#payload] as Map<String, dynamic>;
        return 'outbox-id';
      });
      when(() => mockDb.upsertEntity(
            id: any(named: 'id'),
            mailbox: any(named: 'mailbox'),
            data: any(named: 'data'),
            updatedAt: any(named: 'updatedAt'),
            syncState: any(named: 'syncState'),
          )).thenAnswer((_) async {});

      await tester.pumpWidget(buildCheckInScreen(connectivity: true));
      await pumpUntilSettled(tester);

      await tester.tap(find.text('Check In'));
      await pumpUntilSettled(tester);

      expect(capturedPayload, isNotNull);
      expect(capturedPayload!['type'], 'checkIn');
      // Position is a nested map with lat/lng
      final position = capturedPayload!['position'] as Map<String, dynamic>;
      expect(position['latitude'], isA<double>());
      expect(position['longitude'], isA<double>());
      expect(position['accuracy'], isA<double>());
    });

    testWidgets('selfie capture state is reflected in UI', (tester) async {
      await tester.pumpWidget(buildCheckInScreen(connectivity: true));
      await pumpUntilSettled(tester);

      // Initial state: selfie not captured
      expect(find.text('Capture selfie'), findsOneWidget);
      expect(find.text('Required for verification'), findsOneWidget);

      // Capture selfie
      await tester.tap(find.text('Capture selfie'));
      await tester.pump(const Duration(milliseconds: 500));

      // After capture: state changes
      expect(find.text('Selfie captured'), findsOneWidget);
      expect(find.text('Tap to retake'), findsOneWidget);
    });

    testWidgets('GPS acquiring state disables submit button', (tester) async {
      await tester.pumpWidget(buildCheckInScreen(connectivity: true));
      // GPS timer is 800ms — pump less to stay in acquiring state
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Acquiring location...'), findsOneWidget);

      // Check In button should be disabled (FilledButton with null onPressed)
      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);

      // Complete the timer
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('main action button has 56dp height (touch target)',
        (tester) async {
      await tester.pumpWidget(buildCheckInScreen(connectivity: true));
      await pumpUntilSettled(tester);

      // Find the SizedBox wrapping the button
      final sizedBox = tester.widget<SizedBox>(
        find.ancestor(
          of: find.byType(FilledButton),
          matching: find.byType(SizedBox),
        ).first,
      );
      expect(sizedBox.height, 56);
    });

    testWidgets('success snackbar appears after check-in', (tester) async {
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

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbProvider.overrideWith((_) => Future.value(mockDb)),
            syncEngineProvider.overrideWithValue(mockEngine),
          ],
          child: MaterialApp(
            home: Navigator(
              onGenerateRoute: (_) => MaterialPageRoute<void>(
                builder: (_) => GpsCheckInScreen(connectivityOverride: true),
              ),
            ),
          ),
        ),
      );
      await pumpUntilSettled(tester);

      await tester.tap(find.text('Check In'));
      await pumpUntilSettled(tester);

      expect(find.text('Checked in successfully'), findsOneWidget);
    });
  });
}
