/// Public case-status (docket) models — the un-authenticated citizen lookup.
///
/// Mirrors:
///   POST /v1/public/case-status/otp → { challengeId, expiresInSec, devOtp? }
///   POST /v1/public/case-status     → { case: PublicDocket, accessMode, source }
///
/// The public docket deliberately carries NO PII (no parties, no addresses) —
/// only the fields returned by the service's `toPublicDocket` projection.
///
/// Plain null-safe Dart (no freezed), matching the app's model style.

/// Response of the OTP-request step.
class OtpChallenge {
  const OtpChallenge({
    required this.challengeId,
    required this.expiresInSec,
    this.devOtp,
  });

  final String challengeId;
  final int expiresInSec;

  /// TEST-ONLY: the service returns this only when NODE_ENV=test. Never in prod.
  final String? devOtp;

  factory OtpChallenge.fromJson(Map<String, dynamic> json) => OtpChallenge(
        challengeId: json['challengeId'] as String,
        expiresInSec: (json['expiresInSec'] as num?)?.toInt() ?? 0,
        devOtp: json['devOtp'] as String?,
      );
}

/// The PII-free public docket for a single case.
/// Live shape: { cnrNumber, caseType, title, status, stage, filingDate, disposalDate }
class PublicDocket {
  const PublicDocket({
    required this.cnrNumber,
    required this.status,
    this.caseType,
    this.title,
    this.stage,
    this.filingDate,
    this.disposalDate,
  });

  final String cnrNumber;
  final String? caseType;
  final String? title;
  final String status;
  final String? stage;

  /// Date-only strings as returned by the service (e.g. '2026-02-01').
  final String? filingDate;
  final String? disposalDate;

  factory PublicDocket.fromJson(Map<String, dynamic> json) => PublicDocket(
        cnrNumber: json['cnrNumber'] as String? ?? '',
        caseType: json['caseType'] as String?,
        title: json['title'] as String?,
        status: json['status'] as String? ?? 'unknown',
        stage: json['stage'] as String?,
        filingDate: json['filingDate'] as String?,
        disposalDate: json['disposalDate'] as String?,
      );
}

/// The full case-status lookup result: the docket plus the gate that was used.
class PublicCaseStatus {
  const PublicCaseStatus({
    required this.docket,
    this.accessMode,
    this.source,
  });

  final PublicDocket docket;

  /// The court's configured gate: 'otp' | 'captcha' | 'open'.
  final String? accessMode;
  final String? source;

  factory PublicCaseStatus.fromJson(Map<String, dynamic> json) => PublicCaseStatus(
        docket: PublicDocket.fromJson(json['case'] as Map<String, dynamic>),
        accessMode: json['accessMode'] as String?,
        source: json['source'] as String?,
      );
}
