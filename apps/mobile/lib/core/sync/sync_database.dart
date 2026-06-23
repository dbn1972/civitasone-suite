import 'dart:convert';
import 'dart:math';
import 'package:path/path.dart';
// MOB-1a (02-T1): sqflite_sqlcipher is a drop-in for sqflite that adds at-rest
// encryption via `password:` (PRAGMA key). It re-exports the same Database /
// openDatabase / ConflictAlgorithm symbols, so the rest of this file is unchanged.
import 'package:sqflite_sqlcipher/sqflite.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Max outbox attempts before a mutation is dead-lettered (MOB-1c / 02-T3).
const int kMaxOutboxRetries = 5;

/// Gmail-style SQLite cache — mailboxes, entities, outbox (native mobile).
/// Encrypted at rest; namespaced per tenant+user so switching accounts never
/// mixes data (02-T1 / 02-T2).
class SyncDatabase {
  SyncDatabase._(this._db, this._dbPath);
  final Database _db;
  final String? _dbPath;

  static SyncDatabase? _instance;
  static const _keyStorageKey = 'civitasone_db_key';
  static const _dbVersion = 2;

  /// Resolve (or create) the random 256-bit DB encryption key from the secure
  /// keystore. The key never leaves the device.
  static Future<String> _dbKey(FlutterSecureStorage storage) async {
    var key = await storage.read(key: _keyStorageKey);
    if (key == null || key.isEmpty) {
      final rnd = Random.secure();
      final bytes = List<int>.generate(32, (_) => rnd.nextInt(256));
      key = base64UrlEncode(bytes);
      await storage.write(key: _keyStorageKey, value: key);
    }
    return key;
  }

  /// Build the per-account DB file name. Falls back to a shared name pre-login.
  static String _fileFor(String namespace) {
    final safe = namespace.isEmpty ? 'default' : namespace.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'civitasone_$safe.sqlite';
  }

  /// Open the encrypted, account-namespaced database.
  /// [namespace] should be `tenantId:userId` once known (02-T2 tenant scoping).
  static Future<SyncDatabase> open({String namespace = 'default', FlutterSecureStorage? storage}) async {
    if (_instance != null) return _instance!;
    final store = storage ?? const FlutterSecureStorage();
    final key = await _dbKey(store);
    final path = join(await getDatabasesPath(), _fileFor(namespace));
    final db = await openDatabase(
      path,
      password: key,
      version: _dbVersion,
      onCreate: (db, _) async {
        await _createSchema(db);
      },
      onUpgrade: (db, _, __) async {
        await _createSchema(db);
      },
    );
    _instance = SyncDatabase._(db, path);
    return _instance!;
  }

