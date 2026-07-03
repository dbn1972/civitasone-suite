/// Citizen Requests data models.
///
/// Supports filing grievances, tracking request status, and SLA monitoring.

enum RequestStatus {
  draft,
  submitted,
  acknowledged,
  inProgress,
  resolved,
  closed,
  rejected,
}

enum RequestCategory {
  water,
  electricity,
  roads,
  sanitation,
  property,
  certificates,
  permits,
  complaints,
  other,
}

enum RequestPriority { low, medium, high, urgent }

class AttachedDocument {
  const AttachedDocument({
    required this.id,
    required this.fileName,
    required this.mimeType,
    required this.url,
    required this.uploadedAt,
    this.sizeBytes,
  });

  final String id;
  final String fileName;
  final String mimeType;
  final String url;
  final DateTime uploadedAt;
  final int? sizeBytes;

  /// Human-readable file size.
  String get formattedSize {
    if (sizeBytes == null) return '';
    if (sizeBytes! < 1024) return '${sizeBytes}B';
    if (sizeBytes! < 1048576) return '${(sizeBytes! / 1024).toStringAsFixed(1)}KB';
    return '${(sizeBytes! / 1048576).toStringAsFixed(1)}MB';
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'fileName': fileName,
        'mimeType': mimeType,
        'url': url,
        'uploadedAt': uploadedAt.toIso8601String(),
        'sizeBytes': sizeBytes,
      };

  factory AttachedDocument.fromJson(Map<String, dynamic> json) =>
      AttachedDocument(
        id: json['id'] as String,
        fileName: json['fileName'] as String,
        mimeType: json['mimeType'] as String,
        url: json['url'] as String,
        uploadedAt: DateTime.parse(json['uploadedAt'] as String),
        sizeBytes: json['sizeBytes'] as int?,
      );
}

class RequestTimelineEntry {
  const RequestTimelineEntry({
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
  final RequestStatus? fromStatus;
  final RequestStatus? toStatus;

  Map<String, dynamic> toJson() => {
        'id': id,
        'action': action,
        'actor': actor,
        'timestamp': timestamp.toIso8601String(),
        'remarks': remarks,
        'fromStatus': fromStatus?.name,
        'toStatus': toStatus?.name,
      };

  factory RequestTimelineEntry.fromJson(Map<String, dynamic> json) =>
      RequestTimelineEntry(
        id: json['id'] as String,
        action: json['action'] as String,
        actor: json['actor'] as String,
        timestamp: DateTime.parse(json['timestamp'] as String),
        remarks: json['remarks'] as String?,
        fromStatus: json['fromStatus'] != null
            ? RequestStatus.values.firstWhere(
                (s) => s.name == json['fromStatus'],
                orElse: () => RequestStatus.draft,
              )
            : null,
        toStatus: json['toStatus'] != null
            ? RequestStatus.values.firstWhere(
                (s) => s.name == json['toStatus'],
                orElse: () => RequestStatus.draft,
              )
            : null,
      );
}

class CitizenRequest {
  const CitizenRequest({
    required this.id,
    required this.tenantId,
    required this.requestNo,
    required this.category,
    required this.subject,
    required this.description,
    required this.status,
    required this.priority,
    required this.createdAt,
    required this.timeline,
    this.citizenName,
    this.citizenPhone,
    this.citizenEmail,
    this.assignedTo,
    this.slaDeadline,
    this.resolvedAt,
    this.documents,
    this.ward,
    this.location,
  });

  final String id;
  final String tenantId;
  final String requestNo;
  final RequestCategory category;
  final String subject;
  final String description;
  final RequestStatus status;
  final RequestPriority priority;
  final DateTime createdAt;
  final List<RequestTimelineEntry> timeline;
  final String? citizenName;
  final String? citizenPhone;
  final String? citizenEmail;
  final String? assignedTo;
  final DateTime? slaDeadline;
  final DateTime? resolvedAt;
  final List<AttachedDocument>? documents;
  final String? ward;
  final String? location;

  /// Whether the SLA has been breached.
  bool get isSlaBreached =>
      slaDeadline != null &&
      DateTime.now().toUtc().isAfter(slaDeadline!) &&
      status != RequestStatus.resolved &&
      status != RequestStatus.closed;

  /// Hours remaining until SLA deadline (negative = breached).
  int? get slaHoursRemaining =>
      slaDeadline?.difference(DateTime.now().toUtc()).inHours;

  /// Total resolution time (from submission to resolution).
  Duration? get resolutionTime {
    if (resolvedAt == null) return null;
    return resolvedAt!.difference(createdAt);
  }

  /// Days since the request was created.
  int get ageDays => DateTime.now().toUtc().difference(createdAt).inDays;

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'requestNo': requestNo,
        'category': category.name,
        'subject': subject,
        'description': description,
        'status': status.name,
        'priority': priority.name,
        'createdAt': createdAt.toIso8601String(),
        'timeline': timeline.map((e) => e.toJson()).toList(),
        'citizenName': citizenName,
        'citizenPhone': citizenPhone,
        'citizenEmail': citizenEmail,
        'assignedTo': assignedTo,
        'slaDeadline': slaDeadline?.toIso8601String(),
        'resolvedAt': resolvedAt?.toIso8601String(),
        'documents': documents?.map((d) => d.toJson()).toList(),
        'ward': ward,
        'location': location,
      };

  factory CitizenRequest.fromJson(Map<String, dynamic> json) =>
      CitizenRequest(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        requestNo: json['requestNo'] as String,
        category: RequestCategory.values.firstWhere(
          (c) => c.name == (json['category'] as String? ?? 'other'),
          orElse: () => RequestCategory.other,
        ),
        subject: json['subject'] as String,
        description: json['description'] as String? ?? '',
        status: RequestStatus.values.firstWhere(
          (s) => s.name == (json['status'] as String? ?? 'draft'),
          orElse: () => RequestStatus.draft,
        ),
        priority: RequestPriority.values.firstWhere(
          (p) => p.name == (json['priority'] as String? ?? 'medium'),
          orElse: () => RequestPriority.medium,
        ),
        createdAt: DateTime.parse(json['createdAt'] as String),
        timeline: (json['timeline'] as List<dynamic>?)
                ?.map((e) =>
                    RequestTimelineEntry.fromJson(e as Map<String, dynamic>))
                .toList() ??
            [],
        citizenName: json['citizenName'] as String?,
        citizenPhone: json['citizenPhone'] as String?,
        citizenEmail: json['citizenEmail'] as String?,
        assignedTo: json['assignedTo'] as String?,
        slaDeadline: json['slaDeadline'] != null
            ? DateTime.tryParse(json['slaDeadline'] as String)
            : null,
        resolvedAt: json['resolvedAt'] != null
            ? DateTime.tryParse(json['resolvedAt'] as String)
            : null,
        documents: (json['documents'] as List<dynamic>?)
            ?.map((d) => AttachedDocument.fromJson(d as Map<String, dynamic>))
            .toList(),
        ward: json['ward'] as String?,
        location: json['location'] as String?,
      );
}
