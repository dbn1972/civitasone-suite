import 'package:dio/dio.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../auth/pkce_auth.dart';
import 'sync_database.dart';

/// Gmail-style sync — SQLite outbox push then delta pull (mirrors web IndexedDB).
class SyncEngine {
  SyncEngine({
    required this.db,
    required this.auth,
    required this.apiBase,
    Dio? dio,
  }) : _dio = dio ?? Dio(BaseOptions(baseUrl: apiBase));

  final SyncDatabase db;
  final PkceAuthService auth;
  final String apiBase;
  final Dio _dio;

  Future<Map<String, String>> _headers() async {
    final token = await auth.accessToken();
    final deviceId = await auth.getOrCreateDeviceId();
    return {
      if (token != null) 'authorization': 'Bearer $token',
      'x-device-id': deviceId,
      'content-type': 'application/json',
    };
  }

  Future<bool> get isOnline async {
    final r = await Connectivity().checkConnectivity();
    return r.isNotEmpty && r.first != ConnectivityResult.none;
  }

  Future<void> syncMailbox(String mailbox) async {
    if (!await isOnline) return;
    final headers = await _headers();
    final deviceId = await auth.getOrCreateDeviceId();
    var cursor = await db.getCursor(mailbox);

    final outbox = await db.listOutbox(mailbox);
    if (outbox.isNotEmpty) {
      final pushRes = await _dio.post('/api/v1/sync/push', data: {
        'deviceId': deviceId,
        'mailbox': mailbox,
        'cursor': cursor,
        'mutations': outbox.map((e) => {
          'clientMutationId': e['id'],
          'operation': e['operation'],
          'entityId': e['id'],
          'payload': {},
          'clientUpdatedAt': e['created_at'],
        }).toList(),
      }, options: Options(headers: headers));
      cursor = pushRes.data['cursor'] as String? ?? cursor;
      await db.setCursor(mailbox, cursor);
    }

    final pullRes = await _dio.post('/api/v1/sync/pull', data: {
      'deviceId': deviceId,
      'mailbox': mailbox,
      'cursor': cursor,
      'limit': 100,
    }, options: Options(headers: headers));

    final entities = pullRes.data['entities'] as List<dynamic>? ?? [];
    for (final item in entities) {
      if (item['operation'] == 'delete') continue;
      await db.upsertEntity(
        id: item['id'] as String,
        mailbox: mailbox,
        data: (item['data'] as Map<String, dynamic>?) ?? {},
        updatedAt: item['updatedAt'] as String,
        etag: item['etag'] as String?,
      );
    }
    await db.setCursor(mailbox, pullRes.data['cursor'] as String? ?? cursor);
  }
}
