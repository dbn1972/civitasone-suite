import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'auth/pkce_auth.dart';
import 'sync/sync_database.dart';
import 'sync/sync_engine.dart';

final apiBaseProvider = Provider<String>(
  (_) => const String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:8080'),
);

/// Keycloak issuer URL — override via --dart-define=KEYCLOAK_ISSUER=https://...
final keycloakIssuerProvider = Provider<String>(
  (_) => const String.fromEnvironment(
    'KEYCLOAK_ISSUER',
    defaultValue: 'http://10.0.2.2:8180/realms/civitasone',
  ),
);

final authProvider = Provider<PkceAuthService>((ref) {
  return PkceAuthService(issuer: ref.read(keycloakIssuerProvider));
});

final dbProvider = FutureProvider<SyncDatabase>((ref) => SyncDatabase.open());

final syncEngineProvider = Provider<SyncEngine?>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return null;
  return SyncEngine(
    db: db,
    auth: ref.read(authProvider),
    apiBase: ref.read(apiBaseProvider),
  );
});
