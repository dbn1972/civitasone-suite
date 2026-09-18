import 'package:flutter/material.dart';
import '../../core/widgets/status_pill.dart';
import 'approvals_models.dart';

/// Approval task detail -- full record for one task surfaced by a workbasket.
///
/// Unlike `field/field_task_detail_screen.dart`, this screen does NOT fetch
/// its own data. workflow-service has no single-task lookup route (no
/// `GET /v1/workflow/workbaskets/:code/tasks/:id`, and no
/// `GET /v1/workflow/tasks/:id` either -- confirmed by reading
/// `services/workflow-service/src/modules/tasks/routes.ts` directly, which
/// only registers list/complete/claim/assign/bulk-complete). The list screen
/// therefore hands the already-fetched [WorkbasketTask] over via GoRouter
/// `extra`; a direct deep link carrying only an id (no `extra`) has no way
/// to resolve the rest of the record, so this screen shows an explanatory
/// empty state instead of guessing or crashing.
class ApprovalsTaskDetailScreen extends StatelessWidget {
  const ApprovalsTaskDetailScreen({super.key, required this.taskId, this.task});

  final String taskId;
  final WorkbasketTask? task;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = task;
    return Scaffold(
      appBar: AppBar(title: Text(t?.name ?? 'Task $taskId')),
      body: t == null ? _buildUnavailable(context, theme) : _buildDetail(context, theme, t),
    );
  }

  Widget _buildUnavailable(BuildContext context, ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.info_outline, size: 64, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('Task details unavailable', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            'Task $taskId can only be opened from the Approvals list -- workflow-service '
            'has no lookup endpoint for a single task by id.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.arrow_back),
            label: const Text('Go back'),
          ),
        ]),
      ),
    );
  }

  Widget _buildDetail(BuildContext context, ThemeData theme, WorkbasketTask t) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (t.isOverdue)
          Container(
            margin: const EdgeInsets.only(bottom: 16),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(children: [
              Icon(Icons.warning_amber_rounded, color: theme.colorScheme.error),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'This task is overdue.',
                  style: TextStyle(
                    color: theme.colorScheme.onErrorContainer,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ]),
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(t.name,
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                    ),
                    StatusPill(status: t.status.wireValue),
                  ],
                ),
                const Divider(height: 24),
                _DetailRow('Reference type', approvalRefTypeLabel(t.refType)),
                if (t.refId != null) _DetailRow('Reference id', t.refId!),
                _DetailRow('Instance id', t.instanceId),
                if (t.decision != null && t.decision!.isNotEmpty) _DetailRow('Decision so far', t.decision!),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Assignment',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                _DetailRow('Assignee', t.assigneeId ?? 'Unassigned'),
                _DetailRow('Role', t.roleRef ?? '—'),
                if (t.nodeKey != null && t.nodeKey!.isNotEmpty) _DetailRow('Node', t.nodeKey!),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Schedule',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                _DetailRow('Due', _formatDateTime(t.dueAt)),
                _DetailRow('Created', _formatDateTime(t.createdAt)),
                _DetailRow('Updated', _formatDateTime(t.updatedAt)),
                if (t.escalationCount > 0)
                  _DetailRow('Escalations', '${t.escalationCount}'),
              ],
            ),
          ),
        ),
      ],
    );
  }

  static String _formatDateTime(DateTime? d) {
    if (d == null) return '—';
    final local = d.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  }
}
