import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/load_more_footer.dart';
import 'field_task_models.dart';

/// Field Task list -- field agents/admins see their assigned work while out
/// on site.
///
/// GET /v1/field/tasks -> paginated list of tasks for the tenant, filterable
/// by status/assigneeId/dueBefore/dueAfter (see
/// `services/field-service/src/modules/tasks/routes.ts`).
///
/// Read-only in this first mobile slice: create/assign/start/complete/cancel
/// stay web-only for now (see COMP-008 roadmap, tranche 4).
///
/// Paginated: fetches [_pageSize] at a time and shows a "Load more" footer
/// backed by the server's `meta.total`, so a tenant with more than one page
/// of tasks gets an honest count instead of a silently truncated list (the
/// pagination bug tranche 1 shipped and tranche 2 fixed for trade licenses --
/// built right from the start here instead).
class FieldTaskListScreen extends ConsumerStatefulWidget {
  const FieldTaskListScreen({super.key});

  @override
  ConsumerState<FieldTaskListScreen> createState() => _FieldTaskListScreenState();
}

class _FieldTaskListScreenState extends ConsumerState<FieldTaskListScreen> {
  static const _pageSize = 100;

  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  List<FieldTask> _tasks = [];
  int _total = 0;
  bool _isOnline = true;

  FieldTaskStatus? _statusFilter;
  bool _showFilters = false;
  final _assigneeCtrl = TextEditingController();
  DateTime? _dueAfterFilter;
  DateTime? _dueBeforeFilter;

  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _searchCtrl.addListener(() {
      setState(() => _query = _searchCtrl.text.trim().toLowerCase());
    });
    _fetchTasks();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _assigneeCtrl.dispose();
    super.dispose();
  }

  Map<String, dynamic> _paramsFor(int offset) => buildFieldTaskQueryParams(
        limit: _pageSize,
        offset: offset,
        status: _statusFilter,
        assigneeId: _assigneeCtrl.text,
        dueAfter: _dueAfterFilter,
        dueBefore: _dueBeforeFilter,
      );

  Future<void> _fetchTasks() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/field/tasks',
        params: _paramsFor(0),
      );
      final body = res.data ?? const <String, dynamic>{};
      final data = body['data'] as List<dynamic>? ?? [];
      final meta = body['meta'] as Map<String, dynamic>?;
      _tasks = data.cast<Map<String, dynamic>>().map(FieldTask.fromJson).toList();
      // Fall back to the loaded count when the server omits `meta` so
      // pagination degrades to "everything fits on one page" rather than
      // showing a bogus "Load more".
      _total = (meta?['total'] as num?)?.toInt() ?? _tasks.length;
      _isOnline = true;
    } catch (e) {
      _error = userFriendlyError(e);
      if (e is DioException && e.type == DioExceptionType.connectionError) {
        _isOnline = false;
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Fetches the next page (offset = number already loaded) and appends it.
  /// Failures surface as a snackbar rather than replacing the already-loaded
  /// page with an error state.
  Future<void> _loadMore() async {
    if (_loadingMore || _tasks.length >= _total) return;
    setState(() => _loadingMore = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/field/tasks',
        params: _paramsFor(_tasks.length),
      );
      final body = res.data ?? const <String, dynamic>{};
      final data = body['data'] as List<dynamic>? ?? [];
      final meta = body['meta'] as Map<String, dynamic>?;
      final more = data.cast<Map<String, dynamic>>().map(FieldTask.fromJson).toList();
      setState(() {
        _tasks = [..._tasks, ...more];
        _total = (meta?['total'] as num?)?.toInt() ?? _total;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not load more: ${userFriendlyError(e)}')),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _setStatusFilter(FieldTaskStatus? status) {
    if (_statusFilter == status) return;
    setState(() => _statusFilter = status);
    _fetchTasks();
  }

  void _applySecondaryFilters() {
    _fetchTasks();
  }

  void _clearSecondaryFilters() {
    setState(() {
      _assigneeCtrl.clear();
      _dueAfterFilter = null;
      _dueBeforeFilter = null;
    });
    _fetchTasks();
  }

  Future<void> _pickDate({required bool isAfter}) async {
    final initial = (isAfter ? _dueAfterFilter : _dueBeforeFilter) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    setState(() {
      if (isAfter) {
        _dueAfterFilter = picked;
      } else {
        _dueBeforeFilter = picked;
      }
    });
  }

  String _formatFilterDate(DateTime? d) {
    if (d == null) return 'Any';
    return '${d.day.toString().padLeft(2, '0')}/'
        '${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  List<FieldTask> get _filtered {
    if (_query.isEmpty) return _tasks;
    return _tasks.where((t) {
      return t.title.toLowerCase().contains(_query) ||
          t.taskType.toLowerCase().contains(_query) ||
          (t.address?.toLowerCase().contains(_query) ?? false);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final visible = _filtered;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Field Tasks'),
        actions: [
          Semantics(
            label: 'Toggle filters',
            child: IconButton(
              tooltip: 'Filters',
              icon: Icon(_showFilters ? Icons.filter_alt : Icons.filter_alt_outlined),
              onPressed: () => setState(() => _showFilters = !_showFilters),
            ),
          ),
          Semantics(
            label: 'Refresh field tasks',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
              onPressed: _fetchTasks,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (!_isOnline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(children: [
                Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade800),
                const SizedBox(width: 8),
                Text('Offline — showing cached data',
                    style: TextStyle(fontSize: 12, color: Colors.orange.shade800)),
              ]),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _StatusChip(
                    label: 'All',
                    selected: _statusFilter == null,
                    onTap: () => _setStatusFilter(null),
                  ),
                  for (final s in FieldTaskStatus.values.where((s) => s != FieldTaskStatus.unknown)) ...[
                    const SizedBox(width: 8),
                    _StatusChip(
                      label: s.label,
                      selected: _statusFilter == s,
                      onTap: () => _setStatusFilter(s),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_showFilters)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        key: const Key('fieldTaskAssigneeFilter'),
                        controller: _assigneeCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Assignee ID',
                          hintText: 'Paste an agent\'s user ID',
                          isDense: true,
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => _pickDate(isAfter: true),
                              child: Text('Due after: ${_formatFilterDate(_dueAfterFilter)}'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => _pickDate(isAfter: false),
                              child: Text('Due before: ${_formatFilterDate(_dueBeforeFilter)}'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: _clearSecondaryFilters,
                            child: const Text('Clear'),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            onPressed: _applySecondaryFilters,
                            child: const Text('Apply'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (!_loading && _error == null && _tasks.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: TextField(
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: 'Search title, type, or address',
                  prefixIcon: const Icon(Icons.search),
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            ),
          Expanded(child: _buildBody(theme, visible)),
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme, List<FieldTask> visible) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _tasks.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _fetchTasks);
    }
    if (_tasks.isEmpty) {
      return const _EmptyState(
        icon: Icons.assignment_outlined,
        title: 'No field tasks found',
        subtitle: 'Tasks matching these filters will appear here',
      );
    }
    if (visible.isEmpty) {
      return const _EmptyState(
        icon: Icons.search_off,
        title: 'No matches',
        subtitle: 'Try a different search term',
      );
    }
    // Pagination is scoped to the unfiltered feed. While actively searching,
    // hide the footer rather than offering to "load more" of a total that
    // doesn't describe the filtered view on screen.
    final showFooter = _query.isEmpty && _tasks.length < _total;
    return RefreshIndicator(
      onRefresh: _fetchTasks,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: visible.length + (showFooter ? 1 : 0),
        itemBuilder: (ctx, i) {
          if (i == visible.length) {
            return LoadMoreFooter(
              loaded: _tasks.length,
              total: _total,
              loading: _loadingMore,
              onLoadMore: _loadMore,
            );
          }
          return _TaskCard(
            task: visible[i],
            onTap: () => context.go('/field/tasks/${visible[i].id}'),
          );
        },
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: '$label filter${selected ? ", selected" : ""}',
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? theme.colorScheme.primary.withOpacity(0.15) : null,
            border: Border.all(
              color: selected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
              color: selected ? theme.colorScheme.primary : theme.colorScheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({required this.task, required this.onTap});
  final FieldTask task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: 'Field task ${task.title}, status ${task.status.label}',
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(task.title,
                              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text(task.taskType,
                              style: theme.textTheme.bodySmall
                                  ?.copyWith(color: theme.colorScheme.outline)),
                        ],
                      ),
                    ),
                    StatusPill(status: task.status.wireValue),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        fieldTaskPriorityLabel(task.priority),
                        style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ),
                    if (task.address != null && task.address!.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Icon(Icons.location_on_outlined, size: 14, color: theme.colorScheme.outline),
                      const SizedBox(width: 2),
                      Expanded(
                        child: Text(task.address!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
                      ),
                    ],
                  ],
                ),
                if (task.dueDate != null) ...[
                  const SizedBox(height: 8),
                  Row(children: [
                    Icon(Icons.schedule,
                        size: 14,
                        color: task.isOverdue ? theme.colorScheme.error : theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(
                      task.isOverdue ? 'Overdue' : 'Due ${_shortDate(task.dueDate!)}',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: task.isOverdue ? FontWeight.w600 : FontWeight.normal,
                        color: task.isOverdue ? theme.colorScheme.error : theme.colorScheme.outline,
                      ),
                    ),
                  ]),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  static String _shortDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.title, required this.subtitle});
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 64, color: theme.colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(title, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Text(subtitle,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
      ]),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load field tasks', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
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
