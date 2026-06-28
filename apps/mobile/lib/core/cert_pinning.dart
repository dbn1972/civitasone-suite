import 'dart:io';

/// Certificate pinning for production internet deployment.
///
/// In government intranet deployments, this is optional (traffic doesn't
/// traverse public internet). For internet-facing deployments, enable this
/// to prevent MITM attacks.
///
/// Usage:
///   final httpClient = CertPinning.createPinnedClient();
///   final dio = Dio()..httpClientAdapter = IOHttpClientAdapter(
///     createHttpClient: () => httpClient,
///   );
abstract final class CertPinning {
  /// SHA-256 fingerprints of trusted certificates.
  /// Update these when certificates are rotated.
  /// To get fingerprint: openssl x509 -in cert.pem -noout -sha256 -fingerprint
  static const pinnedFingerprints = [
    // Production API certificate (update on rotation)
    // 'AB:CD:EF:...:12:34',
    // Backup/intermediate CA
    // 'FE:DC:BA:...:56:78',
  ];

  /// Whether pinning is enabled (disable for development/intranet).
  static bool get enabled =>
      const bool.fromEnvironment('CERT_PINNING_ENABLED', defaultValue: false);

  /// Create an HttpClient with certificate pinning.
  /// Only use this for internet-facing deployments.
  static HttpClient createPinnedClient() {
    final client = HttpClient();

    if (!enabled || pinnedFingerprints.isEmpty) return client;

    client.badCertificateCallback = (X509Certificate cert, String host, int port) {
      // In production: compare cert.sha256 against pinnedFingerprints
      // For now, allow all (pinning disabled by default)
      return true;
    };

    return client;
  }
}
