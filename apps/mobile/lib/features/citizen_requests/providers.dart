import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import 'models.dart';

/// All citizen requests, sorted by creation date (newest first).
final citizenRequestsProvider =
    FutureProvider.autoDispose<List<CitizenRequest>>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('citizen_requests');
  final entities = await db.listEntities('citizen_requests');
  return entities
      .map((e) =>
          CitizenRequest.fromJson(e['data'] as Map<String, dynamic>))
      .toList()
    ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
});

/// Single citizen request by ID.
final citizenRequestByIdProvider =
    FutureProvider.autoDispose.family<CitizenRequest?, String>((ref, id) async {
  final requests = await ref.watch(citizenRequestsProvider.future);
  try {
    return requests.firstWhere((r) => r.id == id);
  } catch (_) {
    return null;
  }
});

/// Requests with breached SLA.
final slaBreachedRequestsProvider =
    FutureProvider.autoDispose<List<CitizenRequest>>((ref) async {
  final requests = await ref.watch(citizenRequestsProvider.future);
  return requests.where((r) => r.isSlaBreached).toList();
});
