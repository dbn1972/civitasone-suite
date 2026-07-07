import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:civitasone_mobile/core/sync/sync_providers.dart';
import 'package:civitasone_mobile/core/sync/write_outbox.dart';
import 'package:civitasone_mobile/core/sync/sync_database.dart';
import 'package:civitasone_mobile/core/widgets/sync_status_indicator.dart';
import 'package:civitasone_mobile/features/sync/sync_failures_screen.dart';

class _MockSyncDatabase extends Mock implements SyncDatabase {}

/// A fake WriteOutbox that overrides methods to avoid real DB access.
class _FakeWriteOutbox extends WriteOutbox {
  _FakeWriteOutbox({
    this.deadEntries = const [],
    this.onRetryDeadCb,
  }) : super(_MockSyncDatabase());

  final List<WriteOutboxEntry> deadEntries;
  final void Function(String id)? onRetryDeadCb;

  @override
  Future<List<WriteOutboxEntry>> getDead() async => deadEntries;

  @override
  Future<void> retryDead(String id) async {
    onRetryDeadCb?.call(id);
  }

  @override
  Future<int> get unsyncedCount async => 0;

  @override
  Future<int> get deadCount async => deadEntries.length;
}

void main() {
  group('SyncStatusIndicator', () {
    testWidgets('is hidden when unsynced and dead counts are both 0',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(0)),
            deadCountProvider.overrideWith((_) => Stream.value(0)),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Should render a SizedBox.shrink (effectively invisible)
      expect(find.byType(Badge), findsNothing);
      expect(find.byType(InkWell), findsNothing);
    });

    testWidgets('shows count badge when unsynced count > 0', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(3)),
            deadCountProvider.overrideWith((_) => Stream.value(0)),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Badge), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      // Shows sync icon (not sync_problem) when no dead letters
      expect(find.byIcon(Icons.sync), findsOneWidget);
      expect(find.byIcon(Icons.sync_problem), findsNothing);
    });

    testWidgets('shows error icon when dead letters exist', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(1)),
            deadCountProvider.overrideWith((_) => Stream.value(2)),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Total count = 1 + 2 = 3
      expect(find.text('3'), findsOneWidget);
      // Shows sync_problem icon when dead letters exist
      expect(find.byIcon(Icons.sync_problem), findsOneWidget);
      expect(find.byIcon(Icons.sync), findsNothing);
    });

    testWidgets('caps display count at 99+', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(50)),
            deadCountProvider.overrideWith((_) => Stream.value(60)),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // 50 + 60 = 110, capped at 99+
      expect(find.text('99+'), findsOneWidget);
    });

    testWidgets('has accessible touch target ≥ 48dp', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(5)),
            deadCountProvider.overrideWith((_) => Stream.value(0)),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Find the ConstrainedBox that enforces the 48dp minimum
      final constrainedBoxes = tester.widgetList<ConstrainedBox>(
        find.byType(ConstrainedBox),
      );
      final touchTarget = constrainedBoxes.where(
        (box) => box.constraints.minWidth >= 48 && box.constraints.minHeight >= 48,
      );
      expect(touchTarget.isNotEmpty, isTrue,
          reason: 'Should have a ConstrainedBox with ≥48dp min size');
    });

    testWidgets('has screen reader semantic label for dead letters',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(0)),
            deadCountProvider.overrideWith((_) => Stream.value(4)),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final semanticsWidgets =
          tester.widgetList<Semantics>(find.byType(Semantics));
      final syncSemantics = semanticsWidgets.where(
        (s) =>
            s.properties.label ==
            '4 failed sync commands. Tap to view and retry.',
      );
      expect(syncSemantics.length, 1);
      expect(syncSemantics.first.properties.button, isTrue);
    });

    testWidgets('has screen reader semantic label for syncing items',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(7)),
            deadCountProvider.overrideWith((_) => Stream.value(0)),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final semanticsWidgets =
          tester.widgetList<Semantics>(find.byType(Semantics));
      final syncSemantics = semanticsWidgets.where(
        (s) => s.properties.label == '7 commands syncing.',
      );
      expect(syncSemantics.length, 1);
    });

    testWidgets('navigates to SyncFailuresScreen on tap', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(1)),
            deadCountProvider.overrideWith((_) => Stream.value(2)),
            deadEntriesProvider.overrideWith((_) async => <WriteOutboxEntry>[]),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncStatusIndicator()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(InkWell));
      await tester.pumpAndSettle();

      // Should navigate to SyncFailuresScreen
      expect(find.byType(SyncFailuresScreen), findsOneWidget);
    });

    testWidgets('calls onTap callback when provided instead of navigating',
        (tester) async {
      var tapped = false;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            unsyncedCountProvider.overrideWith((_) => Stream.value(2)),
            deadCountProvider.overrideWith((_) => Stream.value(1)),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: SyncStatusIndicator(onTap: () => tapped = true),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(InkWell));
      expect(tapped, isTrue);
    });
  });

  group('SyncFailuresScreen', () {
    testWidgets('shows empty state when no dead entries', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deadEntriesProvider.overrideWith((_) async => <WriteOutboxEntry>[]),
          ],
          child: const MaterialApp(
            home: SyncFailuresScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('All synced'), findsOneWidget);
      expect(find.text('No failed commands to retry.'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
    });

    testWidgets('displays dead-lettered entries with details', (tester) async {
      final entries = [
        WriteOutboxEntry(
          id: 'entry-1',
          topic: 'hrms.leave.create',
          payload: const {'type': 'annual'},
          status: 'dead',
          retryCount: 3,
          createdAt: DateTime.now()
              .toUtc()
              .subtract(const Duration(hours: 2))
              .toIso8601String(),
          lastError: 'Server returned 500: Internal error',
          service: 'hrms',
          method: 'POST',
        ),
        WriteOutboxEntry(
          id: 'entry-2',
          topic: 'finance.payment.create',
          payload: const {'amount': 5000},
          status: 'dead',
          retryCount: 1,
          createdAt: DateTime.now()
              .toUtc()
              .subtract(const Duration(minutes: 30))
              .toIso8601String(),
          lastError: 'Validation failed: amount exceeds limit',
          service: 'finance',
          method: 'POST',
        ),
      ];

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deadEntriesProvider.overrideWith((_) async => entries),
          ],
          child: const MaterialApp(
            home: SyncFailuresScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Verify entry details are shown
      expect(find.text('hrms'), findsOneWidget);
      expect(find.text('finance'), findsOneWidget);
      expect(find.text('hrms.leave.create'), findsOneWidget);
      expect(find.text('finance.payment.create'), findsOneWidget);
      expect(find.text('Server returned 500: Internal error'), findsOneWidget);
      expect(find.text('Validation failed: amount exceeds limit'),
          findsOneWidget);
      expect(find.text('POST'), findsNWidgets(2));
      // Each entry has a Retry button
      expect(find.text('Retry'), findsNWidgets(2));
    });

    testWidgets('retry button moves entry back to pending', (tester) async {
      var retryCalledWithId = '';
      final entries = [
        WriteOutboxEntry(
          id: 'entry-retry-1',
          topic: 'hrms.attendance.mark',
          payload: const {},
          status: 'dead',
          retryCount: 3,
          createdAt: DateTime.now().toUtc().toIso8601String(),
          lastError: 'Timeout',
          service: 'hrms',
          method: 'POST',
        ),
      ];

      final fakeOutbox = _FakeWriteOutbox(
        deadEntries: entries,
        onRetryDeadCb: (id) => retryCalledWithId = id,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deadEntriesProvider.overrideWith((_) async => entries),
            writeOutboxProvider.overrideWith((_) => fakeOutbox),
          ],
          child: const MaterialApp(
            home: SyncFailuresScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Tap the retry button
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(retryCalledWithId, 'entry-retry-1');
    });

    testWidgets('shows app bar with title', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deadEntriesProvider.overrideWith((_) async => <WriteOutboxEntry>[]),
          ],
          child: const MaterialApp(
            home: SyncFailuresScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Sync Failures'), findsOneWidget);
    });

    testWidgets('retry button has ≥ 48dp touch target', (tester) async {
      final entries = [
        WriteOutboxEntry(
          id: 'entry-size-1',
          topic: 'test.action',
          payload: const {},
          status: 'dead',
          retryCount: 3,
          createdAt: DateTime.now().toUtc().toIso8601String(),
          lastError: 'Error',
          service: 'test',
          method: 'POST',
        ),
      ];

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deadEntriesProvider.overrideWith((_) async => entries),
            writeOutboxProvider.overrideWith((_) => null),
          ],
          child: const MaterialApp(
            home: SyncFailuresScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The retry button is wrapped in a SizedBox with height 48
      final sizedBoxes = tester.widgetList<SizedBox>(find.byType(SizedBox));
      final retryContainer = sizedBoxes.where((s) => s.height == 48);
      expect(retryContainer.isNotEmpty, isTrue);
    });
  });
}
