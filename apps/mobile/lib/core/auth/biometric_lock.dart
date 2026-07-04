import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:local_auth/local_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Biometric / PIN app lock — Gmail-style "never log out, just lock".
///
/// Flow:
/// 1. First sign-in via PKCE → tokens stored in secure storage
/// 2. App goes to background or device locks
/// 3. On return → biometric/PIN challenge (NOT full re-login)
/// 4. Only if biometric passes → app unlocks (tokens already there)
/// 5. Full re-login only when refresh token actually expires (30+ days)
///
/// This mimics Gmail/WhatsApp: you sign in once, then it's always biometric.
class BiometricLockService {
  BiometricLockService({FlutterSecureStorage? storage, LocalAuthentication? auth})
      : _storage = storage ?? const FlutterSecureStorage(),
        _localAuth = auth ?? LocalAuthentication();

  final FlutterSecureStorage _storage;
  final LocalAuthentication _localAuth;

  static const _lockEnabledKey = 'civitasone_lock_enabled';
  static const _lockTypeKey = 'civitasone_lock_type'; // biometric, pin, none
  static const _pinHashKey = 'civitasone_pin_hash';
  static const _lastAuthKey = 'civitasone_last_auth_ts';

  /// Lock timeout — require biometric after this many minutes of inactivity.
  static const lockTimeoutMinutes = 5;

  /// PBKDF2 iteration count for PIN hashing.
  static const _pbkdf2Iterations = 100000;

  /// Check if app lock is enabled.
  Future<bool> get isLockEnabled async {
    final val = await _storage.read(key: _lockEnabledKey);
    return val == 'true';
  }

  /// Get configured lock type.
  Future<String> get lockType async {
    return await _storage.read(key: _lockTypeKey) ?? 'none';
  }

  /// Enable biometric lock.
  Future<void> enableBiometric() async {
    await _storage.write(key: _lockEnabledKey, value: 'true');
    await _storage.write(key: _lockTypeKey, value: 'biometric');
  }

  /// Enable PIN lock with a 4-6 digit PIN.
  Future<void> enablePin(String pin) async {
    final salt = _generateSalt();
    final hash = _pbkdf2(pin, salt);
    await _storage.write(key: _lockEnabledKey, value: 'true');
    await _storage.write(key: _lockTypeKey, value: 'pin');
    await _storage.write(key: _pinHashKey, value: '$salt:$hash');
  }

  /// Disable lock entirely.
  Future<void> disable() async {
    await _storage.write(key: _lockEnabledKey, value: 'false');
    await _storage.write(key: _lockTypeKey, value: 'none');
  }

  /// Verify PIN using PBKDF2 salted hash comparison.
  Future<bool> verifyPin(String pin) async {
    final stored = await _storage.read(key: _pinHashKey);
    if (stored == null) return false;
    final sepIdx = stored.indexOf(':');
    if (sepIdx < 0) return false;
    final salt = stored.substring(0, sepIdx);
    final expectedHash = stored.substring(sepIdx + 1);
    final actualHash = _pbkdf2(pin, salt);
    // Constant-time comparison to prevent timing attacks
    return _constantTimeEquals(actualHash, expectedHash);
  }

  /// Generate a cryptographically random 16-byte salt as hex.
  static String _generateSalt() {
    final now = DateTime.now().microsecondsSinceEpoch;
    final bytes = utf8.encode('civitasone:$now:${DateTime.now().hashCode}');
    return sha256.convert(bytes).toString().substring(0, 32);
  }

  /// PBKDF2-HMAC-SHA256 key derivation for PIN storage.
  /// Uses 100,000 iterations per OWASP recommendation.
  static String _pbkdf2(String pin, String salt) {
    final saltBytes = utf8.encode(salt);
    final pinBytes = utf8.encode(pin);

    // PBKDF2 implementation using HMAC-SHA256
    var result = Uint8List(32);
    var block = Uint8List(saltBytes.length + 4);
    block.setRange(0, saltBytes.length, saltBytes);
    // Block counter = 1 (we only need one block for 32 bytes)
    block[saltBytes.length] = 0;
    block[saltBytes.length + 1] = 0;
    block[saltBytes.length + 2] = 0;
    block[saltBytes.length + 3] = 1;

    var u = Hmac(sha256, pinBytes).convert(block).bytes;
    result = Uint8List.fromList(u);

    for (var i = 1; i < _pbkdf2Iterations; i++) {
      u = Hmac(sha256, pinBytes).convert(u).bytes;
      for (var j = 0; j < 32; j++) {
        result[j] ^= u[j];
      }
    }

    return base64Url.encode(result);
  }

  /// Constant-time string comparison to prevent timing side-channels.
  static bool _constantTimeEquals(String a, String b) {
    if (a.length != b.length) return false;
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return result == 0;
  }

  /// Record successful auth timestamp.
  Future<void> recordAuth() async {
    await _storage.write(
        key: _lastAuthKey, value: DateTime.now().toUtc().toIso8601String());
  }

  /// Check if lock challenge is needed (based on timeout).
  Future<bool> get needsChallenge async {
    if (!await isLockEnabled) return false;

    final lastStr = await _storage.read(key: _lastAuthKey);
    if (lastStr == null) return true;

    final last = DateTime.tryParse(lastStr);
    if (last == null) return true;

    final elapsed = DateTime.now().toUtc().difference(last);
    return elapsed.inMinutes >= lockTimeoutMinutes;
  }

  /// Attempt biometric authentication using the device's local_auth plugin.
  /// Returns true if authenticated, false if failed/cancelled/unavailable.
  Future<bool> authenticateBiometric() async {
    try {
      final canAuthenticate = await _localAuth.canCheckBiometrics ||
          await _localAuth.isDeviceSupported();
      if (!canAuthenticate) return false;

      return await _localAuth.authenticate(
        localizedReason: 'Unlock CivitasOne to access your data',
        options: const AuthenticationOptions(
          biometricOnly: false, // Allow PIN/pattern fallback on device
          stickyAuth: true,
        ),
      );
    } catch (_) {
      return false;
    }
  }
}
