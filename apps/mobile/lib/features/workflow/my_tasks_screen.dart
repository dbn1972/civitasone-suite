import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart'; // Fix: [AUDIT-P2-6]

/// Workflow Tasks — list of pending tasks assigned to the current user.
/// GET /v1/workflow/tasks?assignee=me&status=pending&limit=&offset=
/// POST /v1/workflow/tasks/:id/complete
///
/// COMP-008 mytasks-cleanup — three verified pre-existing bugs fixed here:
///  - This screen read `dueDate`/`priority`/`workflowName`, none of which
///    exist on the wire. The real due-date column is `dueAt`
///    (`services/workflow-service/src/modules/tasks/schema.ts`), and it was
///    ALSO being silently dropped by this endpoint's own response
///    projection (`repo.ts`'s `toView()` + `validators.ts`'s
///    `taskViewSchema`) even under its real name — fixed there too, so a
///    plain rename here wasn't a cosmetic no-op. `priority` and
///    `workflowName` have no backing column anywhere in the workflow
///    domain (`tasks`/`instances`/`definitions` schemas all checked) --
///    genuinely dead, removed rather than left silently broken or backed by
///    invented placeholder data. (The closest real concept to
///    "workflow name" is `definitions.name`, reachable only via a new
///    tasks→instances→definitions join this endpoint doesn't do today --
///    a bigger lift than a read-path field fix belongs in its own tranche.)
///  - No pagination: fetched and rendered the entire pending-task list in
///    one shot. Now pages via real `limit`/`offset` (this endpoint's
///    `pagination.hasMore` is an honest server-computed flag, unlike the
///    `/v1/workflow/workbaskets/*` endpoints), mirroring
///    `features/field/field_task_list_screen.dart`'s append-by-offset
///    mechanics. This endpoint never returns a true `total` though (see
///    `queries.listTasks`), so the "Load more" footer follows
///    `features/approvals/approvals_workbasket_list_screen.dart`'s
///    `_LoadMoreButton` precedent instead of `core/widgets/load_more_footer.dart`
///    (which requires a real total) -- "N loaded", never a fabricated
///    "of Y".
///  - The "Delegate" button posted to `/v1/workflow/tasks/:id/delegate`,
///    which has never existed (confirmed via a repo-wide route grep: the
///    only task-mutation routes are complete/claim/assign/bulk-complete).
///    The real `delegations` feature
///    (`services/workflow-service/src/modules/delegations/`) is a separate,
///    whole-person/date-ranged authority handoff
///    (`POST /v1/workflow/delegations` — delegateId + fromDate/toDate), not
///    a per-task action, so it isn't a drop-in replacement for this button.
///    A per-task `POST /v1/workflow/tasks/:id/assign` does exist but is
///    role-gated to admin roles (`workflow_admin`/`super_admin`/
///    `tenant_admin`) and means "reassign", not "hand off my own task" --
///    wiring a regular task-holder's button to it would newly cross a
///    permission boundary this tranche isn't scoped to decide. Removed
///    rather than guessed.
///
/// Known, separate, NOT fixed here: `assignee=me` below is accepted by this
/// screen's request but silently ignored server-side today -- the list
/// route only filters by role (`listPendingForRoles`), not by assignee, so
/// this screen actually shows every pending task visible to the caller's
/// roles, not strictly "assigned to me." Left alone deliberately: real
/// assignee-scoping is a visibility/role-adjacent change, out of scope for
/// this read-path-bugfix tranche.
class MyTasksScreen extends ConsumerStatefulWidget {
  const MyTasksScreen({super.key});

  @override
  ConsumerState<MyTasksScreen> createState() => _MyTasksScreenState();
}

enum _TaskFilter { all, overdue, dueToday, upcoming }

