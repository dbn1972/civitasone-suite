/// Court Module — go_router route registration.
///
/// Mirrors the app's route-helper idiom (see features/hr/hr_module.dart, which
/// exposes `hrShellRoutes()` / `hrFullScreenRoutes()` merged into the GoRouter
/// in main.dart). Merge [courtShellRoutes] into the authenticated ShellRoute's
/// `routes:` list, and [courtFullScreenRoutes] into the top-level `routes:`.
library;

import 'package:go_router/go_router.dart';

import 'screens/court_dashboard_screen.dart';
import 'screens/cases_list_screen.dart';
import 'screens/case_detail_screen.dart';
import 'screens/public_lookup_screen.dart';

export 'screens/court_dashboard_screen.dart';
export 'screens/cases_list_screen.dart';
export 'screens/case_detail_screen.dart';
export 'screens/public_lookup_screen.dart';

/// Authenticated, shell-wrapped court routes (bottom nav retained).
///
/// Add to the authenticated `ShellRoute(routes: [ ...courtShellRoutes() ])`.
List<GoRoute> courtShellRoutes() => [
      GoRoute(
        path: '/court/dashboard',
        builder: (_, __) => const CourtDashboardScreen(),
      ),
      GoRoute(
        path: '/court/cases',
        builder: (_, __) => const CasesListScreen(),
      ),
      GoRoute(
        path: '/court/cases/:id',
        builder: (_, state) =>
            CaseDetailScreen(caseId: state.pathParameters['id']!),
      ),
    ];

/// Full-screen (no bottom nav) court routes.
///
/// The public lookup is citizen-facing and un-authenticated, so it lives
/// outside the app shell (add to the top-level `routes:` list in main.dart).
List<GoRoute> courtFullScreenRoutes() => [
      GoRoute(
        path: '/court/public-lookup',
        builder: (_, __) => const PublicLookupScreen(),
      ),
    ];
