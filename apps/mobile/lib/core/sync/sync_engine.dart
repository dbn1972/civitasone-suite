import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../auth/pkce_auth.dart';
import 'sync_database.dart';

/// Gmail-style sync — SQLite outbox push (real payloads) then delta pull.
class SyncEngine {
  SyncEngine({
    required this.db,
    required this.auth,
    required this.apiBase,
    Dio? dio,
    Future<bool> Function()? isOnlineOverride,
  })  : _dio = dio ?? Dio(BaseOptions(baseUrl: apiBase)),
        _isOnlineOverride = isOnlineOverride;

  final SyncDatabase db;
  final PkceAuthService auth;
  final String apiBase;
  final Dio _dio;
  final Future<bool> Function()? _isOnlineOverride;

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
    if (_isOnlineOverride != null) return _isOnlineOverride!();
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
      try {
        final pushRes = await _dio.post('/api/v1/sync/push', data: {
          'deviceId': deviceId,
          'mailbox': mailbox,
          'cursor': cursor,
          'mutations': outbox.map((e) {
            final payload =
                jsonDecode(e['payload_json'] as String) as Map<String, dynamic>;
            return {
              'clientMutationId': e['id'],
              'operation': e['operation'],
              'entityId': e['entity_id'] as String? ?? payload['entityId'] ?? e['id'],
              'payload': payload,
              'clientUpdatedAt': e['created_at'],
            };
          }).toList(),
        }, options: Options(headers: headers));

        cursor = pushRes.data['cursor'] as String? ?? cursor;
        await db.setCursor(mailbox, cursor);

        // Reconcile per-mutation results from the server.
        final results = pushRes.data['results'] as List<dynamic>? ?? [];
        if (results.isEmpty) {
          // Server returned no per-mutation results — treat all as done.
          for (final e in outbox) {
            await db.markOutboxDone(e['id'] as String);
          }
        } else {
          final resultMap = {
            for (final r in results)
              (r as Map<String, dynamic>)['clientMutationId'] as String: r,
          };
          for (final e in outbox) {
            final id = e['id'] as String;
            final result = resultMap[id];
            if (result == null || result['success'] == true) {
              await db.markOutboxDone(id);
            } else {
              await db.markOutboxFailed(
                  id, result['error'] as String? ?? 'server_rejected');
            }
          }
        }
      } on DioException catch (err) {
        // Network error — leave outbox entries as queued for next sync.
        for (final e in outbox) {
          await db.markOutboxFailed(
              e['id'] as String, err.message ?? 'network_error');
        }
        return;
      }
    }

    try {
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
    } on DioException {
      // Pull failure is non-fatal — cached data remains valid.
    }
  }
}
