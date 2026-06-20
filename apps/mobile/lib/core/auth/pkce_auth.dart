import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Keycloak PKCE — civitasone-mobile client, deep link callback.
class PkceAuthService {
  PkceAuthService({
    this.issuer = 'http://localhost:8180/realms/civitasone',
    this.clientId = 'civitasone-mobile',
    this.redirectUrl = 'civitasone://auth/callback',
    FlutterAppAuth? appAuth,
    FlutterSecureStorage? storage,
  })  : _appAuth = appAuth ?? const FlutterAppAuth(),
        _storage = storage ?? const FlutterSecureStorage();

  final String issuer;
  final String clientId;
  final String redirectUrl;
  final FlutterAppAuth _appAuth;
  final FlutterSecureStorage _storage;

  static const _accessKey = 'civitasone_at';
  static const _refreshKey = 'civitasone_rt';
  static const _deviceKey = 'civitasone_device_id';

  Future<String> getOrCreateDeviceId() async {
    final existing = await _storage.read(key: _deviceKey);
    if (existing != null) return existing;
    final id = const Uuid().v4();
    await _storage.write(key: _deviceKey, value: id);
    return id;
  }

  Future<AuthorizationTokenResponse?> signIn() async {
    final result = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        clientId,
        redirectUrl,
        serviceConfiguration: AuthorizationServiceConfiguration(
          authorizationEndpoint: '$issuer/protocol/openid-connect/auth',
          tokenEndpoint: '$issuer/protocol/openid-connect/token',
        ),
        scopes: ['openid', 'profile', 'email', 'offline_access'],
      ),
    );
    if (result?.accessToken != null) {
      await _storage.write(key: _accessKey, value: result!.accessToken!);
      if (result.refreshToken != null) {
        await _storage.write(key: _refreshKey, value: result.refreshToken!);
      }
    }
    return result;
  }

  Future<String?> accessToken() => _storage.read(key: _accessKey);

  Future<void> signOut() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}
