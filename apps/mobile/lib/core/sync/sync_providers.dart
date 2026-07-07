import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers.dart';
import 'write_outbox.dart';

/// Provides the [WriteOutbox] instance scoped to the current session's
/// [SyncDatabase]. Returns null when no session is active.
final writeOutboxProvider = Provider<WriteOutbox?>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return null;
  return WriteOutbox(db);
});

/// Reactively watches the count of unsynced (pending + syncing) outbox entries.
/// Polls every 2 seconds to keep the badge up to date without excessive DB load.
///
/// Returns 0 when no session is active.
final unsyncedCountProvider = StreamProvider<int>((ref) {
  final outbox = ref.watch(writeOutboxProvider);
  if (outbox == null) return Stream.value(0);

  return Stream.periodic(const Duration(seconds: 2), (_) => null)
      .asyncMap((_) => outbox.unsyncedCount)
      .distinct();
});

/// Reactively watches the count of dead-lettered entries.
/// Polls every 2 seconds aligned with [unsyncedCountProvider].
///
/// Returns 0 when no session is active.
final deadCountProvider = StreamProvider<int>((ref) {
  final outbox = ref.watch(writeOutboxProvider);
  if (outbox == null) return Stream.value(0);

  return Stream.periodic(const Duration(seconds: 2), (_) => null)
      .asyncMap((_) => outbox.deadCount)
      .distinct();
});

/// Provides the list of dead-lettered entries for the SyncFailuresScreen.
/// Refreshes when the screen is opened or after a retry action.
final deadEntriesProvider = FutureProvider<List<WriteOutboxEntry>>((ref) async {
  final outbox = ref.watch(writeOutboxProvider);
  if (outbox == null) return [];
  return outbox.getDead();
});
