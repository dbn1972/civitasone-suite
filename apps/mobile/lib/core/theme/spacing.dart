/// CivitasOne spacing tokens — 4dp base grid.
/// All padding, margins, and gaps must use these values.
abstract final class Spacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  /// Screen body padding (lists use lg, forms use xxl)
  static const double screenPaddingList = 16;
  static const double screenPaddingForm = 24;

  /// Card internals
  static const double cardPadding = 16;
  static const double cardPaddingLarge = 20;

  /// Gaps between cards in a list
  static const double cardGap = 12;

  /// Section spacing between logical groups
  static const double sectionGap = 24;
}

/// CivitasOne radius tokens.
abstract final class Radii {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double full = 999;
}

/// CivitasOne touch target sizes — WCAG 2.5.8 compliance.
/// Minimum 48dp for ALL interactive elements.
/// Target audience: Government officers 35-60yo with large fingers.
abstract final class TouchTargets {
  /// Absolute minimum for any tappable element
  static const double minimum = 48;

  /// Comfortable target for primary actions
  static const double comfortable = 56;

  /// Large target for outdoor/field use (check-in buttons, main CTAs)
  static const double large = 64;
}

/// Minimum font sizes for outdoor readability.
abstract final class FontSizes {
  /// Absolute minimum — nothing smaller than this in the app
  static const double minimum = 12;

  /// Body text — default reading size
  static const double body = 14;

  /// Labels and metadata
  static const double label = 12;

  /// Card titles
  static const double cardTitle = 15;

  /// KPI/stat values
  static const double kpiValue = 20;
}
