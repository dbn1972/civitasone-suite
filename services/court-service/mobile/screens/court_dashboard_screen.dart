import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../models/court_analytics.dart';
import '../providers/court_providers.dart';

/// Court dashboard — KPI tiles built from analytics + overdue + pendency.
/// Mirrors features/reports/quick_reports_screen.dart (KPI grid + quick links).
class CourtDashboardScreen extends ConsumerWidget {
  const CourtDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final analytics = ref.watch(analyticsProvider);
    final overdue = ref.watch(overdueProvider);
    final pendency = ref.watch(pendencyProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Court Dashboard')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(analyticsProvider);
          ref.invalidate(overdueProvider);
          ref.invalidate(pendencyProvider);
          await Future.wait([
            ref.read(analyticsProvider.future),
            ref.read(overdueProvider.future),
            ref.read(pendencyProvider.future),
          ]);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // KPI grid — clearance, pending, overdue, avg pendency.
            analytics.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, _) => _ErrorCard(message: 'Analytics unavailable: $e'),
              data: (a) => GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 2,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 1.4,
                children: [
                  _KpiCard(
                    icon: Icons.check_circle,
                    label: 'Clearance Rate',
                    value: '${a.clearanceRatePct}%',
                    color: theme.colorScheme.tertiary,
                  ),
                  _KpiCard(
                    icon: Icons.pending_actions,
                    label: 'Pending',
                    value: '${a.pending}',
                    color: theme.colorScheme.primary,
                  ),
                  _KpiCard(
                    icon: Icons.warning_amber,
                    label: 'Overdue',
                    value: overdue.maybeWhen(
                      data: (o) => '${o.count}',
                      orElse: () => '—',
                    ),
                    color: theme.colorScheme.error,
                  ),
                  _KpiCard(
                    icon: Icons.hourglass_bottom,
                    label: 'Avg Pendency (days)',
                    value: '${a.avgPendencyDays}',
                    color: theme.colorScheme.secondary,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),

            // Secondary analytics row (instituted / disposed / oldest).
            analytics.maybeWhen(
              data: (a) => Row(
                children: [
                  Expanded(child: _MiniStat(label: 'Instituted', value: '${a.instituted}')),
                  Expanded(child: _MiniStat(label: 'Disposed', value: '${a.disposed}')),
                  Expanded(child: _MiniStat(label: 'Oldest (days)', value: '${a.oldestPendingDays}')),
                ],
              ),
              orElse: () => const SizedBox.shrink(),
            ),
            const SizedBox(height: 24),

            // Pendency breakdown by status.
            Text('Pendency by Status',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            pendency.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => _ErrorCard(message: 'Pendency unavailable: $e'),
              data: (p) => Column(
                children: [
                  for (final b in p.buckets)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: Icon(Icons.circle,
                            size: 14, color: _statusColor(b.status, theme)),
                        title: Text(_titleCase(b.status)),
                        trailing: Text('${b.count}',
                            style: const TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 16)),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text('Total pending: ${p.total}',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.outline)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Navigation.
            Card(
              child: ListTile(
                leading: Icon(Icons.folder_open, color: theme.colorScheme.primary),
                title: const Text('Browse Cases'),
                trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
                onTap: () => context.go('/court/cases'),
              ),
            ),
            Card(
              child: ListTile(
                leading: Icon(Icons.public, color: theme.colorScheme.tertiary),
                title: const Text('Public Case-Status Lookup'),
                trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
                onTap: () => context.go('/court/public-lookup'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static Color _statusColor(String status, ThemeData theme) {
    switch (status.toLowerCase()) {
      case 'disposed':
        return theme.colorScheme.tertiary;
      case 'pending':
      case 'part_heard':
        return theme.colorScheme.primary;
      case 'reserved':
        return theme.colorScheme.secondary;
      case 'registered':
        return theme.colorScheme.outline;
      default:
        return theme.colorScheme.error;
    }
  }

  static String _titleCase(String s) => s
      .split('_')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: color.withOpacity(0.05),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity(0.15)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(height: 8),
            Text(value,
                style: TextStyle(
                    fontSize: 20, fontWeight: FontWeight.bold, color: color)),
            Text(label,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, color: color.withOpacity(0.8))),
          ],
        ),
      );
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        children: [
          Text(value,
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold)),
          Text(label,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.outline)),
        ],
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.error_outline, color: theme.colorScheme.error),
            const SizedBox(width: 12),
            Expanded(
              child: Text(message,
                  style: TextStyle(color: theme.colorScheme.onErrorContainer)),
            ),
          ],
        ),
      ),
    );
  }
}
