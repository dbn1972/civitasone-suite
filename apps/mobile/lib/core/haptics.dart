import 'package:flutter/services.dart';

/// Haptic feedback utilities for field-use UX.
/// Government officers using phones outdoors benefit from tactile confirmation.
abstract final class AppHaptics {
  /// Light tap — selection, chip toggle, tab switch.
  static void selection() => HapticFeedback.selectionClick();

  /// Medium — successful submission (leave applied, kudos sent, check-in done).
  static void success() => HapticFeedback.mediumImpact();

  /// Heavy — critical action (geo check-in confirmed, goal completed).
  static void confirmed() => HapticFeedback.heavyImpact();

  /// Light vibration — button press.
  static void tap() => HapticFeedback.lightImpact();

  /// Error feedback.
  static void error() => HapticFeedback.heavyImpact();
}