class _MyTasksScreenState extends ConsumerState<MyTasksScreen> {
  // Matches packages/schemas/src/common.ts's listQuerySchema default, made
  // explicit here rather than relying implicitly on the server default.
  static const _pageSize = 50;

  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  List<Map<String, dynamic>> _tasks = [];
  bool _hasMore = false;
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
        params: {
          'assignee': 'me',
          'status': 'pending',
          'limit': _pageSize,
          'offset': 0,
        },
      );
      final data = res.data?['data'] as List<dynamic>? ?? [];
      final pagination = res.data?['pagination'] as Map<String, dynamic>?;
      _tasks = data.cast<Map<String, dynamic>>();
      _hasMore = pagination?['hasMore'] as bool? ?? false;
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

  /// Fetches the next page (offset = number already loaded) and appends it.
  /// Mirrors `field_task_list_screen.dart`'s `_loadMore`: failures surface as
  /// a snackbar rather than replacing the already-loaded page with an error.
  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/workflow/tasks',
        params: {
          'assignee': 'me',
          'status': 'pending',
          'limit': _pageSize,
          'offset': _tasks.length,
        },
      );
      final data = res.data?['data'] as List<dynamic>? ?? [];
      final pagination = res.data?['pagination'] as Map<String, dynamic>?;
      final more = data.cast<Map<String, dynamic>>();
      setState(() {
        _tasks = [..._tasks, ...more];
        _hasMore = pagination?['hasMore'] as bool? ?? false;
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
    final due = task['dueAt'] as String?;
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

  // Fix: [AUDIT-P3-9] Count badges for filter chips
  bool _isDueToday(Map<String, dynamic> task) {
    final due = _parseDueDate(task);
    if (due == null) return false;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final tomorrow = today.add(const Duration(days: 1));
    return !due.isBefore(today) && due.isBefore(tomorrow);
  }

  bool _isUpcoming(Map<String, dynamic> task) {
    final due = _parseDueDate(task);
    if (due == null) return false;
    final now = DateTime.now();
    final tomorrow = DateTime(now.year, now.month, now.day).add(const Duration(days: 1));
    return !due.isBefore(tomorrow);
  }

  int _countForFilter(String filter) {
    switch (filter) {
      case 'Overdue':
        return _tasks.where((t) => _isOverdue(t)).length;
      case 'Due Today':
        return _tasks.where((t) => _isDueToday(t)).length;
      case 'Upcoming':
        return _tasks.where((t) => _isUpcoming(t)).length;
      default:
        return _tasks.length;
    }
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
            content: Text(userFriendlyError(e)), // Fix: [AUDIT-P2-6]
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredTasks;
    // "Load more" is scoped to the unfiltered feed, same rationale as
    // field_task_list_screen.dart / approvals_workbasket_list_screen.dart:
    // it always fetches the next page of the full pending-task pool, which
    // may add zero visible cards to a narrow due-date bucket like "Overdue"
    // -- offering it there would be confusing about what actually grew.
    final showLoadMoreFooter = _filter == _TaskFilter.all && _hasMore;

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
                    // Fix: [AUDIT-P2-3] Semantics on filter chips + [AUDIT-P3-9] count badges
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        children: [
                          _FilterChip(
                            label: 'All (${_countForFilter('All')})',
                            selected: _filter == _TaskFilter.all,
                            onTap: () => setState(() => _filter = _TaskFilter.all),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Overdue (${_countForFilter('Overdue')})',
                            selected: _filter == _TaskFilter.overdue,
                            onTap: () => setState(() => _filter = _TaskFilter.overdue),
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Due Today (${_countForFilter('Due Today')})',
                            selected: _filter == _TaskFilter.dueToday,
                            onTap: () => setState(() => _filter = _TaskFilter.dueToday),
                            color: const Color(0xFFF59E0B),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Upcoming (${_countForFilter('Upcoming')})',
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
                                itemCount: filtered.length + (showLoadMoreFooter ? 1 : 0),
                                itemBuilder: (ctx, i) {
                                  if (i == filtered.length) {
                                    return _LoadMoreFooter(
                                      loaded: _tasks.length,
                                      loading: _loadingMore,
                                      onLoadMore: _loadMore,
                                    );
                                  }
                                  final t = filtered[i];
                                  return _TaskCard(
                                    task: t,
                                    dueAt: _parseDueDate(t),
                                    isOverdue: _isOverdue(t),
                                    onComplete: () => _completeTask(t),
                                  );
                                },
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

    // Fix: [AUDIT-P2-3] Semantics for accessibility
    return Semantics(
      label: '$label filter${selected ? ", selected" : ""}',
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          // Fix: [AUDIT-P2-3] Increase padding to meet 48dp touch target
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.task,
    required this.dueAt,
    required this.isOverdue,
    required this.onComplete,
  });

  final Map<String, dynamic> task;
  final DateTime? dueAt;
  final bool isOverdue;
  final VoidCallback onComplete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = task['name'] as String? ?? 'Unnamed Task';

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
                  child: Text(name, style: theme.textTheme.titleSmall),
                ),
              ],
            ),
            if (dueAt != null) ...[
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
                    isOverdue ? 'Overdue: ${_shortDate(dueAt!)}' : 'Due: ${_shortDate(dueAt!)}',
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

  // Matches approvals_workbasket_list_screen.dart's _TaskCard._shortDate
  // convention exactly (dd/mm/yyyy, localized).
  static String _shortDate(DateTime d) {
    final local = d.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}/${local.year}';
  }
}

/// Honest "load more" footer for an endpoint with no true server-side total
/// (see queries.listTasks — pagination carries `hasMore`/`pageSize` but never
/// `total`). Deliberately does not claim "Showing X of Y" -- mirrors
/// approvals_workbasket_list_screen.dart's `_LoadMoreButton` for the same
/// reason, rather than reusing core/widgets/load_more_footer.dart (which
/// requires a real total).
class _LoadMoreFooter extends StatelessWidget {
  const _LoadMoreFooter({required this.loaded, required this.loading, required this.onLoadMore});

  final int loaded;
  final bool loading;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
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
