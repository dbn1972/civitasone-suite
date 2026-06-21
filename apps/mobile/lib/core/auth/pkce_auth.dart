import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Keycloak PKCE — civitasone-mobile client, deep link callback.
/// Handles transparent access-token refresh via stored refresh token.
class PkceAuthService {
  PkceAuthService({
    this.issuer = 'http://10.0.2.2:8180/realms/civitasone',
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
  static const _expiryKey = 'civitasone_at_exp';
  static const _deviceKey = 'civitasone_device_id';

  AuthorizationServiceConfiguration get _serviceConfig =>
      AuthorizationServiceConfiguration(
        authorizationEndpoint: '$issuer/protocol/openid-connect/auth',
        tokenEndpoint: '$issuer/protocol/openid-connect/token',
      );

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
        serviceConfiguration: _serviceConfig,
        scopes: ['openid', 'profile', 'email', 'offline_access'],
      ),
    );
    if (result?.accessToken != null) {
      await _storeTokens(
        accessToken: result!.accessToken!,
        refreshToken: result.refreshToken,
        expiry: result.accessTokenExpirationDateTime,
      );
    }
    return result;
  }

  /// Returns a valid access token, transparently refreshing if expired.
  /// Returns null only when no token exists or the refresh token itself has expired.
  Future<String?> accessToken() async {
    final token = await _storage.read(key: _accessKey);
    if (token == null) return null;

    final expStr = await _storage.read(key: _expiryKey);
    if (expStr != null) {
      final exp = DateTime.tryParse(expStr);
      if (exp != null &&
          DateTime.now().toUtc().isAfter(exp.subtract(const Duration(seconds: 60)))) {
        return _refreshAccessToken();
      }
    }
    return token;
  }

  Future<void> signOut() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _expiryKey);
  }

  Future<String?> _refreshAccessToken() async {
    final refreshToken = await _storage.read(key: _refreshKey);
    if (refreshToken == null) {
      await signOut();
      return null;
    }
    try {
      final result = await _appAuth.token(
        TokenRequest(
          clientId,
          redirectUrl,
          serviceConfiguration: _serviceConfig,
          grantType: 'refresh_token',
          refreshToken: refreshToken,
        ),
      );
      if (result?.accessToken != null) {
        await _storeTokens(
          accessToken: result!.accessToken!,
          refreshToken: result.refreshToken,
          expiry: result.accessTokenExpirationDateTime,
        );
        return result.accessToken;
      }
    } catch (_) {
      // Refresh token expired or revoked — force re-auth.
      await signOut();
    }
    return null;
  }

  Future<void> _storeTokens({
    required String accessToken,
    String? refreshToken,
    DateTime? expiry,
  }) async {
    await _storage.write(key: _accessKey, value: accessToken);
    if (expiry != null) {
      await _storage.write(key: _expiryKey, value: expiry.toUtc().toIso8601String());
    }
    if (refreshToken != null) {
      await _storage.write(key: _refreshKey, value: refreshToken);
    }
  }
}
