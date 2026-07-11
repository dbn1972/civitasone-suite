/// Court case data models.
///
/// Mirrors the court-service REST payloads byte-for-byte:
///   GET /v1/court/cases            → { items: [CourtCase], ... }
///   GET /v1/court/cases/:id        → CourtCase + { parties: [CaseParty] }
///   GET /v1/court/cases/overdue    → { items: [CourtCase], count, asOf }
///
/// Plain null-safe Dart classes with `fromJson` (the app does NOT use freezed —
/// see features/stock_scanner/models.dart, features/invoicing/invoice_model.dart).
/// Field names in [CourtCase.fromJson] match the live JSON keys exactly.

/// A single party attached to a case (petitioner / respondent / advocate-of-record).
///
/// The court-service holds name/address/phone/email as AES-256-GCM ciphertext
/// (DPDP Act 2023), so only the non-PII display fields are surfaced here.
class CaseParty {
  const CaseParty({
    required this.id,
    required this.partyRole,
    this.advocateName,
    this.advocateBarId,
  });

  final String id;

  /// e.g. 'petitioner', 'respondent', 'advocate'.
  final String partyRole;
  final String? advocateName;
  final String? advocateBarId;

  factory CaseParty.fromJson(Map<String, dynamic> json) => CaseParty(
        id: json['id'] as String? ?? '',
        partyRole: json['partyRole'] as String? ?? '',
        advocateName: json['advocateName'] as String?,
        advocateBarId: json['advocateBarId'] as String?,
      );
}

class CourtCase {
  const CourtCase({
    required this.id,
    required this.tenantId,
    required this.cnrNumber,
    required this.status,
    this.caseType,
    this.filingNumber,
    this.filingDate,
    this.title,
    this.stage,
    this.courtId,
    this.benchId,
    this.disposalDate,
    this.targetDisposalDate,
    this.createdAt,
    this.updatedAt,
    this.version,
    this.parties = const [],
  });

  final String id;
  final String tenantId;

  /// Case Number Record (CNR) — the national unique case identifier.
  final String cnrNumber;
  final String? caseType;
  final String? filingNumber;

  /// Filing date (date-only string, e.g. '2026-02-01').
  final DateTime? filingDate;
  final String? title;

  /// Lifecycle status: registered | pending | reserved | disposed | ...
  final String status;

  /// Hearing stage: registered | part_heard | reserved | ...
  final String? stage;
  final String? courtId;
  final String? benchId;
  final DateTime? disposalDate;
  final DateTime? targetDisposalDate;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final int? version;

  /// Present only on the single-case detail response.
  final List<CaseParty> parties;

  /// True when a target disposal date has passed without disposal.
  bool get isOverdue =>
      disposalDate == null &&
      targetDisposalDate != null &&
      targetDisposalDate!.isBefore(DateTime.now());

  /// True when the case has reached a disposed state.
  bool get isDisposed => status.toLowerCase() == 'disposed' || disposalDate != null;

  static DateTime? _date(dynamic v) =>
      v == null ? null : DateTime.tryParse(v as String);

  factory CourtCase.fromJson(Map<String, dynamic> json) => CourtCase(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        cnrNumber: json['cnrNumber'] as String,
        caseType: json['caseType'] as String?,
        filingNumber: json['filingNumber'] as String?,
        filingDate: _date(json['filingDate']),
        title: json['title'] as String?,
        status: json['status'] as String? ?? 'unknown',
        stage: json['stage'] as String?,
        courtId: json['courtId'] as String?,
        benchId: json['benchId'] as String?,
        disposalDate: _date(json['disposalDate']),
        targetDisposalDate: _date(json['targetDisposalDate']),
        createdAt: _date(json['createdAt']),
        updatedAt: _date(json['updatedAt']),
        version: json['version'] as int?,
        parties: (json['parties'] as List<dynamic>?)
                ?.map((p) => CaseParty.fromJson(p as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}
