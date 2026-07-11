/// Public court-establishment directory model.
///
/// Mirrors GET /v1/public/establishments (PUBLIC, no auth):
///   { "items": [Establishment], "count", "source" }
/// Live item shape:
///   { "courtName", "publicSlug", "establishmentCode", "publicUrl" }
///
/// Plain null-safe Dart (no freezed), matching the app's model style.
class Establishment {
  const Establishment({
    required this.courtName,
    required this.publicSlug,
    required this.establishmentCode,
    this.publicUrl,
  });

  final String courtName;

  /// URL-safe slug used to address the court's public case-status page.
  final String publicSlug;

  /// Court establishment code; the first 6 chars form the CNR prefix.
  final String establishmentCode;

  /// Shareable public case-status page link.
  final String? publicUrl;

  factory Establishment.fromJson(Map<String, dynamic> json) => Establishment(
        courtName: json['courtName'] as String? ?? '',
        publicSlug: json['publicSlug'] as String? ?? '',
        establishmentCode: json['establishmentCode'] as String? ?? '',
        publicUrl: json['publicUrl'] as String?,
      );
}
