import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart';
import '../../core/widgets/status_pill.dart';
import 'approvals_models.dart';

/// Approval workbaskets -- a supervisor-configured queue of workflow tasks
/// (`GET /v1/workflow/workbaskets`), drilled into per-workbasket
/// (`GET /v1/workflow/workbaskets/:code/tasks`).
///
/// Read-only in this first mobile slice: creating/editing a workbasket and
/// acting on a task (complete/claim/assign) stay web-only for now (see
/// COMP-008 roadmap, tranche 5).
///
/// Deliberately does NOT show a "Showing X of Y" count: neither workbasket
/// endpoint returns a true total (see `approvals_models.dart`'s doc comment
/// for the verified backend contract). "Load more" instead re-fetches from
/// scratch with a bigger `limit`, and is only offered while the last fetch
/// came back exactly as full as it was asked for.
class ApprovalsWorkbasketListScreen extends ConsumerStatefulWidget {
  const ApprovalsWorkbasketListScreen({super.key});

  @override
  ConsumerState<ApprovalsWorkbasketListScreen> createState() => _ApprovalsWorkbasketListScreenState();
}

class _ApprovalsWorkbasketListScreenState extends ConsumerState<ApprovalsWorkbasketListScreen> {
  static const _pageStep = 100;
  static const _pageMax = 500;

  bool _loadingWorkbaskets = true;
  String? _workbasketsError;
  List<Workbasket> _workbaskets = [];
  String? _selectedCode;

  bool _loadingTasks = false;
  String? _tasksError;
  List<WorkbasketTask> _tasks = [];
  int _limit = _pageStep;

  bool _isOnline = true;

  ApprovalTaskStatus? _statusFilter;
  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _searchCtrl.addListener(() {
      setState(() => _query = _searchCtrl.text.trim().toLowerCase());
    });
    _fetchWorkbaskets();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Workbasket? get _selectedWorkbasket {
    final code = _selectedCode;
    if (code == null) return null;
    for (final w in _workbaskets) {
      if (w.code == code) return w;
    }
    return null;
  }

  /// True only while the most recent fetch came back exactly as full as it
  /// was asked for (the one signal either endpoint gives that there might be
  /// more) and we haven't already hit the server's own cap.
  bool get _mightHaveMore => _tasks.length == _limit && _limit < _pageMax;

