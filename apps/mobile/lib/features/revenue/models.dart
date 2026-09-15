/// Trade License data models.
///
/// Read-only mobile view for revenue officers/collectors verifying and
/// tracking municipal trade/business licenses in the field
/// (`GET /v1/revenue/trade-licenses`, `services/revenue-service`).
///
/// Fee amounts are stored server-side as paise-denominated bigint strings
/// (`fee_minor` / `fee_paid_minor` columns). Parsed defensively here — a
/// missing/unparseable fee renders as `null` ("—" in the UI), never a
/// fabricated ₹0, matching this app's established money-safety convention
/// (see the web app's UX-006/UX-018 `minorToRupeesOrNull` fix).
library;

enum TradeLicenseStatus { pending, active, suspended, cancelled, expired }

class TradeLicense {
  const TradeLicense({
    required this.id,
    required this.tenantId,
    required this.licenseNo,
    required this.businessName,
    required this.proprietorName,
    required this.address,
    required this.businessType,
    required this.category,
    required this.status,
    this.wardNo,
    this.issuedDate,
    this.expiryDate,
    this.feeMinor,
    this.feePaidMinor,
    this.renewalCount = 0,
  });

  final String id;
  final String tenantId;
  final String licenseNo;
  final String businessName;
  final String proprietorName;
  final String address;
  final String businessType;
  final String category;
  final TradeLicenseStatus status;
  final String? wardNo;
  final DateTime? issuedDate;
  final DateTime? expiryDate;

  /// Total annual fee, in paise. Null when the server value was missing or
  /// unparseable.
  final BigInt? feeMinor;

  /// Amount already paid toward this license's fee, in paise. Null when the
  /// server value was missing or unparseable.
  final BigInt? feePaidMinor;
  final int renewalCount;

  /// Outstanding balance in paise, or null if either amount is unknown.
  /// Never negative — an overpayment shows as fully paid (zero due).
  BigInt? get dueMinor {
    final fee = feeMinor;
    final paid = feePaidMinor;
    if (fee == null || paid == null) return null;
    final due = fee - paid;
    return due.isNegative ? BigInt.zero : due;
  }

  bool get isFullyPaid => dueMinor == BigInt.zero;

  bool get isExpiringSoon {
    final expiry = expiryDate;
    if (expiry == null || status != TradeLicenseStatus.active) return false;
    final daysLeft = expiry.difference(DateTime.now().toUtc()).inDays;
    return daysLeft >= 0 && daysLeft <= 30;
  }

  static TradeLicenseStatus _statusFromJson(String? s) =>
      TradeLicenseStatus.values.firstWhere(
        (v) => v.name == s,
        orElse: () => TradeLicenseStatus.pending,
      );

  /// `fee_minor`/`fee_paid_minor` travel over the wire as decimal strings
  /// (server-side bigint-as-text, to avoid JS/Dart double precision loss on
  /// large paise values). Also tolerates a plain JSON number defensively.
  static BigInt? _minorFromJson(dynamic v) {
    if (v == null) return null;
    return BigInt.tryParse(v.toString());
  }

  static DateTime? _dateFromJson(dynamic v) {
    if (v == null) return null;
    return DateTime.tryParse(v as String);
  }

  factory TradeLicense.fromJson(Map<String, dynamic> json) => TradeLicense(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        licenseNo: json['licenseNo'] as String? ?? '—',
        businessName: json['businessName'] as String? ?? 'Unknown business',
        proprietorName: json['proprietorName'] as String? ?? '—',
        address: json['address'] as String? ?? '',
        businessType: json['businessType'] as String? ?? 'other',
        category: json['category'] as String? ?? 'A',
        status: _statusFromJson(json['status'] as String?),
        wardNo: json['wardNo'] as String?,
        issuedDate: _dateFromJson(json['issuedDate']),
        expiryDate: _dateFromJson(json['expiryDate']),
        feeMinor: _minorFromJson(json['feeMinor']),
        feePaidMinor: _minorFromJson(json['feePaidMinor']),
        renewalCount: (json['renewalCount'] as num?)?.toInt() ?? 0,
      );
}

/// Formats a paise [BigInt] as "₹1,23,456" (Indian digit grouping), or "—"
/// when the amount is unknown. Mirrors the web app's `formatRupees`
/// missing-vs-zero convention: a real zero still renders "₹0", only a null
/// amount renders "—".
String formatTradeLicenseAmount(BigInt? minor) {
  if (minor == null) return '—';
  final rupees = minor ~/ BigInt.from(100);
  final digits = rupees.abs().toString();
  final buffer = StringBuffer();
  if (digits.length <= 3) {
    buffer.write(digits);
  } else {
    final last3 = digits.substring(digits.length - 3);
    final rest = digits.substring(0, digits.length - 3);
    for (var i = 0; i < rest.length; i++) {
      if (i > 0 && (rest.length - i) % 2 == 0) buffer.write(',');
      buffer.write(rest[i]);
    }
    buffer.write(',');
    buffer.write(last3);
  }
  final sign = minor.isNegative ? '-' : '';
  return '$sign₹$buffer';
}
