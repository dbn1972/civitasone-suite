import 'dart:collection';

/// A single sync route mapping a mobile write action to a backend domain
/// service command topic and HTTP endpoint.
class SyncRoute {
  const SyncRoute({
    required this.service,
    required this.topic,
    required this.endpoint,
    this.method = 'POST',
  });

  /// The owning domain service name (e.g., 'hrms', 'finance').
  final String service;

  /// The command topic the domain service consumes (e.g., 'hrms.leave.create').
  final String topic;

  /// The HTTP command endpoint on the domain service (e.g., '/v1/hrms/leaves').
  final String endpoint;

  /// HTTP method — defaults to POST for creates, PATCH for updates.
  final String method;

  @override
  String toString() => 'SyncRoute(service: $service, topic: $topic, endpoint: $endpoint)';
}

/// Registry mapping mobile UI write actions to domain service command topics.
///
/// Each key is a dot-separated action identifier in the form
/// `{module}.{operation}` (e.g., `leave.create`, `attendance.mark`).
/// The value is a [SyncRoute] containing the target service, topic, and endpoint.
///
/// Usage:
/// ```dart
/// final route = SyncRouteRegistry.resolve('leave.create');
/// // → SyncRoute(service: 'hrms', topic: 'hrms.leave.create', endpoint: '/v1/hrms/leaves')
/// ```
class SyncRouteRegistry {
  SyncRouteRegistry._();

