import 'package:flutter/material.dart';
import 'prediction_data.dart';
import 'explainability_sheet.dart';
import 'staleness_indicator.dart';

/// Inline colored badge displayed on list items showing ML prediction confidence.
///
/// Color mapping:
/// - Green: confidence > 0.70 (high)
/// - Amber: confidence 0.40–0.70 (medium)
/// - Red: confidence < 0.40 (low)
///
/// Tapping the chip opens [ExplainabilitySheet] showing factor details.
/// When the prediction is stale (> 1 hour), a [StalenessIndicator] is shown
/// below the badge.
///
/// Accessibility: semantic label with full text explanation, ≥ 48dp touch target.
///
/// **Validates: Requirements 22.6, 25.3**
class PredictionChip extends StatelessWidget {
  const PredictionChip({
    super.key,
    required this.prediction,
    this.label,
    this.showStaleness = true,
    this.onTap,
  });

  /// The prediction data to display.
  final PredictionData prediction;

  /// Optional label override. Defaults to "{confidence}%" format.
  final String? label;

  /// Whether to show the staleness indicator below the chip.
  final bool showStaleness;

  /// Optional tap callback. If null, opens [ExplainabilitySheet].
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final (fgColor, bgColor) = _resolveColors(prediction.confidenceLevel, isDark);

    final displayLabel = label ?? '${(prediction.confidence * 100).round()}%';
    final confidenceText = _confidenceLevelText(prediction.confidenceLevel);
    final semanticLabel = prediction.prediction != null
        ? 'Prediction: ${(prediction.prediction! * 100).round()}%, $confidenceText confidence'
        : 'Prediction unavailable, $confidenceText confidence';

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Semantics(
          label: semanticLabel,
          button: true,
          child: InkWell(
            onTap: onTap ?? () => _showExplainability(context),
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minWidth: 48,
                minHeight: 48,
              ),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: bgColor,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (prediction.isFallback) ...[
                        Icon(
                          Icons.info_outline,
                          size: 12,
                          color: fgColor,
                        ),
                        const SizedBox(width: 4),
                      ],
                      Text(
                        displayLabel,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: fgColor,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        if (showStaleness && prediction.isStale)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: StalenessIndicator(computedAt: prediction.computedAt),
          ),
      ],
    );
  }

  void _showExplainability(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => ExplainabilitySheet(prediction: prediction),
    );
  }

  static (Color fg, Color bg) _resolveColors(String level, bool isDark) {
    switch (level) {
      case 'high':
        return isDark
            ? (const Color(0xFF4ADE80), const Color(0xFF14532D))
            : (const Color(0xFF15803D), const Color(0xFFDCFCE7));
      case 'medium':
        return isDark
            ? (const Color(0xFFFBBF24), const Color(0xFF451A03))
            : (const Color(0xFF92400E), const Color(0xFFFEF3C7));
      case 'low':
      default:
        return isDark
            ? (const Color(0xFFFCA5A5), const Color(0xFF450A0A))
            : (const Color(0xFFB91C1C), const Color(0xFFFEE2E2));
    }
  }

  static String _confidenceLevelText(String level) {
    switch (level) {
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
      default:
        return 'low';
    }
  }
}
