import 'dart:convert';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

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
    return _db.query('outbox', where: 'mailbox = ? AND status IN (?, ?)', whereArgs: [mailbox, 'queued', 'failed']);
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
