import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import 'models.dart';

/// All check-in records for the current user, sorted newest first.
final attendanceRecordsProvider =
    FutureProvider.autoDispose<List<CheckInRecord>>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('attendance');
  final entities = await db.listEntities('attendance');
  return entities
      .map((e) => CheckInRecord.fromJson(e['data'] as Map<String, dynamic>))
      .toList()
    ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
});

/// Configured geo-sites for the current tenant.
final geoSitesProvider =
    FutureProvider.autoDispose<List<GeoSite>>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final engine = ref.read(syncEngineProvider);
  await engine?.syncMailbox('geo_sites');
  final entities = await db.listEntities('geo_sites');
  return entities
      .map((e) => GeoSite.fromJson(e['data'] as Map<String, dynamic>))
      .toList();
});

/// Latest check-in record (to determine if user is checked in or out).
final latestCheckInProvider =
    FutureProvider.autoDispose<CheckInRecord?>((ref) async {
  final records = await ref.watch(attendanceRecordsProvider.future);
  return records.isNotEmpty ? records.first : null;
});