  Future<void> _fetchWorkbaskets() async {
    setState(() {
      _loadingWorkbaskets = true;
      _workbasketsError = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/workflow/workbaskets');
      final body = res.data ?? const <String, dynamic>{};
      final data = body['data'] as List<dynamic>? ?? [];
      final baskets = data.cast<Map<String, dynamic>>().map(Workbasket.fromJson).toList();
      final stillValid = _selectedCode != null && baskets.any((w) => w.code == _selectedCode);
      setState(() {
        _workbaskets = baskets;
        _isOnline = true;
        if (!stillValid) {
          _selectedCode = baskets.isEmpty ? null : baskets.first.code;
          _limit = _pageStep;
          _statusFilter = null;
        }
      });
      if (_selectedCode != null) {
        await _fetchTasks();
      } else if (mounted) {
        setState(() => _tasks = []);
      }
    } catch (e) {
      setState(() {
        _workbasketsError = userFriendlyError(e);
        if (e is DioException && e.type == DioExceptionType.connectionError) _isOnline = false;
      });
    } finally {
      if (mounted) setState(() => _loadingWorkbaskets = false);
    }
  }

  Future<void> _selectWorkbasket(String code) async {
    if (code == _selectedCode) return;
    setState(() {
      _selectedCode = code;
      _limit = _pageStep;
      _statusFilter = null;
      _tasks = [];
    });
    await _fetchTasks();
  }

  Future<void> _fetchTasks() async {
    final code = _selectedCode;
    if (code == null) return;
    setState(() {
      _loadingTasks = true;
      _tasksError = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/workflow/workbaskets/$code/tasks',
        params: {'limit': _limit},
      );
      final body = res.data ?? const <String, dynamic>{};
      final data = body['data'] as List<dynamic>? ?? [];
      final tasks = data.cast<Map<String, dynamic>>().map(WorkbasketTask.fromJson).toList();
      setState(() {
        _tasks = tasks;
        _isOnline = true;
      });
    } catch (e) {
      setState(() {
        _tasksError = userFriendlyError(e);
        if (e is DioException && e.type == DioExceptionType.connectionError) _isOnline = false;
      });
    } finally {
      if (mounted) setState(() => _loadingTasks = false);
    }
  }

  Future<void> _loadMore() async {
    if (_loadingTasks || !_mightHaveMore) return;
    setState(() => _limit = (_limit + _pageStep > _pageMax) ? _pageMax : _limit + _pageStep);
    await _fetchTasks();
  }

  void _setStatusFilter(ApprovalTaskStatus? status) {
    if (_statusFilter == status) return;
    setState(() => _statusFilter = status);
  }

  List<WorkbasketTask> get _filtered {
    var list = _tasks;
    final status = _statusFilter;
    if (status != null) {
      list = list.where((t) => t.status == status).toList();
    }
    if (_query.isNotEmpty) {
      list = list.where((t) {
        return t.name.toLowerCase().contains(_query) ||
            approvalRefTypeLabel(t.refType).toLowerCase().contains(_query) ||
            (t.roleRef?.toLowerCase().contains(_query) ?? false);
      }).toList();
    }
    return list;
  }

  /// Distinct statuses actually present in the currently loaded page, in
  /// enum-declaration order. Built from what's on screen, not a fixed list --
  /// a workbasket whose saved filter only ever surfaces two statuses
  /// shouldn't offer four dead chips.
  List<ApprovalTaskStatus> get _statusesPresent {
    final present = _tasks.map((t) => t.status).toSet();
    return ApprovalTaskStatus.values.where(present.contains).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Approvals'),
        actions: [
          Semantics(
            label: 'Refresh workbaskets',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
              onPressed: _loadingWorkbaskets ? null : _fetchWorkbaskets,
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
          Expanded(child: _buildBody(theme)),
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loadingWorkbaskets) return const Center(child: CircularProgressIndicator());
    if (_workbasketsError != null && _workbaskets.isEmpty) {
      return _ErrorState(message: _workbasketsError!, onRetry: _fetchWorkbaskets);
    }
    if (_workbaskets.isEmpty) {
      return const _EmptyState(
        icon: Icons.move_to_inbox_outlined,
        title: 'No approval workbaskets yet',
        subtitle: 'Ask an administrator to set one up for your tenant.',
      );
    }

    final selected = _selectedWorkbasket;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final w in _workbaskets) ...[
                  _WorkbasketChip(
                    key: ValueKey('workbasketChip_${w.code}'),
                    label: w.name,
                    selected: w.code == _selectedCode,
                    onTap: () => _selectWorkbasket(w.code),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
        ),
        if (selected != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                selected.filterSummary,
                style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
              ),
            ),
          ),
        if (_tasks.isNotEmpty) _buildStatusChips(theme),
        if (!_loadingTasks && _tasksError == null && _tasks.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search name, reference type, or role',
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        Expanded(child: _buildTasksArea(theme)),
      ],
    );
  }

  Widget _buildStatusChips(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _StatusChip(
              key: const ValueKey('statusChip_all'),
              label: 'All',
              selected: _statusFilter == null,
              onTap: () => _setStatusFilter(null),
            ),
            for (final s in _statusesPresent) ...[
              const SizedBox(width: 8),
              _StatusChip(
                key: ValueKey('statusChip_${s.wireValue}'),
                label: s.label,
                selected: _statusFilter == s,
                onTap: () => _setStatusFilter(s),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildTasksArea(ThemeData theme) {
    if (_loadingTasks && _tasks.isEmpty) return const Center(child: CircularProgressIndicator());
    if (_tasksError != null && _tasks.isEmpty) {
      return _ErrorState(message: _tasksError!, onRetry: _fetchTasks);
    }
    if (_tasks.isEmpty) {
      return const _EmptyState(
        icon: Icons.task_alt,
        title: 'No tasks in this workbasket',
        subtitle: 'Tasks matching its saved filter will appear here.',
      );
    }
    final visible = _filtered;
    if (visible.isEmpty) {
      return const _EmptyState(
        icon: Icons.search_off,
        title: 'No matches',
        subtitle: 'Try a different search term or status filter.',
      );
    }
    // "Load more" only makes sense against the unfiltered page -- while a
    // status/search filter is narrowing what's on screen, offering to fetch
    // a bigger unfiltered page would be confusing (same rationale as
    // `field_task_list_screen.dart`'s footer gate).
    final showFooter = _query.isEmpty && _statusFilter == null && _mightHaveMore;
    return RefreshIndicator(
      onRefresh: _fetchTasks,
      child: ListView.builder(
        key: const Key('approvalsTasksList'),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: visible.length + (showFooter ? 1 : 0),
        itemBuilder: (ctx, i) {
          if (i == visible.length) {
            return _LoadMoreButton(loading: _loadingTasks, loaded: _tasks.length, onLoadMore: _loadMore);
          }
          final task = visible[i];
          return _TaskCard(
            task: task,
            onTap: () => context.go('/approvals/tasks/${task.id}', extra: task),
          );
        },
      ),
    );
  }
}

class _WorkbasketChip extends StatelessWidget {
  const _WorkbasketChip({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: 'Workbasket $label${selected ? ", selected" : ""}',
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({super.key, required this.label, required this.selected, required this.onTap});
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
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? theme.colorScheme.secondaryContainer : null,
            border: Border.all(
              color: selected ? theme.colorScheme.secondary : theme.colorScheme.outlineVariant,
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
              color: selected ? theme.colorScheme.onSecondaryContainer : theme.colorScheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({required this.task, required this.onTap});
  final WorkbasketTask task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: 'Approval task ${task.name}, status ${task.status.label}',
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
                      child: Text(task.name,
                          style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    ),
                    StatusPill(status: task.status.wireValue),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        approvalRefTypeLabel(task.refType),
                        style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ),
                    if (task.roleRef != null && task.roleRef!.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Icon(Icons.badge_outlined, size: 14, color: theme.colorScheme.outline),
                      const SizedBox(width: 2),
                      Expanded(
                        child: Text(task.roleRef!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
                      ),
                    ],
                  ],
                ),
                if (task.dueAt != null) ...[
                  const SizedBox(height: 8),
                  Row(children: [
                    Icon(Icons.schedule,
                        size: 14,
                        color: task.isOverdue ? theme.colorScheme.error : theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(
                      task.isOverdue ? 'Overdue' : 'Due ${_shortDate(task.dueAt!)}',
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

  static String _shortDate(DateTime d) {
    final local = d.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}/${local.year}';
  }
}

class _LoadMoreButton extends StatelessWidget {
  const _LoadMoreButton({required this.loading, required this.loaded, required this.onLoadMore});
  final bool loading;
  final int loaded;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Deliberately doesn't claim "Showing X of Y": neither workbasket
    // endpoint returns a true total (see approvals_models.dart). All this
    // can honestly say is how many are loaded and that there might be more.
    return Semantics(
      label: loading ? 'Loading more' : '$loaded loaded. Load more available',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('$loaded loaded', style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
              const SizedBox(height: 8),
              if (loading)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                OutlinedButton(onPressed: onLoadMore, child: const Text('Load more')),
            ],
          ),
        ),
      ),
    );
  }
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
          Text('Unable to load approvals', style: theme.textTheme.titleMedium),
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
