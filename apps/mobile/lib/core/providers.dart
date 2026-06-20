import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'auth/pkce_auth.dart';
import 'sync/sync_database.dart';
import 'sync/sync_engine.dart';

final apiBaseProvider = Provider<String>(
  (_) => const String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:8080'),
);

final authProvider = Provider<PkceAuthService>((_) => PkceAuthService());

final dbProvider = FutureProvider<SyncDatabase>((ref) => SyncDatabase.open());

final syncEngineProvider = Provider<SyncEngine?>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return null;
  return SyncEngine(db: db, auth: ref.read(authProvider), apiBase: ref.read(apiBaseProvider));
});
