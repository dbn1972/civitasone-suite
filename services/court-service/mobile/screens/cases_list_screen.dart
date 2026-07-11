import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../models/court_case.dart';
import '../providers/court_providers.dart';

/// Cases list — cards showing CNR, title, type, a status pill, and next/target
/// disposal date. Mirrors the app's list-screen idiom (Card + ListTile, a
/// status filter, RefreshIndicator).
class CasesListScreen extends ConsumerWidget {
  const CasesListScreen({super.key});

  static const _statuses = <String?>[
    null,
    'registered',
    'pending',
    'reserved',
    'disposed',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final cases = ref.watch(casesProvider);
    final activeFilter = ref.watch(caseStatusFilterProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Cases')),
      body: Column(
        children: [
          // Status filter chips.
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              children: [
                for (final s in _statuses)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(s == null ? 'All' : _titleCase(s)),
                      selected: activeFilter == s,
                      onSelected: (_) =>
                          ref.read(caseStatusFilterProvider.notifier).state = s,
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: cases.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('Failed to load cases: $e',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: theme.colorScheme.error)),
                ),
              ),
              data: (items) {
                if (items.isEmpty) {
                  return const Center(child: Text('No cases found.'));
                }
                return RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(casesProvider);
                    await ref.read(casesProvider.future);
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: items.length,
                    itemBuilder: (_, i) => _CaseCard(item: items[i]),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  static String _titleCase(String s) => s
      .split('_')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');
}

class _CaseCard extends StatelessWidget {
  const _CaseCard({required this.item});
  final CourtCase item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final df = DateFormat('dd MMM yyyy');
    final target = item.targetDisposalDate;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: () => context.go('/court/cases/${item.id}'),
        title: Text(item.title ?? item.cnrNumber,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(item.cnrNumber,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.outline)),
            const SizedBox(height: 6),
            Row(
              children: [
                if (item.caseType != null)
                  _Tag(text: CasesListScreen._titleCase(item.caseType!)),
                const SizedBox(width: 8),
                CaseStatusPill(status: item.status),
              ],
            ),
            if (target != null) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  Icon(
                    item.isOverdue ? Icons.warning_amber : Icons.event,
                    size: 14,
                    color: item.isOverdue
                        ? theme.colorScheme.error
                        : theme.colorScheme.outline,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Target: ${df.format(target)}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: item.isOverdue
                          ? theme.colorScheme.error
                          : theme.colorScheme.outline,
                      fontWeight:
                          item.isOverdue ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
        trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
        isThreeLine: true,
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text,
          style: theme.textTheme.labelSmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
    );
  }
}

/// A coloured pill for a case status. Shared by list + detail screens.
class CaseStatusPill extends StatelessWidget {
  const CaseStatusPill({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = _color(theme);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Text(
        _label(status),
        style: TextStyle(
            color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }

  Color _color(ThemeData theme) {
    switch (status.toLowerCase()) {
      case 'disposed':
        return theme.colorScheme.tertiary;
      case 'pending':
        return theme.colorScheme.primary;
      case 'reserved':
        return theme.colorScheme.secondary;
      case 'registered':
        return theme.colorScheme.outline;
      default:
        return theme.colorScheme.error;
    }
  }

  String _label(String s) => s
      .split('_')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');
}
