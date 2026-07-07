import '../sync/sync_database.dart';
import 'prediction_data.dart';

/// Local cache for ML predictions stored alongside entity data in SQLite.
///
/// Predictions are cached during sync and served from local storage while
/// offline. Stale predictions (> 1 hour) are still displayed with a
/// staleness indicator until fresh data arrives.
///
/// Uses the same encrypted SQLite database as the sync engine (SyncDatabase).
///
/// **Validates: Requirements 22.6, 25.3**
class PredictionCache {
  PredictionCache(this._db);
  final SyncDatabase _db;

  /// Retrieve the cached prediction for a given entity and domain.
  /// Returns null if no prediction is cached.
  Future<PredictionData?> get(String entityId, String domain) async {
    final entities = await _db.listEntities('predictions');
    final key = _cacheKey(entityId, domain);
    final match = entities.where((e) => e['id'] == key).toList();
    if (match.isEmpty) return null;
    final data = match.first['data'] as Map<String, dynamic>;
    return PredictionData.fromJson(data);
  }

  /// Retrieve all cached predictions for a given domain.
  Future<List<PredictionData>> listByDomain(String domain) async {
    final entities = await _db.listEntities('predictions');
    return entities
        .where((e) {
          final data = e['data'] as Map<String, dynamic>;
          return data['domain'] == domain;
        })
        .map((e) => PredictionData.fromJson(e['data'] as Map<String, dynamic>))
        .toList();
  }

  /// Cache a prediction locally. Overwrites any existing prediction for the
  /// same entity+domain combination.
  Future<void> put(PredictionData prediction) async {
    final key = _cacheKey(prediction.entityId, prediction.domain);
    await _db.upsertEntity(
      id: key,
      mailbox: 'predictions',
      data: prediction.toJson(),
      updatedAt: prediction.computedAt.toIso8601String(),
    );
  }

  /// Batch-cache multiple predictions (used during sync pull).
  Future<void> putAll(List<PredictionData> predictions) async {
    for (final prediction in predictions) {
      await put(prediction);
    }
  }

  /// Remove a cached prediction.
  Future<void> remove(String entityId, String domain) async {
    final key = _cacheKey(entityId, domain);
    await _db.deleteEntity(key);
  }

  /// Remove all cached predictions (used on logout/tenant switch).
  Future<void> clear() async {
    final entities = await _db.listEntities('predictions');
    for (final entity in entities) {
      await _db.deleteEntity(entity['id'] as String);
    }
  }

  /// Construct a deterministic cache key for a prediction.
  static String _cacheKey(String entityId, String domain) =>
      'prediction:$domain:$entityId';
}
