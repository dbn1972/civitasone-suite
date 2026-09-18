import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart';
import '../../core/widgets/status_pill.dart';
import 'field_task_models.dart';

/// Field Task detail -- full record for one assigned task, fetched directly
/// by id so this screen also works from a deep link (e.g. a push notification
/// or QR code at a job site, once either exists).
///
/// GET /v1/field/tasks/:id
class FieldTaskDetailScreen extends ConsumerStatefulWidget {
  const FieldTaskDetailScreen({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<FieldTaskDetailScreen> createState() => _FieldTaskDetailScreenState();
}

class _FieldTaskDetailScreenState extends ConsumerState<FieldTaskDetailScreen> {
  bool _loading = true;
  String? _error;
  FieldTask? _task;

  @override
  void initState() {
    super.initState();
    _fetchTask();
  }

  Future<void> _fetchTask() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/field/tasks/${widget.taskId}');
      final data = res.data?['data'] as Map<String, dynamic>?;
      _task = data == null ? null : FieldTask.fromJson(data);
    } catch (e) {
      _error = userFriendlyError(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatDateTime(DateTime? d) {
    if (d == null) return '—';
    final local = d.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_task?.title ?? 'Task'),
        actions: [
          if (!_loading)
            IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
              onPressed: _fetchTask,
            ),
        ],
      ),
      body: _buildBody(theme),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text('Unable to load this task', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchTask,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ]),
        ),
      );
    }
    final task = _task;
    if (task == null) {
      return const Center(child: Text('Task not found'));
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (task.isOverdue)
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
                      child: Text(task.title,
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                    ),
                    StatusPill(status: task.status.wireValue),
                  ],
                ),
                const SizedBox(height: 4),
                Text(task.taskType,
                    style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline)),
                if (task.description != null && task.description!.isNotEmpty) ...[
                  const Divider(height: 24),
                  Text(task.description!, style: theme.textTheme.bodyMedium),
                ],
                const Divider(height: 24),
                _DetailRow('Priority', fieldTaskPriorityLabel(task.priority)),
                _DetailRow('Assignee', task.assigneeId ?? 'Unassigned'),
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
                _DetailRow('Due', _formatDateTime(task.dueDate)),
                _DetailRow('Created', _formatDateTime(task.createdAt)),
                _DetailRow('Updated', _formatDateTime(task.updatedAt)),
                // "... At" (not just "Completed"/"Cancelled") so this row's
                // label can't collide in a text search with the header's
                // StatusPill, which already renders that exact status word.
                if (task.status == FieldTaskStatus.completed)
                  _DetailRow('Completed At', _formatDateTime(task.completedAt)),
                if (task.status == FieldTaskStatus.cancelled)
                  _DetailRow('Cancelled At', _formatDateTime(task.cancelledAt)),
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
                Text('Location',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                _DetailRow('Address', (task.address == null || task.address!.isEmpty) ? '—' : task.address!),
                if (task.hasLocation)
                  _DetailRow(
                    'Coordinates',
                    '${task.latitude!.toStringAsFixed(6)}, ${task.longitude!.toStringAsFixed(6)}',
                  ),
              ],
            ),
          ),
        ),
      ],
    );
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
            width: 100,
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
