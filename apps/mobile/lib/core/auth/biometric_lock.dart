import 'package:flutter/services.dart';
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
  BiometricLockService({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  // Using MethodChannel for local_auth since it's not in pubspec yet.
  // In production, replace with local_auth package.
  static const _channel = MethodChannel('civitasone/biometric');
  static const _lockEnabledKey = 'civitasone_lock_enabled';
  static const _lockTypeKey = 'civitasone_lock_type'; // biometric, pin, none
  static const _pinHashKey = 'civitasone_pin_hash';
  static const _lastAuthKey = 'civitasone_last_auth_ts';

  /// Lock timeout — require biometric after this many minutes of inactivity.
  static const lockTimeoutMinutes = 5;

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
    // In production: use proper hashing (bcrypt/argon2). Simple hash for now.
    final hash = pin.hashCode.toString();
    await _storage.write(key: _lockEnabledKey, value: 'true');
    await _storage.write(key: _lockTypeKey, value: 'pin');
    await _storage.write(key: _pinHashKey, value: hash);
  }

  /// Disable lock entirely.
  Future<void> disable() async {
    await _storage.write(key: _lockEnabledKey, value: 'false');
    await _storage.write(key: _lockTypeKey, value: 'none');
  }

  /// Verify PIN.
  Future<bool> verifyPin(String pin) async {
    final stored = await _storage.read(key: _pinHashKey);
    return stored == pin.hashCode.toString();
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

  /// Attempt biometric authentication.
  /// Returns true if authenticated, false if failed/cancelled.
  /// In production, use the `local_auth` package:
  ///   final auth = LocalAuthentication();
  ///   return auth.authenticate(localizedReason: 'Unlock CivitasOne');
  Future<bool> authenticateBiometric() async {
    try {
      // Simulated for now — in production use local_auth
      // final auth = LocalAuthentication();
      // final canCheck = await auth.canCheckBiometrics;
      // if (!canCheck) return false;
      // return await auth.authenticate(
      //   localizedReason: 'Unlock CivitasOne to access your data',
      //   options: const AuthenticationOptions(biometricOnly: false),
      // );
      return true; // Allow through until local_auth is added
    } catch (_) {
      return false;
    }
  }
}
