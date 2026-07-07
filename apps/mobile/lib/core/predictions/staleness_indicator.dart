import 'package:flutter/material.dart';

/// Displays "Predicted Xh ago" or "Predicted Xd ago" text below a prediction
/// badge when the prediction is stale (> 1 hour old).
///
/// Used by [PredictionChip] and [ExplainabilitySheet] to signal that the
/// displayed prediction may not reflect the latest server state.
///
/// Accessibility: includes a semantic label for screen readers.
///
/// **Validates: Requirements 22.6, 25.3**
class StalenessIndicator extends StatelessWidget {
  const StalenessIndicator({
    super.key,
    required this.computedAt,
  });

  /// When the prediction was originally computed on the server.
  final DateTime computedAt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final diff = DateTime.now().toUtc().difference(computedAt);

    // Don't show if less than 1 hour old
    if (diff.inHours < 1) {
      return const SizedBox.shrink();
    }

    final label = _formatStaleness(diff);

    return Semantics(
      label: 'Prediction is stale. $label',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.access_time,
            size: 11,
            color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
          ),
          const SizedBox(width: 3),
          Text(
            label,
            style: TextStyle(
              fontSize: 10,
              color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
              fontWeight: FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }

  static String _formatStaleness(Duration diff) {
    if (diff.inDays > 0) {
      return 'Predicted ${diff.inDays}d ago';
    }
    return 'Predicted ${diff.inHours}h ago';
  }
}
