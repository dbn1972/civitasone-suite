import 'dart:convert';
import 'package:uuid/uuid.dart';
import 'sync_database.dart';
import 'sync_route_registry.dart';

/// Status values for write outbox entries.
abstract class WriteOutboxStatus {
  static const String pending = 'pending';
  static const String syncing = 'syncing';
  static const String synced = 'synced';
  static const String dead = 'dead';
}

/// A single entry in the write outbox queue.
class WriteOutboxEntry {
  const WriteOutboxEntry({
    required this.id,
    required this.topic,
    required this.payload,
    required this.status,
    required this.retryCount,
    required this.createdAt,
    this.syncedAt,
    this.lastError,
    this.service,
    this.endpoint,
    this.method,
  });

  final String id;
  final String topic;
  final Map<String, dynamic> payload;
  final String status;
  final int retryCount;
  final String createdAt;
  final String? syncedAt;
  final String? lastError;
  final String? service;
  final String? endpoint;
  final String? method;

  factory WriteOutboxEntry.fromRow(Map<String, Object?> row) {
    return WriteOutboxEntry(
      id: row['id'] as String,
      topic: row['topic'] as String,
      payload: jsonDecode(row['payload'] as String) as Map<String, dynamic>,
      status: row['status'] as String,
      retryCount: row['retry_count'] as int,
      createdAt: row['created_at'] as String,
      syncedAt: row['synced_at'] as String?,
      lastError: row['last_error'] as String?,
      service: row['service'] as String?,
      endpoint: row['endpoint'] as String?,
      method: row['method'] as String?,
    );
  }
}

/// Write-through command queue for the mobile app.
///
/// Every create/update operation in the mobile interface is enqueued here as a
/// WRITE_THROUGH_COMMANDS entry mapped to the corresponding domain service
/// command topic via the [SyncRouteRegistry].
///
/// The [WriteOutbox] persists entries in the `write_outbox` table within the
/// [SyncDatabase], ensuring commands survive app restarts and are reliably
/// pushed to domain services when connectivity is available.
///
/// **Validates: Requirements 4.1, 4.2**
class WriteOutbox {
  WriteOutbox(this._db);

  final SyncDatabase _db;
  static const _uuid = Uuid();

  /// Enqueue a write command by action key (e.g., 'leave.create').
  ///
  /// Resolves the action to a [SyncRoute] via the registry, then persists the
  /// command in the write_outbox table with status 'pending'.
  ///
  /// Throws [ArgumentError] if the action has no registered route.
  ///
  /// Returns the generated outbox entry ID.
  Future<String> enqueue({
    required String action,
    required Map<String, dynamic> payload,
  }) async {
    final route = SyncRouteRegistry.resolve(action);
    if (route == null) {
      throw ArgumentError(
        'No sync route registered for action "$action". '
        'Register it in SyncRouteRegistry before enqueuing.',
      );
    }
    return enqueueWithTopic(
      topic: route.topic,
      payload: payload,
      service: route.service,
      endpoint: route.endpoint,
      method: route.method,
    );
  }

  /// Enqueue a write command directly by topic (lower-level API).
  ///
  /// Use [enqueue] with an action key when possible — this method is provided
  /// for cases where the route is resolved externally or for testing.
  Future<String> enqueueWithTopic({
    required String topic,
    required Map<String, dynamic> payload,
    String? service,
    String? endpoint,
    String? method,
  }) async {
    final id = _uuid.v4();
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.insertWriteOutbox({
      'id': id,
      'topic': topic,
      'payload': jsonEncode(payload),
      'status': WriteOutboxStatus.pending,
      'retry_count': 0,
      'created_at': now,
      'synced_at': null,
      'last_error': null,
      'service': service,
      'endpoint': endpoint,
      'method': method ?? 'POST',
    });
    return id;
  }

  /// Get all pending entries eligible for sync push (status = 'pending').
  Future<List<WriteOutboxEntry>> getPending() async {
    final rows = await _db.queryWriteOutbox(
      where: "status = ?",
      whereArgs: [WriteOutboxStatus.pending],
      orderBy: 'created_at ASC',
    );
    return rows.map(WriteOutboxEntry.fromRow).toList();
  }

  /// Get all unsynced entries (pending + syncing — anything not yet confirmed).
  Future<List<WriteOutboxEntry>> getUnsynced() async {
    final rows = await _db.queryWriteOutbox(
      where: "status IN (?, ?)",
      whereArgs: [WriteOutboxStatus.pending, WriteOutboxStatus.syncing],
      orderBy: 'created_at ASC',
    );
    return rows.map(WriteOutboxEntry.fromRow).toList();
  }

  /// Get dead-lettered entries for display in the sync failure UI.
  Future<List<WriteOutboxEntry>> getDead() async {
    final rows = await _db.queryWriteOutbox(
      where: "status = ?",
      whereArgs: [WriteOutboxStatus.dead],
      orderBy: 'created_at DESC',
    );
    return rows.map(WriteOutboxEntry.fromRow).toList();
  }

  /// Get a single entry by ID.
  Future<WriteOutboxEntry?> getById(String id) async {
    final rows = await _db.queryWriteOutbox(
      where: "id = ?",
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return WriteOutboxEntry.fromRow(rows.first);
  }

  /// Mark an entry as currently being synced (in-flight).
  Future<void> markSyncing(String id) async {
    await _db.updateWriteOutbox(
      id,
      {'status': WriteOutboxStatus.syncing},
    );
  }

  /// Mark an entry as successfully synced — sets status and synced_at timestamp.
  Future<void> markSynced(String id) async {
    await _db.updateWriteOutbox(id, {
      'status': WriteOutboxStatus.synced,
      'synced_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  /// Move an entry to the dead-letter store with an error message.
  ///
  /// Used when:
  /// - Server returns a non-retryable 4xx (excl 401/429)
  /// - Retry cap exceeded after transient failures
  Future<void> moveToDead(String id, String error) async {
    await _db.updateWriteOutbox(id, {
      'status': WriteOutboxStatus.dead,
      'last_error': error,
    });
  }

  /// Increment the retry count for a failed sync attempt.
  Future<void> incrementRetry(String id, String error) async {
    final entry = await getById(id);
    if (entry == null) return;
    await _db.updateWriteOutbox(id, {
      'retry_count': entry.retryCount + 1,
      'last_error': error,
      'status': WriteOutboxStatus.pending, // back to pending for next attempt
    });
  }

  /// Reset a dead-lettered entry back to pending for manual retry.
  Future<void> retryDead(String id) async {
    await _db.updateWriteOutbox(id, {
      'status': WriteOutboxStatus.pending,
      'last_error': null,
    });
  }

  /// Count of unsynced (pending + syncing) entries.
  Future<int> get unsyncedCount async {
    final rows = await _db.queryWriteOutbox(
      where: "status IN (?, ?)",
      whereArgs: [WriteOutboxStatus.pending, WriteOutboxStatus.syncing],
    );
    return rows.length;
  }

  /// Count of dead-lettered entries.
  Future<int> get deadCount async {
    final rows = await _db.queryWriteOutbox(
      where: "status = ?",
      whereArgs: [WriteOutboxStatus.dead],
    );
    return rows.length;
  }

  /// Remove synced entries older than [age] to keep the database lean.
  Future<int> purge({Duration age = const Duration(days: 7)}) async {
    final cutoff = DateTime.now().toUtc().subtract(age).toIso8601String();
    return _db.deleteWriteOutbox(
      where: "status = ? AND synced_at < ?",
      whereArgs: [WriteOutboxStatus.synced, cutoff],
    );
  }
}
