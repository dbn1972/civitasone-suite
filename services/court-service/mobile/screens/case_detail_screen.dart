import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../models/court_case.dart';
import '../providers/court_providers.dart';
import 'cases_list_screen.dart' show CaseStatusPill;

/// Case detail — full metadata for one case plus its (non-PII) parties.
class CaseDetailScreen extends ConsumerWidget {
  const CaseDetailScreen({super.key, required this.caseId});
  final String caseId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(caseByIdProvider(caseId));

    return Scaffold(
      appBar: AppBar(title: const Text('Case Details')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Failed to load case: $e',
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.error)),
          ),
        ),
        data: (c) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(caseByIdProvider(caseId));
            await ref.read(caseByIdProvider(caseId).future);
          },
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(c.title ?? c.cnrNumber,
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Row(
                children: [
                  CaseStatusPill(status: c.status),
                  const SizedBox(width: 8),
                  if (c.stage != null)
                    Text('Stage: ${_titleCase(c.stage!)}',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.outline)),
                ],
              ),
              const SizedBox(height: 20),

              _Section(title: 'Registry', rows: [
                _Row('CNR Number', c.cnrNumber),
                _Row('Case Type', c.caseType == null ? '—' : _titleCase(c.caseType!)),
                _Row('Filing Number', c.filingNumber ?? '—'),
                _Row('Filing Date', _fmt(c.filingDate)),
              ]),
              const SizedBox(height: 12),

              _Section(title: 'Disposal', rows: [
                _Row('Target Disposal', _fmt(c.targetDisposalDate),
                    highlight: c.isOverdue),
                _Row('Disposal Date', _fmt(c.disposalDate)),
                if (c.isOverdue) _Row('Status', 'OVERDUE', highlight: true),
              ]),
              const SizedBox(height: 12),

              _Section(title: 'Court', rows: [
                _Row('Court ID', c.courtId ?? '—'),
                _Row('Bench ID', c.benchId ?? '—'),
              ]),
              const SizedBox(height: 12),

              // Parties (PII fields are encrypted server-side; only role +
              // advocate are shown here).
              Text('Parties',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              if (c.parties.isEmpty)
                Text('No parties on record.',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.outline))
              else
                for (final p in c.parties)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: Icon(Icons.person, color: theme.colorScheme.primary),
                      title: Text(_titleCase(p.partyRole)),
                      subtitle: p.advocateName == null
                          ? null
                          : Text('Advocate: ${p.advocateName}'
                              '${p.advocateBarId != null ? ' (${p.advocateBarId})' : ''}'),
                    ),
                  ),

              const SizedBox(height: 20),
              Text(
                'Updated ${_fmt(c.updatedAt)} · v${c.version ?? 1}',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.outline),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _fmt(DateTime? d) =>
      d == null ? '—' : DateFormat('dd MMM yyyy').format(d);

  static String _titleCase(String s) => s
      .split('_')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.rows});
  final String title;
  final List<_Row> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ...rows,
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.highlight = false});
  final String label;
  final String value;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(label,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: theme.colorScheme.outline)),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: highlight ? FontWeight.bold : FontWeight.w500,
                color: highlight ? theme.colorScheme.error : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
