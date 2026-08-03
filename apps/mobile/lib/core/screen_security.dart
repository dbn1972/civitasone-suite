import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Prevent screenshots on sensitive screens (payslip, ID card, visiting card).
/// Uses Android FLAG_SECURE and iOS screenshot notification.
abstract final class ScreenSecurity {
  static const _channel = MethodChannel('civitasone/screen_security');

  /// Enable screenshot prevention (call in initState of sensitive screens).
  /// On Android: sets FLAG_SECURE on the window.
  /// On iOS: overlays a blank view on screenshot/recording.
  static Future<void> enableProtection() async {
    try {
      await _channel.invokeMethod('enableProtection');
    } catch (_) {
      // Platform channel not available (web/desktop) — non-fatal
    }
  }

  /// Disable screenshot prevention (call in dispose of sensitive screens).
  static Future<void> disableProtection() async {
    try {
      await _channel.invokeMethod('disableProtection');
    } catch (_) {}
  }
}

/// Mixin for screens that should prevent screenshots.
/// Usage: class _MyScreenState extends State<MyScreen> with ScreenProtected
mixin ScreenProtected<T extends StatefulWidget> on State<T> {
  @override
  void initState() {
    super.initState();
    ScreenSecurity.enableProtection();
  }

  @override
  void dispose() {
    ScreenSecurity.disableProtection();
    super.dispose();
  }
}
