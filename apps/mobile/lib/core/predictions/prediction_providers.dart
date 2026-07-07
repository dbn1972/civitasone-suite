import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers.dart';
import 'prediction_cache.dart';
import 'prediction_data.dart';

/// Provides the [PredictionCache] instance scoped to the current session's
/// [SyncDatabase]. Returns null when no session is active.
final predictionCacheProvider = Provider<PredictionCache?>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return null;
  return PredictionCache(db);
});

/// Retrieves a cached prediction for a specific entity and domain.
/// Returns null when offline and no cached prediction exists.
///
/// Usage:
/// ```dart
/// final prediction = ref.watch(
///   predictionProvider(('lead-123', 'leads')),
/// );
/// ```
final predictionProvider =
    FutureProvider.family<PredictionData?, (String entityId, String domain)>(
  (ref, params) async {
    final cache = ref.watch(predictionCacheProvider);
    if (cache == null) return null;
    final (entityId, domain) = params;
    return cache.get(entityId, domain);
  },
);

/// Retrieves all cached predictions for a given domain.
final predictionsByDomainProvider =
    FutureProvider.family<List<PredictionData>, String>(
  (ref, domain) async {
    final cache = ref.watch(predictionCacheProvider);
    if (cache == null) return [];
    return cache.listByDomain(domain);
  },
);
