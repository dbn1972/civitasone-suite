import 'dart:convert';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

/// Gmail-style SQLite cache — mailboxes, entities, outbox (native mobile).
class SyncDatabase {
  SyncDatabase._(this._db);
  final Database _db;

  static SyncDatabase? _instance;

  static Future<SyncDatabase> open() async {
    if (_instance != null) return _instance!;
    final path = join(await getDatabasesPath(), 'civitasone.sqlite');
    final db = await openDatabase(path, version: 1, onCreate: (db, _) async {
      await db.execute('''
        CREATE TABLE mailboxes (
          mailbox TEXT PRIMARY KEY,
          cursor TEXT NOT NULL DEFAULT '0',
          last_synced_at TEXT NOT NULL
        )''');
      await db.execute('''
        CREATE TABLE entities (
          id TEXT PRIMARY KEY,
          mailbox TEXT NOT NULL,
          data_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          etag TEXT,
          sync_state TEXT NOT NULL DEFAULT 'synced'
        )''');
      await db.execute('''
        CREATE TABLE outbox (
          id TEXT PRIMARY KEY,
          mailbox TEXT NOT NULL,
          operation TEXT NOT NULL,
          entity_id TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        )''');
      await db.execute('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    });
    _instance = SyncDatabase._(db);
    return _instance!;
  }

  /// For testing: open an in-memory database (no singleton).
  static Future<SyncDatabase> openInMemory(Database db) async {
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
        last_error TEXT
      )''');
    await db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    return SyncDatabase._(db);
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

  Future<List<Map<String, Object?>>> listOutbox(String mailbox) async {
    return _db.query('outbox',
        where: 'mailbox = ? AND status IN (?, ?)', whereArgs: [mailbox, 'queued', 'failed']);
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

  /// Mark an outbox entry as failed — increments retry count.
  Future<void> markOutboxFailed(String id, String error) async {
    await _db.rawUpdate(
      'UPDATE outbox SET status = ?, last_error = ?, retry_count = retry_count + 1 WHERE id = ?',
      ['failed', error, id],
    );
  }

  Future<void> upsertEntity({
    required String id,
    required String mailbox,
    required Map<String, dynamic> data,
    required String updatedAt,
    String? etag,
  }) async {
    await _db.insert('entities', {
      'id': id,
      'mailbox': mailbox,
      'data_json': jsonEncode(data),
      'updated_at': updatedAt,
      'etag': etag,
      'sync_state': 'synced',
    }, conflictAlgorithm: ConflictAlgorithm.replace);
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