  static Future<void> _createSchema(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS mailboxes (
        mailbox TEXT PRIMARY KEY,
        cursor TEXT NOT NULL DEFAULT '0',
        last_synced_at TEXT NOT NULL
      )''');
    await db.execute('''
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        mailbox TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        etag TEXT,
        sync_state TEXT NOT NULL DEFAULT 'synced'
      )''');
    await db.execute('''
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        mailbox TEXT NOT NULL,
        operation TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT
      )''');
    await db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // 02-T7: index hygiene for the hot list queries.
    await db.execute('CREATE INDEX IF NOT EXISTS idx_entities_mailbox_updated ON entities (mailbox, updated_at)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_outbox_mailbox_status ON outbox (mailbox, status)');
  }

  /// For testing: open an in-memory database (no singleton, no encryption).
  static Future<SyncDatabase> openInMemory(Database db) async {
    await _createSchema(db);
    return SyncDatabase._(db, null);
  }

  /// SEC / 02-T2: wipe local data on logout / tenant switch. Closes the DB,
  /// deletes the file, and resets the singleton so the next login opens fresh.
  static Future<void> wipe() async {
    final inst = _instance;
    _instance = null;
    if (inst == null) return;
    final path = inst._dbPath;
    try {
      await inst._db.close();
    } catch (_) {/* already closed */}
    if (path != null) {
      try {
        await deleteDatabase(path);
      } catch (_) {/* best-effort */}
    }
  }

  Future<String> getCursor(String mailbox) async {
    final rows = await _db.query('mailboxes', where: 'mailbox = ?', whereArgs: [mailbox], limit: 1);
    return rows.isEmpty ? '0' : rows.first['cursor'] as String;
  }

  Future<void> setCursor(String mailbox, String cursor) async {
    await _db.insert('mailboxes', {
      'mailbox': mailbox,
      'cursor': cursor,
      'last_synced_at': DateTime.now().toUtc().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// Outbox entries eligible to push now: queued/failed, NOT dead-lettered, and
  /// past their backoff window (MOB-1c / 02-T3).
  Future<List<Map<String, Object?>>> listOutbox(String mailbox) async {
    final nowIso = DateTime.now().toUtc().toIso8601String();
    return _db.query(
      'outbox',
      where: "mailbox = ? AND status IN ('queued', 'failed') AND retry_count < ? "
          "AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      whereArgs: [mailbox, kMaxOutboxRetries, nowIso],
    );
  }

  /// Enqueue a mutation into the outbox. Returns the outbox entry ID.
  Future<String> enqueueOutbox({
    required String mailbox,
    required String operation,
    required String entityId,
    required Map<String, dynamic> payload,
  }) async {
    final id = const Uuid().v4();
    await _db.insert('outbox', {
      'id': id,
      'mailbox': mailbox,
      'operation': operation,
      'entity_id': entityId,
      'payload_json': jsonEncode(payload),
      'created_at': DateTime.now().toUtc().toIso8601String(),
      'status': 'queued',
      'retry_count': 0,
    });
    return id;
  }

  /// Mark an outbox entry as successfully synced — removes it from the queue.
  Future<void> markOutboxDone(String id) async {
    await _db.delete('outbox', where: 'id = ?', whereArgs: [id]);
  }

  /// Mark an outbox entry as failed — increments retry count, schedules an
  /// exponential backoff, and dead-letters once the retry cap is reached
  /// (MOB-1c / 02-T3). Use [permanent] for conflicts/validation that must not retry.
  Future<void> markOutboxFailed(String id, String error, {bool permanent = false}) async {
    final rows = await _db.query('outbox', columns: ['retry_count'], where: 'id = ?', whereArgs: [id], limit: 1);
    final retryCount = (rows.isEmpty ? 0 : rows.first['retry_count'] as int) + 1;
    final deadLettered = permanent || retryCount >= kMaxOutboxRetries;
    // Exponential backoff with jitter: 2^n seconds capped at ~5 min.
    final backoffSecs = min(300, pow(2, retryCount).toInt()) + Random().nextInt(5);
    final nextAttempt = DateTime.now().toUtc().add(Duration(seconds: backoffSecs)).toIso8601String();
    await _db.update(
      'outbox',
      {
        'status': deadLettered ? 'dead' : 'failed',
        'last_error': error,
        'retry_count': retryCount,
        'next_attempt_at': nextAttempt,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  /// 02-T4: is there a pending (queued/failed) outbox edit for this entity?
  /// Used to avoid clobbering a local edit during pull.
  Future<bool> hasPendingOutboxForEntity(String entityId) async {
    final rows = await _db.query(
      'outbox',
      columns: ['id'],
      where: "entity_id = ? AND status IN ('queued', 'failed')",
      whereArgs: [entityId],
      limit: 1,
    );
    return rows.isNotEmpty;
  }

  /// 02-T4: the last-known etag for an entity (sent as baseEtag on push).
  Future<String?> getEntityEtag(String entityId) async {
    final rows = await _db.query('entities', columns: ['etag'], where: 'id = ?', whereArgs: [entityId], limit: 1);
    return rows.isEmpty ? null : rows.first['etag'] as String?;
  }

  /// Fetch a single outbox entry by id (inspection / tests).
  Future<Map<String, Object?>?> getOutboxEntry(String id) async {
    final rows = await _db.query('outbox', where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<void> upsertEntity({
    required String id,
    required String mailbox,
    required Map<String, dynamic> data,
    required String updatedAt,
    String? etag,
    String syncState = 'synced',
  }) async {
    await _db.insert('entities', {
      'id': id,
      'mailbox': mailbox,
      'data_json': jsonEncode(data),
      'updated_at': updatedAt,
      'etag': etag,
      'sync_state': syncState,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// 02-T5: remove a locally-cached entity (applied from a server tombstone).
  Future<void> deleteEntity(String id) async {
    await _db.delete('entities', where: 'id = ?', whereArgs: [id]);
  }

  Future<String?> getMeta(String key) async {
    final rows = await _db.query('meta', where: 'key = ?', whereArgs: [key], limit: 1);
    return rows.isEmpty ? null : rows.first['value'] as String;
  }

  Future<void> setMeta(String key, String value) async {
    await _db.insert('meta', {'key': key, 'value': value}, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<Map<String, dynamic>>> listEntities(String mailbox) async {
    final rows = await _db.query(
      'entities',
      where: 'mailbox = ?',
      whereArgs: [mailbox],
      orderBy: 'updated_at DESC',
    );
    return rows.map((row) => {
      'id': row['id'] as String,
      'mailbox': row['mailbox'] as String,
      'data': jsonDecode(row['data_json'] as String) as Map<String, dynamic>,
      'updated_at': row['updated_at'] as String,
      'etag': row['etag'],
      'sync_state': row['sync_state'] as String,
    }).toList();
  }
}
