import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api_client.dart';
import 'auth/pkce_auth.dart';
import 'sync/sync_database.dart';
import 'sync/sync_engine.dart';

// Fix: [AUDIT-P0-2] Remove hardcoded emulator URLs — fail-fast on missing config
class AppConfig {
  AppConfig._();

  static String get apiBaseUrl {
    const env = String.fromEnvironment('API_BASE');
    if (env.isNotEmpty) return env;
    if (kDebugMode) return 'http://10.0.2.2:8080'; // Android emulator only
    throw StateError('API_BASE_URL not configured for production build');
  }

  static String get keycloakUrl {
    const env = String.fromEnvironment('KEYCLOAK_ISSUER');
    if (env.isNotEmpty) return env;
    if (kDebugMode) return 'http://10.0.2.2:8180/realms/civitasone'; // Android emulator only
    throw StateError('KEYCLOAK_URL not configured for production build');
  }
}

final apiBaseProvider = Provider<String>(
  (_) => AppConfig.apiBaseUrl,
);

/// Keycloak issuer URL — override via --dart-define=KEYCLOAK_ISSUER=https://...
final keycloakIssuerProvider = Provider<String>(
  (_) => AppConfig.keycloakUrl,
);

final authProvider = Provider<PkceAuthService>((ref) {
  return PkceAuthService(issuer: ref.read(keycloakIssuerProvider));
});

/// Dio-based API client with auth token injection, 401 handling, and offline queue.
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: ref.read(apiBaseProvider),
    auth: ref.read(authProvider),
  );
});

/// Authenticated session state: holds the current tenant+user context.
/// When this changes, the [syncDbProvider] will close the old partition and
/// open the new one (Requirement 4.4).
class AuthSession {
  const AuthSession({required this.tenantId, required this.userId});
  final String tenantId;
  final String userId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthSession && tenantId == other.tenantId && userId == other.userId;

  @override
  int get hashCode => Object.hash(tenantId, userId);
}

/// Holds the current authenticated session (tenant+user). Set after login,
/// cleared on logout. Drives [syncDbProvider] lifecycle.
final authSessionProvider = StateProvider<AuthSession?>((ref) => null);

/// Opens (or switches) the SyncDatabase partition for the authenticated session.
/// Returns null when no session is active (Requirement 4.3, 4.4).
final syncDbProvider = FutureProvider<SyncDatabase?>((ref) async {
  final session = ref.watch(authSessionProvider);
  if (session == null) {
    // No active session — close any open partition.
    await SyncDatabase.closePartition();
    return null;
  }
  // switchAccount handles: close old partition → clear memory → open new.
  return SyncDatabase.switchAccount(
    tenantId: session.tenantId,
    userId: session.userId,
  );
});

/// Legacy provider for backward compatibility (pre-login default DB).
final dbProvider = FutureProvider<SyncDatabase>((ref) {
  final session = ref.watch(authSessionProvider);
  if (session != null) {
    return SyncDatabase.openForAccount(
      tenantId: session.tenantId,
      userId: session.userId,
    );
  }
  return SyncDatabase.open();
});

final syncEngineProvider = Provider<SyncEngine?>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return null;
  return SyncEngine(
    db: db,
    auth: ref.read(authProvider),
    apiBase: ref.read(apiBaseProvider),
  );
});
