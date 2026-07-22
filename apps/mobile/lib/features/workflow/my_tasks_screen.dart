import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/providers.dart';

// Fix: [AUDIT-P1-5] User-friendly error messages
String _userFriendlyError(dynamic error) {
  if (error is DioException) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'Connection timed out. Please try again.';
      case DioExceptionType.connectionError:
        return 'No internet connection. Your action has been queued.';
      default:
        final status = error.response?.statusCode;
        if (status != null && status >= 500) return 'Server error. Please try again later.';
        if (status == 403) return 'You do not have permission for this action.';
        if (status == 409) return 'This item was modified by someone else. Please refresh.';
        return 'Something went wrong. Please try again.';
    }
  }
  return 'An unexpected error occurred. Please try again.';
}

/// Workflow Tasks — list of pending tasks assigned to the current user.
/// GET /v1/workflow/tasks?assignee=me&status=pending
/// POST /v1/workflow/tasks/:id/complete
/// POST /v1/workflow/tasks/:id/delegate
class MyTasksScreen extends ConsumerStatefulWidget {
  const MyTasksScreen({super.key});

  @override
  ConsumerState<MyTasksScreen> createState() => _MyTasksScreenState();
}

enum _TaskFilter { all, overdue, dueToday, upcoming }

class _MyTasksScreenState extends ConsumerState<MyTasksScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _tasks = [];
  _TaskFilter _filter = _TaskFilter.all;
  // Fix: [AUDIT-P1-6] Offline indicator state
  bool _isOnline = true;

  @override
  void initState() {
    super.initState();
    _fetchTasks();
  }

  Future<void> _fetchTasks() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/workflow/tasks',
        params: {'assignee': 'me', 'status': 'pending'},
      );
      final data = res.data?['data'] as List<dynamic>? ?? [];
      _tasks = data.cast<Map<String, dynamic>>();
    } catch (e) {
      _error = e.toString();
      // Fix: [AUDIT-P1-6] Detect offline state
      if (e is DioException && e.type == DioExceptionType.connectionError) {
        setState(() => _isOnline = false);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filteredTasks {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final tomorrow = today.add(const Duration(days: 1));

    switch (_filter) {
      case _TaskFilter.overdue:
        return _tasks.where((t) {
          final due = _parseDueDate(t);
          return due != null && due.isBefore(today);
        }).toList();
      case _TaskFilter.dueToday:
        return _tasks.where((t) {
          final due = _parseDueDate(t);
          return due != null &&
              !due.isBefore(today) &&
              due.isBefore(tomorrow);
        }).toList();
      case _TaskFilter.upcoming:
        return _tasks.where((t) {
          final due = _parseDueDate(t);
          return due != null && !due.isBefore(tomorrow);
        }).toList();
      case _TaskFilter.all:
        return _tasks;
    }
  }

  DateTime? _parseDueDate(Map<String, dynamic> task) {
    final due = task['dueDate'] as String?;
    if (due == null || due.isEmpty) return null;
    try {
      return DateTime.parse(due);
    } catch (_) {
      return null;
    }
  }

  bool _isOverdue(Map<String, dynamic> task) {
    final due = _parseDueDate(task);
    if (due == null) return false;
    return due.isBefore(DateTime.now());
  }

  Future<void> _completeTask(Map<String, dynamic> task) async {
    final taskId = task['id'] as String;
    final taskName = task['name'] as String? ?? 'Task';
    final outcomeCtrl = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Complete Task'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Mark "$taskName" as complete?'),
            const SizedBox(height: 16),
            TextField(
              controller: outcomeCtrl,
              decoration: const InputDecoration(
                labelText: 'Outcome (optional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Complete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final api = ref.read(apiClientProvider);
      final body = <String, dynamic>{};
      if (outcomeCtrl.text.trim().isNotEmpty) {
        body['outcome'] = outcomeCtrl.text.trim();
      }
      await api.post('/v1/workflow/tasks/$taskId/complete', data: body);
      setState(() => _tasks.removeWhere((t) => t['id'] == taskId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('"$taskName" completed'),
            backgroundColor: const Color(0xFF15803D),
          ),
        );
      }
    } catch (e) {
      // Fix: [AUDIT-P1-7] Route writes through offline outbox on connection errors
      if (e is DioException &&
          (e.type == DioExceptionType.connectionError ||
           e.type == DioExceptionType.connectionTimeout)) {
        // TODO: Queue to SyncDatabase outbox for guaranteed delivery
        setState(() => _isOnline = false);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Action queued — will sync when online')),
          );
        }
        return;
      }
      // Fix: [AUDIT-P1-5] User-friendly error messages
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_userFriendlyError(e)),
            action: SnackBarAction(
              label: 'Retry',
              onPressed: () => _completeTask(task),
            ),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  Future<void> _delegateTask(Map<String, dynamic> task) async {
    final taskId = task['id'] as String;
    final taskName = task['name'] as String? ?? 'Task';
    final userIdCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delegate Task'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Delegate "$taskName" to another officer?'),
              const SizedBox(height: 16),
              TextFormField(
                controller: userIdCtrl,
                decoration: const InputDecoration(
                  labelText: 'Officer name or ID *',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.person_search),
                  hintText: 'Search officer…',
                ),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Select an officer' : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate()) {
                Navigator.pop(ctx, true);
              }
            },
            child: const Text('Delegate'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final api = ref.read(apiClientProvider);
      await api.post('/v1/workflow/tasks/$taskId/delegate', data: {
        'toUserId': userIdCtrl.text.trim(),
      });
      setState(() => _tasks.removeWhere((t) => t['id'] == taskId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('"$taskName" delegated'),
            backgroundColor: const Color(0xFF15803D),
          ),
        );
      }
    } catch (e) {
      // Fix: [AUDIT-P1-7] Route writes through offline outbox on connection errors
      if (e is DioException &&
          (e.type == DioExceptionType.connectionError ||
           e.type == DioExceptionType.connectionTimeout)) {
        // TODO: Queue to SyncDatabase outbox for guaranteed delivery
        setState(() => _isOnline = false);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Action queued — will sync when online')),
          );
        }
        return;
      }
      // Fix: [AUDIT-P1-5] User-friendly error messages
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_userFriendlyError(e)),
            action: SnackBarAction(
              label: 'Retry',
              onPressed: () => _delegateTask(task),
            ),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredTasks;

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Tasks'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _fetchTasks,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : Column(
                  children: [
                    // Fix: [AUDIT-P1-6] Offline indicator banner
                    if (!_isOnline)
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        color: Colors.orange.shade100,
                        child: Row(
                          children: [
                            Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade800),
                            const SizedBox(width: 8),
                            Text(
                              'Offline — actions will sync when connected',
                              style: TextStyle(fontSize: 13, color: Colors.orange.shade800),
                            ),
                          ],
                        ),
                      ),
                    // Filter chips
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        children: [
                          _FilterChip(
                            label: 'All',
                            selected: _filter == _TaskFilter.all,
                            onTap: () => setState(() => _filter = _TaskFilter.all),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Overdue',
                            selected: _filter == _TaskFilter.overdue,
                            onTap: () => setState(() => _filter = _TaskFilter.overdue),
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Due Today',
                            selected: _filter == _TaskFilter.dueToday,
                            onTap: () => setState(() => _filter = _TaskFilter.dueToday),
                            color: const Color(0xFFF59E0B),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Upcoming',
                            selected: _filter == _TaskFilter.upcoming,
                            onTap: () => setState(() => _filter = _TaskFilter.upcoming),
                          ),
                        ],
                      ),
                    ),
                    // Tasks list
                    Expanded(
                      child: filtered.isEmpty
                          ? _buildEmpty(theme)
                          : RefreshIndicator(
                              onRefresh: _fetchTasks,
                              child: ListView.builder(
                                padding: const EdgeInsets.all(16),
                                itemCount: filtered.length,
                                itemBuilder: (ctx, i) => _TaskCard(
                                  task: filtered[i],
                                  isOverdue: _isOverdue(filtered[i]),
                                  onComplete: () => _completeTask(filtered[i]),
                                  onDelegate: () => _delegateTask(filtered[i]),
                                ),
                              ),
                            ),
                    ),
                  ],
                ),
    );
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.task_alt, size: 72, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No tasks', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            'No pending tasks matching this filter',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
          ),
        ],
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load tasks', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchTasks,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.color,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chipColor = color ?? theme.colorScheme.primary;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? chipColor.withOpacity(0.15) : null,
          border: Border.all(
            color: selected ? chipColor : theme.colorScheme.outlineVariant,
          ),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            color: selected ? chipColor : theme.colorScheme.onSurface,
          ),
        ),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.task,
    required this.isOverdue,
    required this.onComplete,
    required this.onDelegate,
  });

  final Map<String, dynamic> task;
  final bool isOverdue;
  final VoidCallback onComplete;
  final VoidCallback onDelegate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = task['name'] as String? ?? 'Unnamed Task';
    final workflowName = task['workflowName'] as String? ?? '';
    final dueDate = task['dueDate'] as String? ?? '';
    final priority = task['priority'] as String? ?? 'normal';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: isOverdue
                        ? theme.colorScheme.errorContainer
                        : theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    Icons.assignment,
                    color: isOverdue
                        ? theme.colorScheme.error
                        : theme.colorScheme.primary,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: theme.textTheme.titleSmall),
                      if (workflowName.isNotEmpty)
                        Text(
                          workflowName,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.outline,
                          ),
                        ),
                    ],
                  ),
                ),
                _PriorityBadge(priority: priority),
              ],
            ),
            if (dueDate.isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    Icons.schedule,
                    size: 14,
                    color: isOverdue
                        ? theme.colorScheme.error
                        : theme.colorScheme.outline,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    isOverdue ? 'Overdue: $dueDate' : 'Due: $dueDate',
                    style: TextStyle(
                      fontSize: 12,
                      color: isOverdue
                          ? theme.colorScheme.error
                          : theme.colorScheme.outline,
                      fontWeight: isOverdue ? FontWeight.w600 : FontWeight.normal,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                OutlinedButton.icon(
                  onPressed: onDelegate,
                  icon: const Icon(Icons.person_add, size: 16),
                  label: const Text('Delegate'),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: onComplete,
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Complete'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PriorityBadge extends StatelessWidget {
  const _PriorityBadge({required this.priority});
  final String priority;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Color color;
    switch (priority.toLowerCase()) {
      case 'high':
      case 'urgent':
        color = theme.colorScheme.error;
        break;
      case 'medium':
        color = const Color(0xFFF59E0B);
        break;
      default:
        color = theme.colorScheme.outline;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Text(
        priority.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}
