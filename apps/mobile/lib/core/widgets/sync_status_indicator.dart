import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/sync/sync_failures_screen.dart';
import '../sync/sync_providers.dart';

/// A persistent badge indicator showing the count of unsynced + dead-lettered
/// write commands. Appears in the app bar when the combined count is > 0.
///
/// Tapping navigates to the [SyncFailuresScreen] showing dead-lettered commands
/// with manual retry capability.
///
/// Accessibility: ≥ 48dp touch target, screen reader label, sufficient contrast.
///
/// **Validates: Requirement 4.8**
class SyncStatusIndicator extends ConsumerWidget {
  const SyncStatusIndicator({super.key, this.onTap});

  /// Callback when the indicator is tapped. If null, pushes [SyncFailuresScreen].
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unsyncedAsync = ref.watch(unsyncedCountProvider);
    final deadAsync = ref.watch(deadCountProvider);

    final unsynced = unsyncedAsync.valueOrNull ?? 0;
    final dead = deadAsync.valueOrNull ?? 0;
    final totalCount = unsynced + dead;

    // Hide completely when everything is synced.
    if (totalCount == 0) {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);
    final hasDeadLetters = dead > 0;
    final badgeColor = hasDeadLetters
        ? theme.colorScheme.error
        : theme.colorScheme.tertiary;
    final iconColor = hasDeadLetters
        ? theme.colorScheme.error
        : theme.colorScheme.onSurfaceVariant;

    // Cap display at 99+
    final displayCount = totalCount > 99 ? '99+' : '$totalCount';

    final semanticLabel = hasDeadLetters
        ? '$dead failed sync commands. Tap to view and retry.'
        : '$unsynced commands syncing.';

    return Semantics(
      label: semanticLabel,
      button: true,
      child: InkWell(
        onTap: onTap ?? () => _navigateToFailures(context),
        borderRadius: BorderRadius.circular(24),
        child: ConstrainedBox(
          // Ensure touch target ≥ 48dp (accessibility requirement)
          constraints: const BoxConstraints(
            minWidth: 48,
            minHeight: 48,
          ),
          child: Center(
            child: Badge(
              label: Text(
                displayCount,
                style: TextStyle(
                  color: theme.colorScheme.onError,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
              backgroundColor: badgeColor,
              child: Icon(
                hasDeadLetters ? Icons.sync_problem : Icons.sync,
                color: iconColor,
                semanticLabel: null, // Parent Semantics handles this
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _navigateToFailures(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const SyncFailuresScreen(),
      ),
    );
  }
}
