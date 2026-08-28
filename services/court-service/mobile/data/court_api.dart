/// Court-service REST client.
///
/// Wraps the app's shared [ApiClient] (Dio) so the bearer token is attached the
/// SAME way every other feature attaches it — via the ApiClient request
/// interceptor, which reads a fresh token from PkceAuthService.accessToken()
/// (see core/api_client.dart). We therefore never touch headers here.
///
/// Endpoints (exactly the ones exposed by court-service — no invented routes):
///   Authenticated (court_admin / judge / registrar roles):
///     GET  /v1/court/cases
///     GET  /v1/court/cases/:id
///     GET  /v1/court/cases/analytics
///     GET  /v1/court/cases/pendency
///     GET  /v1/court/cases/overdue
///   Public (no auth):
///     GET  /v1/court/public/establishments
///     POST /v1/court/public/case-status/otp
///     POST /v1/court/public/case-status
///
/// The public endpoints go through the same client; the interceptor simply adds
/// a token when one is present, which the service ignores for `public: true`
/// routes.

import '../../../core/api_client.dart';
import '../models/court_case.dart';
import '../models/court_analytics.dart';
import '../models/establishment.dart';
import '../models/public_case_status.dart';

class CourtApi {
  const CourtApi(this._client);

  final ApiClient _client;

  // ─── Authenticated: case registry ────────────────────────────────────────────

  /// GET /v1/court/cases — paginated case list. Optional [status] filter.
  Future<List<CourtCase>> listCases({
    int limit = 20,
    int offset = 0,
    String? status,
  }) async {
    final res = await _client.get<Map<String, dynamic>>(
      '/v1/court/cases',
      params: {
        'limit': limit,
        'offset': offset,
        if (status != null && status.isNotEmpty) 'status': status,
      },
    );
    final items = (res.data?['items'] as List<dynamic>?) ?? const [];
    return items
        .map((e) => CourtCase.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /v1/court/cases/:id — a single case with its parties.
  Future<CourtCase> getCase(String id) async {
    final res =
        await _client.get<Map<String, dynamic>>('/v1/court/cases/$id');
    return CourtCase.fromJson(res.data ?? const {});
  }

  // ─── Authenticated: analytics ────────────────────────────────────────────────

  /// GET /v1/court/cases/analytics — disposal/pendency KPIs for [from]..[to]
  /// (date-only strings, e.g. '2025-01-01').
  Future<CourtAnalytics> analytics({
    required String from,
    required String to,
  }) async {
    final res = await _client.get<Map<String, dynamic>>(
      '/v1/court/cases/analytics',
      params: {'from': from, 'to': to},
    );
    return CourtAnalytics.fromJson(res.data ?? const {});
  }

  /// GET /v1/court/cases/pendency — pending-case counts bucketed by status.
  Future<PendencySummary> pendency() async {
    final res = await _client
        .get<Map<String, dynamic>>('/v1/court/cases/pendency');
    return PendencySummary.fromJson(res.data ?? const {});
  }

  /// GET /v1/court/cases/overdue — cases past target disposal as of [asOf]
  /// (date-only string; defaults to today).
  Future<OverdueCases> overdue({String? asOf}) async {
    final res = await _client.get<Map<String, dynamic>>(
      '/v1/court/cases/overdue',
      params: {if (asOf != null) 'asOf': asOf},
    );
    return OverdueCases.fromJson(res.data ?? const {});
  }

  // ─── Public: directory + citizen case-status lookup ──────────────────────────

  /// GET /v1/court/public/establishments — public court directory (no auth).
  Future<List<Establishment>> publicEstablishments() async {
    final res = await _client
        .get<Map<String, dynamic>>('/v1/court/public/establishments');
    final items = (res.data?['items'] as List<dynamic>?) ?? const [];
    return items
        .map((e) => Establishment.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /v1/court/public/case-status/otp — request an SMS OTP for a court that
  /// gates lookups with OTP. [mobile] is PII and is only transmitted, never
  /// stored client-side.
  Future<OtpChallenge> requestOtp({required String mobile}) async {
    final res = await _client.post<Map<String, dynamic>>(
      '/v1/court/public/case-status/otp',
      data: {'mobile': mobile},
    );
    return OtpChallenge.fromJson(res.data ?? const {});
  }

  /// POST /v1/court/public/case-status — look up a case docket by CNR (no PII in the
  /// response). Supply [challengeId] + [otp] for OTP-gated courts, or
  /// [captchaToken] for captcha-gated courts; open courts need neither. An
  /// optional [slug] disambiguates the court when the CNR prefix is ambiguous.
  Future<PublicCaseStatus> publicCaseStatus({
    required String cnr,
    String? slug,
    String? challengeId,
    String? otp,
    String? captchaToken,
  }) async {
    final res = await _client.post<Map<String, dynamic>>(
      '/v1/court/public/case-status',
      data: {
        'cnr': cnr,
        if (slug != null && slug.isNotEmpty) 'slug': slug,
        if (challengeId != null) 'challengeId': challengeId,
        if (otp != null) 'otp': otp,
        if (captchaToken != null) 'captchaToken': captchaToken,
      },
    );
    return PublicCaseStatus.fromJson(res.data ?? const {});
  }
}
