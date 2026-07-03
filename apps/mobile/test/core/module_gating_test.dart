import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:civitasone_mobile/core/module_gating.dart';
import 'package:civitasone_mobile/core/widgets/module_disabled_screen.dart';

void main() {
  group('isModuleEnabled', () {
    test('returns true when enabledModules is null (backward compatible)', () {
      expect(isModuleEnabled(null, 'finance'), isTrue);
      expect(isModuleEnabled(null, 'hrms'), isTrue);
      expect(isModuleEnabled(null, 'anything'), isTrue);
    });

    test('returns true for exact match', () {
      expect(isModuleEnabled(['finance', 'hrms'], 'finance'), isTrue);
      expect(isModuleEnabled(['finance', 'hrms'], 'hrms'), isTrue);
    });

    test('returns false when module not in list', () {
      expect(isModuleEnabled(['finance'], 'procurement'), isFalse);
      expect(isModuleEnabled(['hrms'], 'legal'), isFalse);
    });

    test('lenient matching: "hrms" matches "hr"', () {
      expect(isModuleEnabled(['hrms'], 'hr'), isTrue);
    });

    test('lenient matching: "hr" matches "hrms"', () {
      expect(isModuleEnabled(['hr'], 'hrms'), isTrue);
    });

    test('lenient matching: "establishment" matches "estab"', () {
      expect(isModuleEnabled(['establishment'], 'estab'), isTrue);
    });

    test('case insensitive matching', () {
      expect(isModuleEnabled(['FINANCE'], 'finance'), isTrue);
      expect(isModuleEnabled(['Finance'], 'FINANCE'), isTrue);
    });

    test('empty list disables all modules', () {
      expect(isModuleEnabled([], 'finance'), isFalse);
      expect(isModuleEnabled([], 'hrms'), isFalse);
    });
  });

  group('isRouteAllowed', () {
    test('returns true when enabledModules is null', () {
      expect(isRouteAllowed(null, '/finance/payments'), isTrue);
      expect(isRouteAllowed(null, '/hr/leave'), isTrue);
    });

    test('allows routes whose module is enabled', () {
      expect(isRouteAllowed(['finance'], '/finance/payments'), isTrue);
      expect(isRouteAllowed(['finance'], '/biz/invoices'), isTrue);
      expect(isRouteAllowed(['finance'], '/biz/payments'), isTrue);
      expect(isRouteAllowed(['finance'], '/biz/expenses'), isTrue);
    });

    test('blocks routes whose module is disabled', () {
      expect(isRouteAllowed(['finance'], '/hr/leave'), isFalse);
      expect(isRouteAllowed(['finance'], '/procurement/indents'), isFalse);
      expect(isRouteAllowed(['hrms'], '/finance/payments'), isFalse);
    });

    test('always allows routes not in moduleRouteMap', () {
      expect(isRouteAllowed(['finance'], '/dashboard'), isTrue);
      expect(isRouteAllowed(['finance'], '/settings'), isTrue);
      expect(isRouteAllowed(['finance'], '/splash'), isTrue);
      expect(isRouteAllowed(['finance'], '/login'), isTrue);
      expect(isRouteAllowed([], '/dashboard'), isTrue);
    });

    test('blocks nested routes of disabled modules', () {
      expect(isRouteAllowed(['finance'], '/hr/leave/apply'), isFalse);
      expect(isRouteAllowed(['finance'], '/procurement/indents/new'), isFalse);
    });

    test('allows all routes when list contains the module', () {
      final all = ['finance', 'hrms', 'procurement', 'stock', 'citizen',
          'crm', 'helpdesk', 'projects', 'assets', 'grants', 'audit',
          'legal', 'knowledge', 'reports', 'establishment', 'billing'];
      expect(isRouteAllowed(all, '/finance/payments'), isTrue);
      expect(isRouteAllowed(all, '/hr/leave'), isTrue);
      expect(isRouteAllowed(all, '/procurement/indents'), isTrue);
      expect(isRouteAllowed(all, '/stock/scanner'), isTrue);
    });
  });

  group('moduleKeyForRoute', () {
    test('returns correct module key for known routes', () {
      expect(moduleKeyForRoute('/finance/payments'), 'finance');
      expect(moduleKeyForRoute('/hr/leave'), 'hrms');
      expect(moduleKeyForRoute('/procurement/indents'), 'procurement');
      expect(moduleKeyForRoute('/biz/invoices'), 'finance');
    });

    test('returns null for routes not in the map', () {
      expect(moduleKeyForRoute('/dashboard'), isNull);
      expect(moduleKeyForRoute('/settings'), isNull);
      expect(moduleKeyForRoute('/login'), isNull);
    });
  });

  group('ModuleDisabledScreen', () {
    testWidgets('renders module name', (tester) async {
      await tester.pumpWidget(
        MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: '/test',
            routes: [
              GoRoute(
                path: '/test',
                builder: (_, __) =>
                    const ModuleDisabledScreen(moduleName: 'Finance'),
              ),
              GoRoute(
                path: '/dashboard',
                builder: (_, __) => const Scaffold(body: Text('Dashboard')),
              ),
              GoRoute(
                path: '/settings',
                builder: (_, __) => const Scaffold(body: Text('Settings')),
              ),
            ],
          ),
        ),
      );

      expect(find.text('Module Not Enabled'), findsOneWidget);
      expect(
        find.textContaining('Finance module is not enabled'),
        findsOneWidget,
      );
      expect(find.text('Back to Dashboard'), findsOneWidget);
      expect(find.text('Go to Settings'), findsOneWidget);
    });

    testWidgets('renders with generic name when moduleName is "This"', (tester) async {
      await tester.pumpWidget(
        MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: '/test',
            routes: [
              GoRoute(
                path: '/test',
                builder: (_, __) =>
                    const ModuleDisabledScreen(moduleName: 'This'),
              ),
              GoRoute(
                path: '/dashboard',
                builder: (_, __) => const Scaffold(body: Text('Dashboard')),
              ),
              GoRoute(
                path: '/settings',
                builder: (_, __) => const Scaffold(body: Text('Settings')),
              ),
            ],
          ),
        ),
      );

      expect(find.text('Module Not Enabled'), findsOneWidget);
      expect(find.textContaining('This module is not enabled'), findsOneWidget);
    });

    testWidgets('tapping "Back to Dashboard" navigates to /dashboard', (tester) async {
      await tester.pumpWidget(
        MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: '/test',
            routes: [
              GoRoute(
                path: '/test',
                builder: (_, __) =>
                    const ModuleDisabledScreen(moduleName: 'Procurement'),
              ),
              GoRoute(
                path: '/dashboard',
                builder: (_, __) => const Scaffold(body: Text('Dashboard')),
              ),
              GoRoute(
                path: '/settings',
                builder: (_, __) => const Scaffold(body: Text('Settings')),
              ),
            ],
          ),
        ),
      );

      await tester.tap(find.text('Back to Dashboard'));
      await tester.pumpAndSettle();
      expect(find.text('Dashboard'), findsOneWidget);
    });
  });
}
