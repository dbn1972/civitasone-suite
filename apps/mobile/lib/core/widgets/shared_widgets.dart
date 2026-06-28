import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Gradient header card (used in 8+ screens: profile, leave balance, leaderboard, etc.)
class AppGradientHeader extends StatelessWidget {
  const AppGradientHeader({super.key, required this.child, this.colors});
  final Widget child;
  final List<Color>? colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: colors ?? [
            Theme.of(context).colorScheme.primary,
            Theme.of(context).colorScheme.tertiary,
          ],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: child,
    );
  }
}

/// Error + retry state (duplicated in 10+ screens).
class AppErrorState extends StatelessWidget {
  const AppErrorState({super.key, required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.wifi_off, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load data', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ]),
      ),
    );
  }
}

/// Empty state with icon + message + optional CTA (duplicated in 8+ screens).
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    required this.icon,
    required this.message,
    this.subtitle,
    this.actionLabel,
    this.onAction,
  });
  final IconData icon;
  final String message;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 64, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text(message, style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center),
          if (subtitle != null) ...[
            const SizedBox(height: 8),
            Text(subtitle!, style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.outline), textAlign: TextAlign.center),
          ],
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.add),
              label: Text(actionLabel!),
            ),
          ],
        ]),
      ),
    );
  }
}

/// Offline cache banner (duplicated in 4+ screens).
class AppCacheBanner extends StatelessWidget {
  const AppCacheBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: 'Showing cached data. You are offline.',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.colorScheme.tertiaryContainer.withOpacity(0.3),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.colorScheme.tertiary.withOpacity(0.3)),
        ),
        child: Row(children: [
          Icon(Icons.wifi_off, size: 16, color: theme.colorScheme.tertiary),
          const SizedBox(width: 8),
          Text(
            'Showing cached data',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.tertiary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ]),
      ),
    );
  }
}

/// Haptic-aware filled button that vibrates on press.
class AppHapticButton extends StatelessWidget {
  const AppHapticButton({
    super.key,
    required this.onPressed,
    required this.label,
    this.icon,
    this.loading = false,
  });
  final VoidCallback? onPressed;
  final String label;
  final IconData? icon;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      onPressed: onPressed == null ? null : () {
        HapticFeedback.mediumImpact();
        onPressed!();
      },
      icon: loading
          ? const SizedBox(width: 18, height: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
          : Icon(icon ?? Icons.check),
      label: Text(loading ? 'Processing…' : label),
      style: FilledButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 16),
      ),
    );
  }
}

/// Stat summary row with dividers (used in leave balance, leaderboard, etc.)
class AppSummaryRow extends StatelessWidget {
  const AppSummaryRow({super.key, required this.items});
  final List<({String value, String label})> items;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: [
        for (int i = 0; i < items.length; i++) ...[
          if (i > 0) Container(width: 1, height: 40, color: Colors.white30),
          Column(children: [
            Text(items[i].value,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 2),
            Text(items[i].label,
                style: const TextStyle(fontSize: 12, color: Colors.white70)),
          ]),
        ],
      ],
    );
  }
}