  /// All registered sync routes, keyed by action identifier.
  static final Map<String, SyncRoute> _routes = UnmodifiableMapView(<String, SyncRoute>{
    // ── HRMS ──────────────────────────────────────────────────────────────
    'leave.create': const SyncRoute(
      service: 'hrms',
      topic: 'hrms.leave.create',
      endpoint: '/v1/hrms/leaves',
    ),
    'leave.update': const SyncRoute(
      service: 'hrms',
      topic: 'hrms.leave.update',
      endpoint: '/v1/hrms/leaves',
      method: 'PATCH',
    ),
    'attendance.mark': const SyncRoute(
      service: 'hrms',
      topic: 'hrms.attendance.mark',
      endpoint: '/v1/hrms/attendance',
    ),
    'attendance.update': const SyncRoute(
      service: 'hrms',
      topic: 'hrms.attendance.update',
      endpoint: '/v1/hrms/attendance',
      method: 'PATCH',
    ),

    // ── Finance ───────────────────────────────────────────────────────────
    'bill.create': const SyncRoute(
      service: 'finance',
      topic: 'finance.bill.create',
      endpoint: '/v1/finance/bills',
    ),
    'bill.update': const SyncRoute(
      service: 'finance',
      topic: 'finance.bill.update',
      endpoint: '/v1/finance/bills',
      method: 'PATCH',
    ),
    'journal.create': const SyncRoute(
      service: 'finance',
      topic: 'finance.journal.create',
      endpoint: '/v1/finance/journals',
    ),
    'payment.create': const SyncRoute(
      service: 'finance',
      topic: 'finance.payment.create',
      endpoint: '/v1/finance/payments',
    ),

    // ── Procurement ───────────────────────────────────────────────────────
    'indent.create': const SyncRoute(
      service: 'procurement',
      topic: 'procurement.indent.create',
      endpoint: '/v1/procurement/indents',
    ),
    'indent.update': const SyncRoute(
      service: 'procurement',
      topic: 'procurement.indent.update',
      endpoint: '/v1/procurement/indents',
      method: 'PATCH',
    ),
    'purchase_order.create': const SyncRoute(
      service: 'procurement',
      topic: 'procurement.purchase-order.create',
      endpoint: '/v1/procurement/purchase-orders',
    ),
    'purchase_order.update': const SyncRoute(
      service: 'procurement',
      topic: 'procurement.purchase-order.update',
      endpoint: '/v1/procurement/purchase-orders',
      method: 'PATCH',
    ),

    // ── CRM ───────────────────────────────────────────────────────────────
    'contact.create': const SyncRoute(
      service: 'crm',
      topic: 'crm.contact.create',
      endpoint: '/v1/crm/contacts',
    ),
    'contact.update': const SyncRoute(
      service: 'crm',
      topic: 'crm.contact.update',
      endpoint: '/v1/crm/contacts',
      method: 'PATCH',
    ),
    'deal.create': const SyncRoute(
      service: 'crm',
      topic: 'crm.deal.create',
      endpoint: '/v1/crm/deals',
    ),
    'deal.update': const SyncRoute(
      service: 'crm',
      topic: 'crm.deal.update',
      endpoint: '/v1/crm/deals',
      method: 'PATCH',
    ),

    // ── Helpdesk ──────────────────────────────────────────────────────────
    'ticket.create': const SyncRoute(
      service: 'helpdesk',
      topic: 'helpdesk.ticket.create',
      endpoint: '/v1/helpdesk/tickets',
    ),
    'ticket.update': const SyncRoute(
      service: 'helpdesk',
      topic: 'helpdesk.ticket.update',
      endpoint: '/v1/helpdesk/tickets',
      method: 'PATCH',
    ),

    // ── Projects ──────────────────────────────────────────────────────────
    'task.create': const SyncRoute(
      service: 'project',
      topic: 'project.task.create',
      endpoint: '/v1/projects/tasks',
    ),
    'task.update': const SyncRoute(
      service: 'project',
      topic: 'project.task.update',
      endpoint: '/v1/projects/tasks',
      method: 'PATCH',
    ),
    'timesheet.create': const SyncRoute(
      service: 'project',
      topic: 'project.timesheet.create',
      endpoint: '/v1/projects/timesheets',
    ),

    // ── Expenses ──────────────────────────────────────────────────────────
    'expense.create': const SyncRoute(
      service: 'finance',
      topic: 'finance.expense.create',
      endpoint: '/v1/finance/expenses',
    ),
    'expense.update': const SyncRoute(
      service: 'finance',
      topic: 'finance.expense.update',
      endpoint: '/v1/finance/expenses',
      method: 'PATCH',
    ),

    // ── Citizen Requests / Grievances ─────────────────────────────────────
    'grievance.create': const SyncRoute(
      service: 'citizen',
      topic: 'citizen.grievance.create',
      endpoint: '/v1/citizen/grievances',
    ),
    'grievance.update': const SyncRoute(
      service: 'citizen',
      topic: 'citizen.grievance.update',
      endpoint: '/v1/citizen/grievances',
      method: 'PATCH',
    ),

    // ── Establishment (eOffice) ───────────────────────────────────────────
    'file_note.create': const SyncRoute(
      service: 'estab',
      topic: 'estab.file-note.create',
      endpoint: '/v1/estab/file-notes',
    ),
    'file_note.update': const SyncRoute(
      service: 'estab',
      topic: 'estab.file-note.update',
      endpoint: '/v1/estab/file-notes',
      method: 'PATCH',
    ),

    // ── Stock / Inventory ─────────────────────────────────────────────────
    'stock_receipt.create': const SyncRoute(
      service: 'inventory',
      topic: 'inventory.stock-receipt.create',
      endpoint: '/v1/inventory/receipts',
    ),
    'stock_issue.create': const SyncRoute(
      service: 'inventory',
      topic: 'inventory.stock-issue.create',
      endpoint: '/v1/inventory/issues',
    ),

    // ── Assets ────────────────────────────────────────────────────────────
    'asset_verification.create': const SyncRoute(
      service: 'asset',
      topic: 'asset.verification.create',
      endpoint: '/v1/assets/verifications',
    ),
    'asset.update': const SyncRoute(
      service: 'asset',
      topic: 'asset.update',
      endpoint: '/v1/assets',
      method: 'PATCH',
    ),

    // ── Approvals (cross-cutting) ─────────────────────────────────────────
    'approval.approve': const SyncRoute(
      service: 'workflow',
      topic: 'workflow.approval.approve',
      endpoint: '/v1/workflow/approvals/approve',
    ),
    'approval.reject': const SyncRoute(
      service: 'workflow',
      topic: 'workflow.approval.reject',
      endpoint: '/v1/workflow/approvals/reject',
    ),

    // ── Contracts ─────────────────────────────────────────────────────────
    'contract.create': const SyncRoute(
      service: 'contract',
      topic: 'contract.create',
      endpoint: '/v1/contract/contracts',
    ),
    'contract.update': const SyncRoute(
      service: 'contract',
      topic: 'contract.update',
      endpoint: '/v1/contract/contracts',
      method: 'PATCH',
    ),

    // ── Knowledge Base ────────────────────────────────────────────────────
    'article.create': const SyncRoute(
      service: 'knowledge',
      topic: 'knowledge.article.create',
      endpoint: '/v1/knowledge/articles',
    ),
    'article.update': const SyncRoute(
      service: 'knowledge',
      topic: 'knowledge.article.update',
      endpoint: '/v1/knowledge/articles',
      method: 'PATCH',
    ),
  });

  /// All registered routes (read-only).
  static Map<String, SyncRoute> get routes => _routes;

  /// Resolve a sync route by action key (e.g., 'leave.create').
  /// Returns `null` if no route is registered for the given action.
  static SyncRoute? resolve(String action) => _routes[action];

  /// Check whether a given action has a registered route.
  static bool hasRoute(String action) => _routes.containsKey(action);

  /// All registered action keys.
  static Iterable<String> get actions => _routes.keys;

  /// All registered topics.
  static Iterable<String> get topics => _routes.values.map((r) => r.topic);
}
