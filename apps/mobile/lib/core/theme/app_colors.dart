import 'package:flutter/material.dart';

/// CivitasOne Design Token System — semantic colors that adapt to light/dark mode.
/// All screens must use these tokens instead of hardcoded hex values.
///
/// Usage:
///   final appColors = Theme.of(context).extension<AppColors>()!;
///   Color bg = appColors.successContainer;
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.success,
    required this.successContainer,
    required this.successOnContainer,
    required this.warning,
    required this.warningContainer,
    required this.warningOnContainer,
    required this.info,
    required this.infoContainer,
    required this.infoOnContainer,
    required this.pink,
    required this.pinkContainer,
    required this.emerald,
    required this.emeraldContainer,
    required this.bronze,
    required this.subtle,
    required this.muted,
    required this.cardBorder,
    required this.shimmer,
    required this.snackbarSuccess,
  });

  final Color success;
  final Color successContainer;
  final Color successOnContainer;
  final Color warning;
  final Color warningContainer;
  final Color warningOnContainer;
  final Color info;
  final Color infoContainer;
  final Color infoOnContainer;
  final Color pink;
  final Color pinkContainer;
  final Color emerald;
  final Color emeraldContainer;
  final Color bronze;
  final Color subtle;
  final Color muted;
  final Color cardBorder;
  final Color shimmer;
  final Color snackbarSuccess;

  /// Light mode tokens
  static const light = AppColors(
    success: Color(0xFF22C55E),
    successContainer: Color(0xFFDCFCE7),
    successOnContainer: Color(0xFF15803D),
    warning: Color(0xFFF59E0B),
    warningContainer: Color(0xFFFEF3C7),
    warningOnContainer: Color(0xFF92400E),
    info: Color(0xFF06B6D4),
    infoContainer: Color(0xFFCFFAFE),
    infoOnContainer: Color(0xFF155E75),
    pink: Color(0xFFEC4899),
    pinkContainer: Color(0xFFFCE7F3),
    emerald: Color(0xFF10B981),
    emeraldContainer: Color(0xFFD1FAE5),
    bronze: Color(0xFFCD7F32),
    subtle: Color(0xFF94A3B8),
    muted: Color(0xFF64748B),
    cardBorder: Color(0xFFE2E8F0),
    shimmer: Color(0xFFE2E8F0),
    snackbarSuccess: Color(0xFF15803D),
  );

  /// Dark mode tokens
  static const dark = AppColors(
    success: Color(0xFF4ADE80),
    successContainer: Color(0xFF14532D),
    successOnContainer: Color(0xFFBBF7D0),
    warning: Color(0xFFFBBF24),
    warningContainer: Color(0xFF451A03),
    warningOnContainer: Color(0xFFFDE68A),
    info: Color(0xFF22D3EE),
    infoContainer: Color(0xFF083344),
    infoOnContainer: Color(0xFFA5F3FC),
    pink: Color(0xFFF472B6),
    pinkContainer: Color(0xFF500724),
    emerald: Color(0xFF34D399),
    emeraldContainer: Color(0xFF064E3B),
    bronze: Color(0xFFD4A574),
    subtle: Color(0xFF64748B),
    muted: Color(0xFF94A3B8),
    cardBorder: Color(0xFF334155),
    shimmer: Color(0xFF334155),
    snackbarSuccess: Color(0xFF166534),
  );

  @override
  AppColors copyWith({
    Color? success,
    Color? successContainer,
    Color? successOnContainer,
    Color? warning,
    Color? warningContainer,
    Color? warningOnContainer,
    Color? info,
    Color? infoContainer,
    Color? infoOnContainer,
    Color? pink,
    Color? pinkContainer,
    Color? emerald,
    Color? emeraldContainer,
    Color? bronze,
    Color? subtle,
    Color? muted,
    Color? cardBorder,
    Color? shimmer,
    Color? snackbarSuccess,
  }) {
    return AppColors(
      success: success ?? this.success,
      successContainer: successContainer ?? this.successContainer,
      successOnContainer: successOnContainer ?? this.successOnContainer,
      warning: warning ?? this.warning,
      warningContainer: warningContainer ?? this.warningContainer,
      warningOnContainer: warningOnContainer ?? this.warningOnContainer,
      info: info ?? this.info,
      infoContainer: infoContainer ?? this.infoContainer,
      infoOnContainer: infoOnContainer ?? this.infoOnContainer,
      pink: pink ?? this.pink,
      pinkContainer: pinkContainer ?? this.pinkContainer,
      emerald: emerald ?? this.emerald,
      emeraldContainer: emeraldContainer ?? this.emeraldContainer,
      bronze: bronze ?? this.bronze,
      subtle: subtle ?? this.subtle,
      muted: muted ?? this.muted,
      cardBorder: cardBorder ?? this.cardBorder,
      shimmer: shimmer ?? this.shimmer,
      snackbarSuccess: snackbarSuccess ?? this.snackbarSuccess,
    );
  }

  @override
  AppColors lerp(covariant ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      success: Color.lerp(success, other.success, t)!,
      successContainer: Color.lerp(successContainer, other.successContainer, t)!,
      successOnContainer: Color.lerp(successOnContainer, other.successOnContainer, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      warningContainer: Color.lerp(warningContainer, other.warningContainer, t)!,
      warningOnContainer: Color.lerp(warningOnContainer, other.warningOnContainer, t)!,
      info: Color.lerp(info, other.info, t)!,
      infoContainer: Color.lerp(infoContainer, other.infoContainer, t)!,
      infoOnContainer: Color.lerp(infoOnContainer, other.infoOnContainer, t)!,
      pink: Color.lerp(pink, other.pink, t)!,
      pinkContainer: Color.lerp(pinkContainer, other.pinkContainer, t)!,
      emerald: Color.lerp(emerald, other.emerald, t)!,
      emeraldContainer: Color.lerp(emeraldContainer, other.emeraldContainer, t)!,
      bronze: Color.lerp(bronze, other.bronze, t)!,
      subtle: Color.lerp(subtle, other.subtle, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      cardBorder: Color.lerp(cardBorder, other.cardBorder, t)!,
      shimmer: Color.lerp(shimmer, other.shimmer, t)!,
      snackbarSuccess: Color.lerp(snackbarSuccess, other.snackbarSuccess, t)!,
    );
  }
}
