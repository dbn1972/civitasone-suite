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
          'mutations': await Future.wait(outbox.map((e) async {
            final payload =
                jsonDecode(e['payload_json'] as String) as Map<String, dynamic>;
            final entityId =
                e['entity_id'] as String? ?? payload['entityId'] as String? ?? e['id'] as String;
            // 02-T4: attach last-known etag so the server can detect a stale edit.
            final baseEtag = await db.getEntityEtag(entityId);
            return {
              'clientMutationId': e['id'],
              'operation': e['operation'],
              'entityId': entityId,
              'payload': payload,
              'clientUpdatedAt': e['created_at'],
              if (baseEtag != null) 'baseEtag': baseEtag,
            };
          })),
        }, options: Options(headers: headers));

        cursor = pushRes.data['cursor'] as String? ?? cursor;
        await db.setCursor(mailbox, cursor);

        // 02-T6: reconcile per-mutation results by clientMutationId. NEVER infer
        // success from an empty array — an unacknowledged mutation stays queued.
        final results = (pushRes.data['results'] as List<dynamic>? ?? [])
            .cast<Map<String, dynamic>>();
        final resultMap = {
          for (final r in results) r['clientMutationId'] as String: r,
        };
        for (final e in outbox) {
          final id = e['id'] as String;
          final result = resultMap[id];
          if (result == null) {
            // No acknowledgement for this mutation — leave it queued to retry.
            continue;
          }
          final status = result['status'] as String?;
          if (status == 'applied') {
            await db.markOutboxDone(id);
          } else if (status == 'conflict') {
            // 02-T4: stop retrying and adopt the server's current state.
            await db.markOutboxFailed(id, result['reason'] as String? ?? 'conflict', permanent: true);
            final serverData = result['serverData'] as Map<String, dynamic>?;
            if (serverData != null) {
              await db.upsertEntity(
                id: (serverData['id'] as String?) ?? (e['entity_id'] as String? ?? id),
                mailbox: mailbox,
                data: serverData,
                updatedAt: DateTime.now().toUtc().toIso8601String(),
                etag: result['etag'] as String?,
                syncState: 'conflict',
              );
            }
          } else {
            // failed — retryable with backoff (dead-letters at the cap).
            await db.markOutboxFailed(id, result['reason'] as String? ?? 'server_rejected');
          }
        }
      } on DioException catch (err) {
        // Network error — backoff/retry; dead-letters at the cap.
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
        final entityId = item['id'] as String;
        if (item['operation'] == 'delete') {
          // 02-T5: apply server-side tombstone locally.
          await db.deleteEntity(entityId);
          continue;
        }
        // 02-T4: don't clobber a local row that has a pending outbox edit.
        if (await db.hasPendingOutboxForEntity(entityId)) continue;
        await db.upsertEntity(
          id: entityId,
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
