/// Bill Tracker data models.
///
/// Tracks government/utility bills through their lifecycle.
/// Amounts stored as integers (paise) to avoid floating-point issues.

enum BillStatus { draft, submitted, underReview, approved, rejected, paid }

class BillTimelineEntry {
  const BillTimelineEntry({
    required this.id,
    required this.action,
    required this.actor,
    required this.timestamp,
    this.remarks,
    this.fromStatus,
    this.toStatus,
  });

  final String id;
  final String action;
  final String actor;
  final DateTime timestamp;
  final String? remarks;
  final BillStatus? fromStatus;
  final BillStatus? toStatus;

  Map<String, dynamic> toJson() => {
        'id': id,
        'action': action,
        'actor': actor,
        'timestamp': timestamp.toIso8601String(),
        'remarks': remarks,
        'fromStatus': fromStatus?.name,
        'toStatus': toStatus?.name,
      };

  factory BillTimelineEntry.fromJson(Map<String, dynamic> json) =>
      BillTimelineEntry(
        id: json['id'] as String,
        action: json['action'] as String,
        actor: json['actor'] as String,
        timestamp: DateTime.parse(json['timestamp'] as String),
        remarks: json['remarks'] as String?,
        fromStatus: json['fromStatus'] != null
            ? BillStatus.values.firstWhere(
                (s) => s.name == json['fromStatus'],
                orElse: () => BillStatus.draft,
              )
            : null,
        toStatus: json['toStatus'] != null
            ? BillStatus.values.firstWhere(
                (s) => s.name == json['toStatus'],
                orElse: () => BillStatus.draft,
              )
            : null,
      );
}

class Bill {
  const Bill({
    required this.id,
    required this.tenantId,
    required this.billNo,
    required this.vendorName,
    required this.description,
    required this.amountMinor,
    required this.currency,
    required this.status,
    required this.createdAt,
    required this.timeline,
    this.dueDate,
    this.category,
    this.department,
    this.attachmentUrls,
  });

  final String id;
  final String tenantId;
  final String billNo;
  final String vendorName;
  final String description;

  /// Amount in minor units (paise for INR).
  final int amountMinor;
  final String currency;
  final BillStatus status;
  final DateTime createdAt;
  final List<BillTimelineEntry> timeline;
  final DateTime? dueDate;
  final String? category;
  final String? department;
  final List<String>? attachmentUrls;

  /// Amount formatted in major units (rupees).
  double get amountMajor => amountMinor / 100;

  /// Whether the bill is overdue.
  bool get isOverdue =>
      dueDate != null &&
      DateTime.now().toUtc().isAfter(dueDate!) &&
      status != BillStatus.paid;

  /// Days until due (negative = overdue).
  int? get daysUntilDue =>
      dueDate?.difference(DateTime.now().toUtc()).inDays;

  /// Total processing time from submission to current status.
  Duration get processingTime {
    final submitted = timeline
        .where((e) => e.toStatus == BillStatus.submitted)
        .toList();
    if (submitted.isEmpty) return Duration.zero;
    return DateTime.now().toUtc().difference(submitted.first.timestamp);
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'billNo': billNo,
        'vendorName': vendorName,
        'description': description,
        'amountMinor': amountMinor,
        'currency': currency,
        'status': status.name,
        'createdAt': createdAt.toIso8601String(),
        'timeline': timeline.map((e) => e.toJson()).toList(),
        'dueDate': dueDate?.toIso8601String(),
        'category': category,
        'department': department,
        'attachmentUrls': attachmentUrls,
      };

  factory Bill.fromJson(Map<String, dynamic> json) => Bill(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        billNo: json['billNo'] as String,
        vendorName: json['vendorName'] as String,
        description: json['description'] as String? ?? '',
        amountMinor: json['amountMinor'] as int,
        currency: json['currency'] as String? ?? 'INR',
        status: BillStatus.values.firstWhere(
          (s) => s.name == (json['status'] as String? ?? 'draft'),
          orElse: () => BillStatus.draft,
        ),
        createdAt: DateTime.parse(json['createdAt'] as String),
        timeline: (json['timeline'] as List<dynamic>?)
                ?.map(
                    (e) => BillTimelineEntry.fromJson(e as Map<String, dynamic>))
                .toList() ??
            [],
        dueDate: json['dueDate'] != null
            ? DateTime.tryParse(json['dueDate'] as String)
            : null,
        category: json['category'] as String?,
        department: json['department'] as String?,
        attachmentUrls: (json['attachmentUrls'] as List<dynamic>?)
            ?.cast<String>(),
      );
}
