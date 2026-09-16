/// Assessee data models.
///
/// Read-only mobile view for revenue officers/collectors looking up a
/// property or water-connection ratepayer record in the field
/// (`GET /v1/revenue/assessees`, `services/revenue-service`).
///
/// This is the tenant-wide "who is this ratepayer" directory that
/// property-tax and water-charges lookups both hang off of -- see the
/// COMP-008 roadmap in this PR's description. Bills/demands/receipts for a
/// given assessee stay web-only for now, same "explicitly out of scope"
/// treatment tranche 1 gave trade-license actions.
library;

/// Mirrors `assessee.assessees.assessee_type` (schema.ts). `unknown` is a
/// client-side fallback for a null/unrecognized server value -- it never
/// travels over the wire.
enum AssesseeType { property, waterConnection, trade, other, unknown }

AssesseeType _typeFromJson(String? s) {
  switch (s) {
    case 'property':
      return AssesseeType.property;
    case 'water_connection':
      return AssesseeType.waterConnection;
    case 'trade':
      return AssesseeType.trade;
    case 'other':
      return AssesseeType.other;
    default:
      return AssesseeType.unknown;
  }
}

/// Display label for [AssesseeType] -- also doubles as the `status` string
/// fed to the shared `StatusPill` widget, which falls back to a neutral grey
/// tag for any value it doesn't recognize as a status/priority keyword (none
/// of these collide).
String assesseeTypeLabel(AssesseeType t) {
  switch (t) {
    case AssesseeType.property:
      return 'Property';
    case AssesseeType.waterConnection:
      return 'Water Connection';
    case AssesseeType.trade:
      return 'Trade';
    case AssesseeType.other:
      return 'Other';
    case AssesseeType.unknown:
      return 'Unknown';
  }
}

class Assessee {
  const Assessee({
    required this.id,
    required this.tenantId,
    required this.assesseeType,
    required this.identifierNo,
    required this.ownerName,
    required this.address,
    this.wardNo,
    this.zoneNo,
    this.connectionSize,
    this.propertyType,
    this.builtUpArea,
    this.isActive = true,
  });

  final String id;
  final String tenantId;
  final AssesseeType assesseeType;

  /// Property ID or water-connection number.
  final String identifierNo;
  final String ownerName;
  final String address;
  final String? wardNo;
  final String? zoneNo;

  /// Water-connection size (e.g. `0.5"`, `1"`). Null for non-water records.
  final String? connectionSize;

  /// residential / commercial / industrial. Null for non-property records.
  final String? propertyType;

  /// Built-up area in square feet. Null when not recorded.
  final BigInt? builtUpArea;
  final bool isActive;

  static BigInt? _bigIntFromJson(dynamic v) {
    if (v == null) return null;
    return BigInt.tryParse(v.toString());
  }

  factory Assessee.fromJson(Map<String, dynamic> json) => Assessee(
        // Defensive fallback -- a missing `id` must not crash the whole
        // list with a cast exception (see the trade-license bug this
        // mirrors the fix for).
        id: json['id'] as String? ?? '',
        tenantId: json['tenantId'] as String? ?? '',
        assesseeType: _typeFromJson(json['assesseeType'] as String?),
        identifierNo: json['identifierNo'] as String? ?? '—',
        ownerName: json['ownerName'] as String? ?? 'Unknown owner',
        address: json['address'] as String? ?? '',
        wardNo: json['wardNo'] as String?,
        zoneNo: json['zoneNo'] as String?,
        connectionSize: json['connectionSize'] as String?,
        propertyType: json['propertyType'] as String?,
        builtUpArea: _bigIntFromJson(json['builtUpArea']),
        isActive: json['isActive'] as bool? ?? true,
      );
}
