/// Riverpod providers for the court module.
///
/// Mirrors the app's provider idioms (see features/citizen_requests/providers.dart):
///   - a plain [Provider] that builds the API client from the shared apiClientProvider,
///   - `FutureProvider.autoDispose` for reads,
///   - `FutureProvider.autoDispose.family` for parameterised reads.

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/court_api.dart';
import '../models/court_case.dart';
import '../models/court_analytics.dart';
import '../models/establishment.dart';

/// The court REST client, wired to the app's shared Dio [ApiClient] (which owns
/// bearer-token injection + 401 refresh).
final courtApiProvider = Provider<CourtApi>((ref) {
  return CourtApi(ref.read(apiClientProvider));
});

/// Filter for [casesProvider] — a status string, or null for all statuses.
final caseStatusFilterProvider = StateProvider<String?>((ref) => null);

/// Paginated case list, honouring [caseStatusFilterProvider].
final casesProvider =
    FutureProvider.autoDispose<List<CourtCase>>((ref) async {
  final api = ref.watch(courtApiProvider);
  final status = ref.watch(caseStatusFilterProvider);
  return api.listCases(limit: 50, status: status);
});

/// A single case (with parties) by id.
final caseByIdProvider =
    FutureProvider.autoDispose.family<CourtCase, String>((ref, id) async {
  final api = ref.watch(courtApiProvider);
  return api.getCase(id);
});

/// Disposal/pendency KPIs. Defaults to a wide window covering the current +
/// previous calendar year so the dashboard is populated out of the box.
final analyticsProvider =
    FutureProvider.autoDispose<CourtAnalytics>((ref) async {
  final api = ref.watch(courtApiProvider);
  final now = DateTime.now();
  final from = '${now.year - 1}-01-01';
  final to = '${now.year}-12-31';
  return api.analytics(from: from, to: to);
});

/// Pending-case counts bucketed by status.
final pendencyProvider =
    FutureProvider.autoDispose<PendencySummary>((ref) async {
  final api = ref.watch(courtApiProvider);
  return api.pendency();
});

/// Overdue cases as of today.
final overdueProvider = FutureProvider.autoDispose<OverdueCases>((ref) async {
  final api = ref.watch(courtApiProvider);
  final now = DateTime.now();
  final asOf =
      '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  return api.overdue(asOf: asOf);
});

/// Public court directory (used by the citizen lookup screen).
final establishmentsProvider =
    FutureProvider.autoDispose<List<Establishment>>((ref) async {
  final api = ref.watch(courtApiProvider);
  return api.publicEstablishments();
});
