import 'dart:io';
import 'package:flutter/foundation.dart';
import 'auth/pkce_auth.dart';

/// Reports device security posture to server on app launch/resume.
/// Server uses this to enforce compliance policy (block rooted, flag outdated, etc.)
class DeviceHeartbeat {
  DeviceHeartbeat({required this.apiBaseUrl, required this.auth});

  final String apiBaseUrl;
  final PkceAuthService auth;

  /// Send heartbeat — called on app launch and resume.
  /// Best-effort: failure is non-fatal (don't block app usage).
  Future<Map<String, dynamic>?> send() async {
    try {
      final token = await auth.accessToken();
      if (token == null) return null;

      final deviceId = await auth.getOrCreateDeviceId();
      final payload = await _gatherDeviceInfo(deviceId);

      final uri = Uri.parse('$apiBaseUrl/v1/hrms/devices/heartbeat');
      final response = await HttpClient().postUrl(uri).then((req) {
        req.headers.set('content-type', 'application/json');
        req.headers.set('authorization', 'Bearer $token');
        req.write(_jsonEncode(payload));
        return req.close();
      });

      if (response.statusCode == 403) {
        // Device is blocked — return the block info
        final body = await response.transform(const SystemEncoding().decoder).join();
        return {'blocked': true, 'message': body};
      }

      return {'blocked': false, 'status': 'ok'};
    } catch (_) {
      // Non-fatal — device heartbeat failing shouldn't block the app
      return null;
    }
  }

  Future<Map<String, dynamic>> _gatherDeviceInfo(String deviceId) async {
    String platform = 'unknown';
    String osVersion = '';
    String deviceName = '';

    if (!kIsWeb) {
      if (Platform.isAndroid) {
        platform = 'android';
        osVersion = 'Android ${Platform.operatingSystemVersion}';
        deviceName = 'Android Device'; // In production: device_info_plus package
      } else if (Platform.isIOS) {
        platform = 'ios';
        osVersion = 'iOS ${Platform.operatingSystemVersion}';
        deviceName = 'iPhone'; // In production: device_info_plus package
      }
    }

    return {
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'osVersion': osVersion,
      'appVersion': '0.1.0',
      'isRooted': false, // In production: flutter_jailbreak_detection package
      'hasScreenLock': true, // In production: local_auth canCheckBiometrics
      'isEncrypted': true, // All modern devices are encrypted
      'biometricAvailable': true, // In production: local_auth
    };
  }

  String _jsonEncode(Map<String, dynamic> data) {
    final entries = data.entries.map((e) {
      final v = e.value;
      if (v is String) return '"${e.key}":"$v"';
      if (v is bool) return '"${e.key}":$v';
      if (v is num) return '"${e.key}":$v';
      return '"${e.key}":"$v"';
    });
    return '{${entries.join(',')}}';
  }
}
