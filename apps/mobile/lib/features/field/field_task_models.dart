/// Field Task data models.
///
/// Read-only mobile view for field agents/admins working assigned tasks
/// (`GET /v1/field/tasks`, `services/field-service`).
///
/// Status values and transitions mirror the backend's task lifecycle state
/// machine (`services/field-service/src/modules/tasks/domain.ts`):
/// unassigned -> assigned -> in_progress -> completed | cancelled.
library;

enum FieldTaskStatus { unassigned, assigned, inProgress, completed, cancelled, unknown }

/// Maps a [FieldTaskStatus] to/from the exact wire string the backend uses
/// ("in_progress", not "inProgress"). Needed because Dart enum member names
/// can't contain underscores without tripping `constant_identifier_names`,
/// so `.name` can't double as the wire value the way the simpler
/// `TradeLicenseStatus` enum in `features/revenue/models.dart` does.
extension FieldTaskStatusWire on FieldTaskStatus {
  String get wireValue {
    switch (this) {
      case FieldTaskStatus.unassigned:
        return 'unassigned';
      case FieldTaskStatus.assigned:
        return 'assigned';
      case FieldTaskStatus.inProgress:
        return 'in_progress';
      case FieldTaskStatus.completed:
        return 'completed';
      case FieldTaskStatus.cancelled:
        return 'cancelled';
      case FieldTaskStatus.unknown:
        return 'unknown';
    }
  }

  /// Human-friendly label for chips/detail rows.
  String get label {
    switch (this) {
      case FieldTaskStatus.unassigned:
        return 'Unassigned';
      case FieldTaskStatus.assigned:
        return 'Assigned';
      case FieldTaskStatus.inProgress:
        return 'In Progress';
      case FieldTaskStatus.completed:
        return 'Completed';
      case FieldTaskStatus.cancelled:
        return 'Cancelled';
      case FieldTaskStatus.unknown:
        return 'Unknown';
    }
  }
}

/// Falls back to [FieldTaskStatus.unknown] -- not `.unassigned` -- for a null
/// or unrecognized server value, matching this app's established
/// status-safety convention (`revenue/models.dart`'s `_statusFromJson`): a
/// bad or future status value must render as "Unknown", never silently pass
/// as some other real status.
FieldTaskStatus fieldTaskStatusFromJson(String? s) {
  switch (s) {
    case 'unassigned':
      return FieldTaskStatus.unassigned;
    case 'assigned':
      return FieldTaskStatus.assigned;
    case 'in_progress':
      return FieldTaskStatus.inProgress;
    case 'completed':
      return FieldTaskStatus.completed;
    case 'cancelled':
      return FieldTaskStatus.cancelled;
    default:
      return FieldTaskStatus.unknown;
  }
}

class FieldTask {
  const FieldTask({
    required this.id,
    required this.tenantId,
    required this.taskType,
    required this.title,
    required this.status,
    required this.priority,
    required this.createdAt,
    required this.updatedAt,
    required this.version,
    this.assigneeId,
    this.description,
    this.latitude,
    this.longitude,
    this.address,
    this.dueDate,
    this.completedAt,
    this.cancelledAt,
  });

  final String id;
  final String tenantId;
  final String? assigneeId;
  final String taskType;
  final String title;
  final String? description;
  final FieldTaskStatus status;

  /// 1 (highest) - 5 (lowest); see `createTaskBody`/`schema.ts` on the backend.
  final int priority;
  final double? latitude;
  final double? longitude;
  final String? address;
  final DateTime? dueDate;
  final DateTime? completedAt;
  final DateTime? cancelledAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int version;

  bool get hasLocation => latitude != null && longitude != null;

  /// True when this task is still open (not completed/cancelled) and its due
  /// date has passed. Mirrors the backend's `detectSlaBreach` behavior for
  /// active tasks (`tasks/domain.ts`) without a round trip.
  bool get isOverdue {
    final due = dueDate;
    if (due == null) return false;
    if (status == FieldTaskStatus.completed || status == FieldTaskStatus.cancelled) {
      return false;
    }
    return due.isBefore(DateTime.now().toUtc());
  }

  static double? _doubleFromJson(dynamic v) {
    if (v == null) return null;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString());
  }

  static DateTime? _dateFromJson(dynamic v) {
    if (v == null) return null;
    return DateTime.tryParse(v as String);
  }

  factory FieldTask.fromJson(Map<String, dynamic> json) => FieldTask(
        // Defensive fallback -- a missing `id` must not crash the whole list
        // with a cast exception (matches `revenue/models.dart`'s convention).
        id: json['id'] as String? ?? '',
        tenantId: json['tenantId'] as String? ?? '',
        assigneeId: json['assigneeId'] as String?,
        taskType: json['taskType'] as String? ?? 'other',
        title: json['title'] as String? ?? 'Untitled task',
        description: json['description'] as String?,
        status: fieldTaskStatusFromJson(json['status'] as String?),
        priority: (json['priority'] as num?)?.toInt() ?? 3,
        latitude: _doubleFromJson(json['latitude']),
        longitude: _doubleFromJson(json['longitude']),
        address: json['address'] as String?,
        dueDate: _dateFromJson(json['dueDate']),
        completedAt: _dateFromJson(json['completedAt']),
        cancelledAt: _dateFromJson(json['cancelledAt']),
        createdAt: _dateFromJson(json['createdAt']) ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        updatedAt: _dateFromJson(json['updatedAt']) ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        version: (json['version'] as num?)?.toInt() ?? 1,
      );
}

/// "P1" (highest) .. "P5" (lowest) label for the priority badge.
String fieldTaskPriorityLabel(int priority) => 'P$priority';

/// Builds the query parameters `GET /v1/field/tasks` accepts, omitting any
/// filter that isn't set so an unfiltered fetch stays exactly
/// `{limit, offset}`.
///
/// `dueAfter`/`dueBefore` are sent as UTC ISO-8601 instants derived from the
/// picked calendar date: `dueAfter` at 00:00:00 of that day, `dueBefore` at
/// 23:59:59, so picking a single day is inclusive of the whole day rather
/// than excluding same-day tasks due later in the day.
Map<String, dynamic> buildFieldTaskQueryParams({
  required int limit,
  required int offset,
  FieldTaskStatus? status,
  String? assigneeId,
  DateTime? dueAfter,
  DateTime? dueBefore,
}) {
  final params = <String, dynamic>{'limit': limit, 'offset': offset};
  if (status != null) {
    params['status'] = status.wireValue;
  }
  final assignee = assigneeId?.trim();
  if (assignee != null && assignee.isNotEmpty) {
    params['assigneeId'] = assignee;
  }
  if (dueAfter != null) {
    params['dueAfter'] =
        DateTime.utc(dueAfter.year, dueAfter.month, dueAfter.day).toIso8601String();
  }
  if (dueBefore != null) {
    params['dueBefore'] = DateTime.utc(
      dueBefore.year,
      dueBefore.month,
      dueBefore.day,
      23,
      59,
      59,
    ).toIso8601String();
  }
  return params;
}
