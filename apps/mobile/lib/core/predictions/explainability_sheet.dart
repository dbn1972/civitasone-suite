import 'package:flutter/material.dart';
import 'prediction_data.dart';
import 'staleness_indicator.dart';

/// Bottom sheet widget showing explainability factors for a prediction.
///
/// Displays the top contributing factors with horizontal bars indicating
/// relative contribution and direction (positive = green, negative = red).
///
/// Shown when the user taps a [PredictionChip] on a list item.
///
/// Accessibility: semantic labels on all elements, sufficient contrast,
/// touch targets ≥ 48dp.
///
/// **Validates: Requirements 22.6, 25.3**
class ExplainabilitySheet extends StatelessWidget {
  const ExplainabilitySheet({
    super.key,
    required this.prediction,
  });

  /// The prediction whose factors should be displayed.
  final PredictionData prediction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Drag handle
            Center(
              child: Container(
                width: 32,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Header
            Row(
              children: [
                Icon(
                  Icons.insights,
                  color: theme.colorScheme.primary,
                  size: 24,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Prediction Details',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Confidence score row
            _ConfidenceRow(prediction: prediction, isDark: isDark),
            const SizedBox(height: 16),

            // Staleness indicator
            if (prediction.isStale) ...[
              StalenessIndicator(computedAt: prediction.computedAt),
              const SizedBox(height: 16),
            ],

            // Factors heading
            if (prediction.factors.isNotEmpty) ...[
              Text(
                'Contributing Factors',
                style: theme.textTheme.labelLarge?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 12),

              // Factor bars
              ...prediction.factors.map(
                (factor) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _FactorBar(factor: factor, isDark: isDark),
                ),
              ),
            ] else ...[
              Text(
                'No explainability factors available.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],

            // Fallback notice
            if (prediction.isFallback) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline,
                      size: 16,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'This prediction uses rule-based fallback logic. '
                        'ML model is not currently available.',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // Model version
            if (prediction.modelVersion != null) ...[
              const SizedBox(height: 8),
              Text(
                'Model v${prediction.modelVersion}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ConfidenceRow extends StatelessWidget {
  const _ConfidenceRow({required this.prediction, required this.isDark});
  final PredictionData prediction;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final confidencePct = (prediction.confidence * 100).round();
    final (fgColor, _) = _resolveConfidenceColors(prediction.confidenceLevel, isDark);

    return Semantics(
      label: 'Confidence: $confidencePct%, ${prediction.confidenceLevel} confidence',
      child: Row(
        children: [
          Text(
            'Confidence',
            style: theme.textTheme.bodyMedium,
          ),
          const Spacer(),
          Text(
            '$confidencePct%',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
              color: fgColor,
            ),
          ),
        ],
      ),
    );
  }

  static (Color fg, Color bg) _resolveConfidenceColors(String level, bool isDark) {
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
}

class _FactorBar extends StatelessWidget {
  const _FactorBar({required this.factor, required this.isDark});
  final ExplainabilityFactor factor;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isPositive = factor.direction == 'positive';
    final barColor = isPositive
        ? (isDark ? const Color(0xFF4ADE80) : const Color(0xFF15803D))
        : (isDark ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C));
    final barBg = isPositive
        ? (isDark ? const Color(0xFF14532D) : const Color(0xFFDCFCE7))
        : (isDark ? const Color(0xFF450A0A) : const Color(0xFFFEE2E2));

    // Normalize bar width (contribution is relative, cap at 1.0)
    final barFraction = factor.contribution.clamp(0.0, 1.0);
    final directionIcon = isPositive ? Icons.arrow_upward : Icons.arrow_downward;
    final directionLabel = isPositive ? 'positive impact' : 'negative impact';

    return Semantics(
      label: '${_humanize(factor.feature)}: '
          '${(factor.contribution * 100).round()}% contribution, '
          '$directionLabel',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(directionIcon, size: 14, color: barColor),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  _humanize(factor.feature),
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              Text(
                '${(factor.contribution * 100).round()}%',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: barColor,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: SizedBox(
              height: 6,
              child: Stack(
                children: [
                  Container(color: barBg),
                  FractionallySizedBox(
                    widthFactor: barFraction,
                    child: Container(color: barColor),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Convert camelCase/snake_case feature names to human-readable labels.
  static String _humanize(String s) {
    // Handle camelCase
    final spaced = s.replaceAllMapped(
      RegExp(r'([a-z])([A-Z])'),
      (m) => '${m[1]} ${m[2]}',
    );
    // Handle snake_case
    final words = spaced.replaceAll('_', ' ');
    if (words.isEmpty) return words;
    return '${words[0].toUpperCase()}${words.substring(1)}';
  }
}
