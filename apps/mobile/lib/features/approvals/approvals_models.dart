/// Approvals data models.
///
/// Read-only mobile view onto workflow-service's `workbaskets` module --
/// named, saved filters over the shared workflow task pool
/// (`services/workflow-service/src/modules/workbaskets/`). This complements,
/// rather than replaces, `features/workflow/my_tasks_screen.dart` (which
/// already covers the plain assignee/role-scoped `GET /v1/workflow/tasks`
/// inbox): this module is the genuinely-uncovered surface the COMP-008
/// roadmap (tranche 3) identified as Tier-1 pick #2 -- before this tranche,
/// `GET /v1/workflow/workbaskets` and `GET /v1/workflow/workbaskets/:code/tasks`
/// had zero mobile coverage.
///
/// Two real backend constraints shape this module (verified by reading
/// `services/workflow-service/src/modules/workbaskets/{routes,repo,domain,schema}.ts`
/// directly, not inferred from the roadmap doc):
///  - Neither workbasket endpoint supports real offset/cursor pagination.
///    `/v1/workflow/workbaskets` returns the tenant's full list, unpaginated.
///    `/v1/workflow/workbaskets/:code/tasks` accepts only a `limit` (default
///    100, max 500) -- no `offset`. Both responses' `meta.total` is exactly
///    `data.length`, not a true server-side count, so this module never
///    shows a "Showing X of Y" claim the way `features/field` honestly can
///    (its `/v1/field/tasks` really does return a true total). "Load more"
///    here re-fetches from scratch with a bigger `limit` rather than
///    appending a page.
///  - There is no single-task lookup route: no
///    `GET /v1/workflow/workbaskets/:code/tasks/:id`, and no
///    `GET /v1/workflow/tasks/:id` either (confirmed by reading
///    `tasks/routes.ts` directly -- that module only exposes list/complete/
///    claim/assign/bulk-complete). The detail screen therefore receives the
///    already-fetched task via GoRouter `extra` instead of re-fetching by id.
library;

enum ApprovalTaskStatus { pending, active, inProgress, completed, cancelled, escalated, unknown }

/// Wire value <-> enum, mirroring the exact set `workbaskets/domain.ts`'s
/// `ALLOWED_STATUS` accepts (the only place this status enum is formally
/// declared server-side).
extension ApprovalTaskStatusWire on ApprovalTaskStatus {
  String get wireValue {
    switch (this) {
      case ApprovalTaskStatus.pending:
        return 'pending';
      case ApprovalTaskStatus.active:
        return 'active';
      case ApprovalTaskStatus.inProgress:
        return 'in_progress';
      case ApprovalTaskStatus.completed:
        return 'completed';
      case ApprovalTaskStatus.cancelled:
        return 'cancelled';
      case ApprovalTaskStatus.escalated:
        return 'escalated';
      case ApprovalTaskStatus.unknown:
        return 'unknown';
    }
  }

  /// Human-friendly label for chips/pills/detail rows.
  String get label {
    switch (this) {
      case ApprovalTaskStatus.pending:
        return 'Pending';
      case ApprovalTaskStatus.active:
        return 'Active';
      case ApprovalTaskStatus.inProgress:
        return 'In Progress';
      case ApprovalTaskStatus.completed:
        return 'Completed';
      case ApprovalTaskStatus.cancelled:
        return 'Cancelled';
      case ApprovalTaskStatus.escalated:
        return 'Escalated';
      case ApprovalTaskStatus.unknown:
        return 'Unknown';
    }
  }

  /// True for a terminal status. A finished task can't meaningfully be
  /// "overdue" even if its due date has passed -- mirrors the exclusion
  /// `field_task_models.dart`'s `isOverdue` applies for the same reason.
  bool get isTerminal => this == ApprovalTaskStatus.completed || this == ApprovalTaskStatus.cancelled;
}

/// Falls back to [ApprovalTaskStatus.unknown] for a null/unrecognized value
/// -- never silently aliases a bad or future status onto a real one (same
/// convention as `field_task_models.dart`'s `fieldTaskStatusFromJson`).
ApprovalTaskStatus approvalTaskStatusFromJson(String? s) {
  switch (s) {
    case 'pending':
      return ApprovalTaskStatus.pending;
    case 'active':
      return ApprovalTaskStatus.active;
    case 'in_progress':
      return ApprovalTaskStatus.inProgress;
    case 'completed':
      return ApprovalTaskStatus.completed;
    case 'cancelled':
      return ApprovalTaskStatus.cancelled;
    case 'escalated':
      return ApprovalTaskStatus.escalated;
    default:
      return ApprovalTaskStatus.unknown;
  }
}

/// Human label for a task's `refType` (the business object a workflow task
/// approves) -- keyed off the same 4 values
/// `services/workflow-service/src/modules/tasks/routes.ts`'s
/// `REF_PERMISSION` map recognizes. Falls back to the raw refType string
/// (never a fabricated label) for anything else, since more refTypes clearly
/// exist server-side than that one permission map lists.
String approvalRefTypeLabel(String? refType) {
  switch (refType) {
    case 'leave_app':
      return 'Leave Application';
    case 'payroll_run':
      return 'Payroll Run';
    case 'procurement_indent':
      return 'Procurement Indent';
    case 'procurement_po':
      return 'Procurement PO';
    default:
      return refType ?? '—';
  }
}

DateTime? _dateFromJson(dynamic v) {
  if (v == null) return null;
  return DateTime.tryParse(v as String);
}

DateTime _dateFromJsonOrEpoch(dynamic v) =>
    _dateFromJson(v) ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);

/// A named, saved filter over the tenant's workflow task pool
/// (`GET /v1/workflow/workbaskets`; CAP-035 in the backend). Read-only here
/// -- creating/editing a workbasket (`PUT /v1/workflow/workbaskets/:code`) is
/// admin-only and out of scope for this tranche.
class Workbasket {
  const Workbasket({
    required this.id,
    required this.tenantId,
    required this.code,
    required this.name,
    required this.sortOrder,
    required this.createdAt,
    required this.updatedAt,
    this.description,
    this.filter = const {},
  });

  final String id;
  final String tenantId;
  final String code;
  final String name;
  final String? description;

  /// Raw saved filter (`status[]`/`assigneeId`/`unassigned`/`roleRef`/
  /// `overdue` -- see `workbaskets/domain.ts`'s `WorkbasketFilter`). Kept as
  /// a raw map rather than fully modeled: this screen only needs to
  /// summarize it for display ([filterSummary]), not act on individual
  /// fields the way the backend's own `normalizeFilter` does.
  final Map<String, dynamic> filter;
  final String sortOrder;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory Workbasket.fromJson(Map<String, dynamic> json) => Workbasket(
        id: json['id'] as String? ?? '',
        tenantId: json['tenantId'] as String? ?? '',
        // A workbasket with no code can't be queried for its tasks at all;
        // fall back to id so the UI at least has a stable, non-empty key
        // rather than a cast exception (established defensive-parse
        // convention -- see `field_task_models.dart`'s `id` fallback).
        code: (json['code'] as String?)?.isNotEmpty == true
            ? json['code'] as String
            : (json['id'] as String? ?? ''),
        name: json['name'] as String? ?? 'Untitled workbasket',
        description: json['description'] as String?,
        filter: (json['filter'] as Map<String, dynamic>?) ?? const {},
        sortOrder: json['sortOrder'] as String? ?? 'created_at',
        createdAt: _dateFromJsonOrEpoch(json['createdAt']),
        updatedAt: _dateFromJsonOrEpoch(json['updatedAt']),
      );

  /// Short, human summary of the saved filter for a card subtitle, e.g.
  /// "Status: pending, escalated · Unassigned · Overdue only". Never
  /// fabricates a criterion that isn't actually present in [filter].
  String get filterSummary {
    final parts = <String>[];
    final status = filter['status'];
    if (status is List && status.isNotEmpty) {
      parts.add('Status: ${status.join(', ')}');
    }
    if (filter['unassigned'] == true) {
      parts.add('Unassigned');
    } else {
      final assignee = filter['assigneeId'];
      if (assignee is String && assignee.isNotEmpty) {
        parts.add('Assignee: $assignee');
      }
    }
    final roleRef = filter['roleRef'];
    if (roleRef is String && roleRef.isNotEmpty) {
      parts.add('Role: $roleRef');
    }
    if (filter['overdue'] == true) {
      parts.add('Overdue only');
    }
    return parts.isEmpty ? 'No filter criteria (all tasks)' : parts.join(' · ');
  }
}

/// One task surfaced by a workbasket
/// (`GET /v1/workflow/workbaskets/:code/tasks`). This endpoint sends the
/// backend's full row (`workbaskets/repo.ts`'s `resolveTasks` returns raw
/// `TaskRow`s with no schema projection) -- a richer shape than
/// `/v1/workflow/tasks`'s slim `taskViewSchema`. `dueAt`/`createdAt`/
/// `updatedAt` are only available via this route, not the plain tasks list.
class WorkbasketTask {
  const WorkbasketTask({
    required this.id,
    required this.tenantId,
    required this.instanceId,
    required this.name,
    required this.status,
    required this.escalationCount,
    required this.createdAt,
    required this.updatedAt,
    required this.version,
    this.roleRef,
    this.nodeKey,
    this.refType,
    this.refId,
    this.decision,
    this.assigneeId,
    this.dueAt,
  });

  final String id;
  final String tenantId;
  final String instanceId;
  final String name;
  final ApprovalTaskStatus status;
  final String? roleRef;
  final String? nodeKey;
  final String? refType;
  final String? refId;
  final String? decision;
  final String? assigneeId;
  final DateTime? dueAt;
  final int escalationCount;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int version;

  /// Mirrors `workbaskets/repo.ts`'s own `overdue` filter predicate
  /// (`dueAt IS NOT NULL AND dueAt < now()`), plus excluding terminal
  /// statuses -- the backend filter alone doesn't exclude completed/
  /// cancelled tasks, but showing a finished task as "overdue" in this UI
  /// would be misleading.
  bool get isOverdue {
    final due = dueAt;
    if (due == null || status.isTerminal) return false;
    return due.isBefore(DateTime.now().toUtc());
  }

  factory WorkbasketTask.fromJson(Map<String, dynamic> json) => WorkbasketTask(
        id: json['id'] as String? ?? '',
        tenantId: json['tenantId'] as String? ?? '',
        instanceId: json['instanceId'] as String? ?? '',
        name: json['name'] as String? ?? 'Untitled task',
        status: approvalTaskStatusFromJson(json['status'] as String?),
        roleRef: json['roleRef'] as String?,
        nodeKey: json['nodeKey'] as String?,
        refType: json['refType'] as String?,
        refId: json['refId'] as String?,
        decision: json['decision'] as String?,
        assigneeId: json['assigneeId'] as String?,
        dueAt: _dateFromJson(json['dueAt']),
        escalationCount: (json['escalationCount'] as num?)?.toInt() ?? 0,
        createdAt: _dateFromJsonOrEpoch(json['createdAt']),
        updatedAt: _dateFromJsonOrEpoch(json['updatedAt']),
        version: (json['version'] as num?)?.toInt() ?? 1,
      );
}
