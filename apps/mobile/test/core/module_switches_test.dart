import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/core/module_gating.dart';

/// M2 / M7: HR, Payroll and Recruitment are separate switches on mobile, with
/// exact key matching (no contains()). Mirrors apps/web/src/lib/moduleMatch.ts.
///
/// FROZEN REFERENCE: [legacyIsModuleEnabled] is a verbatim copy of the matcher as
/// it was before this change; it is the "what existing tenants see today" oracle
/// for the parity group.
bool legacyIsModuleEnabled(List<String>? enabledModules, String moduleKey) {
  if (enabledModules == null) return true;
  final key = moduleKey.toLowerCase();
  return enabledModules.any((m) {
    final name = m.toLowerCase();
    return name == key || name.contains(key) || key.contains(name);
  });
}

const legacyVocab = [
  'finance', 'procurement', 'hrms', 'payroll', 'projects', 'assets', 'stock',
  'grants', 'citizen', 'legal', 'crm', 'helpdesk', 'knowledge', 'reports',
  'establishment', 'billing', 'audit',
];

void main() {
  group('switch table', () {
    test('HR on via hrms-* HR sub-keys, never via recruitment / payroll keys', () {
      for (final k in [
        'hrms-leave',
        'hrms-attendance',
        'hrms-appraisal',
        'hrms-self-service',
        'hrms-training',
      ]) {
        expect(isModuleEnabled([k], hrSwitch), isTrue, reason: k);
      }
      for (final k in ['hrms-recruitment', 'hrms-payroll', 'payroll']) {
        expect(isModuleEnabled([k], hrSwitch), isFalse, reason: k);
      }
    });

    test('Payroll is on ONLY via payroll (or the legacy blanket)', () {
      expect(isModuleEnabled(['payroll'], payrollSwitch), isTrue);
      expect(isModuleEnabled(['hrms-payroll'], payrollSwitch), isFalse);
      expect(
          isModuleEnabled(
              ['workforce_core', 'hrms-payroll', 'hrms-leave'], payrollSwitch),
          isFalse);
    });

    test('Recruitment is on ONLY via hrms-recruitment (or the legacy blanket)', () {
      expect(isModuleEnabled(['hrms-recruitment'], recruitmentSwitch), isTrue);
      expect(isModuleEnabled(['hrms-leave', 'payroll'], recruitmentSwitch),
          isFalse);
    });

    test('legacy blanket hrms / hr keeps all three switches on', () {
      for (final blanket in ['hrms', 'hr', 'HRMS']) {
        expect(isModuleEnabled([blanket], hrSwitch), isTrue);
        expect(isModuleEnabled([blanket], payrollSwitch), isTrue);
        expect(isModuleEnabled([blanket], recruitmentSwitch), isTrue);
      }
    });

    test('Workforce Core alone does not open the HR area', () {
      expect(isModuleEnabled(['workforce_core', 'smarttransfer'], hrSwitch),
          isFalse);
    });

    test('unknown (null) list shows everything', () {
      expect(isModuleEnabled(null, payrollSwitch), isTrue);
      expect(isModuleEnabled(null, recruitmentSwitch), isTrue);
    });
  });

  group('no neighbour turn-on', () {
    test('hrms-recruitment alone: no Payroll, no HR core', () {
      expect(isModuleEnabled(['hrms-recruitment'], payrollSwitch), isFalse);
      expect(isModuleEnabled(['hrms-recruitment'], hrSwitch), isFalse);
    });
    test('payroll alone: no Recruitment, no HR core', () {
      expect(isModuleEnabled(['payroll'], recruitmentSwitch), isFalse);
      expect(isModuleEnabled(['payroll'], hrSwitch), isFalse);
    });
    test('finance does not turn on fin / finance-reports and vice versa', () {
      expect(isModuleEnabled(['finance'], 'fin'), isFalse);
      expect(isModuleEnabled(['fin'], 'finance'), isFalse);
      expect(isModuleEnabled(['finance-reports'], 'finance'), isFalse);
      expect(isModuleEnabled(['finance'], 'finance-reports'), isFalse);
    });
    test('establishment <-> estab only through the alias table', () {
      expect(isModuleEnabled(['establishment'], 'estab'), isTrue);
      expect(isModuleEnabled(['estab'], 'establishment'), isTrue);
      expect(isModuleEnabled(['establish'], 'establishment'), isFalse);
    });
  });

  group('routes', () {
    final hrOnly = ['hrms-leave', 'hrms-attendance', 'hrms-payroll', 'finance'];

    test('HR-only tenant: payslip route blocked, other HR routes allowed', () {
      expect(isRouteAllowed(hrOnly, '/hr/payslips'), isFalse);
      expect(isRouteAllowed(hrOnly, '/hr/leave'), isTrue);
      expect(isRouteAllowed(hrOnly, '/hr/dashboard'), isTrue);
      expect(isRouteAllowed(hrOnly, '/attendance/check-in'), isTrue);
    });

    test('recruitment off hides vacancies only', () {
      expect(isRouteAllowed(hrOnly, '/hr/vacancies'), isFalse);
      expect(isRouteAllowed([...hrOnly, 'hrms-recruitment'], '/hr/vacancies'),
          isTrue);
    });

    test('payroll on re-enables the payslip route', () {
      expect(isRouteAllowed([...hrOnly, 'payroll'], '/hr/payslips'), isTrue);
    });

    test('longest-prefix routing: moduleKeyForRoute', () {
      expect(moduleKeyForRoute('/hr/payslips'), 'payroll');
      expect(moduleKeyForRoute('/hr/payslips/123'), 'payroll');
      expect(moduleKeyForRoute('/hr/vacancies'), 'recruitment');
      expect(moduleKeyForRoute('/hr/leave'), 'hrms');
      expect(moduleKeyForRoute('/attendance/history'), 'hrms');
    });

    test('null list allows every route', () {
      expect(isRouteAllowed(null, '/hr/payslips'), isTrue);
      expect(isRouteAllowed(null, '/hr/vacancies'), isTrue);
    });
  });

  group('parity with the pre-change matcher for existing tenants', () {
    final allKeys = [...moduleRouteMap.keys, 'hr', 'estab'];
    final lists = <List<String>>[
      legacyVocab,
      ['hrms', 'payroll', 'establishment', 'finance'],
      ['hrms'],
      ['hr', 'finance', 'estab'],
      ['finance'],
      for (final k in legacyVocab) legacyVocab.where((x) => x != k).toList(),
    ];

    test('every non-HR module key resolves as before', () {
      for (final list in lists) {
        for (final key in allKeys) {
          if (key == 'payroll' || key == 'recruitment') continue;
          expect(isModuleEnabled(list, key), legacyIsModuleEnabled(list, key),
              reason: '$key in $list');
        }
      }
    });

    test('every route resolves as before (payslip / vacancies = old hrms key)', () {
      const routes = [
        '/finance/payments', '/biz/invoices', '/biz/dashboard', '/hr/leave',
        '/hr/payslips', '/hr/vacancies', '/attendance/history', '/directory',
        '/procurement/indents', '/stock/scanner', '/citizen/requests',
        '/estab/files', '/mis', '/dashboard', '/settings', '/login',
      ];
      for (final list in lists) {
        // payroll without a hrms/hr key never saw the HR area before; it now
        // sees payslips (intended separation) - covered by its own test below.
        final payrollWithoutBlanket = list.contains('payroll') &&
            !list.contains('hrms') &&
            !list.contains('hr');
        for (final route in routes) {
          if (payrollWithoutBlanket && route == '/hr/payslips') continue;
          final oldKey = (route == '/hr/payslips' || route == '/hr/vacancies')
              ? 'hrms'
              : moduleKeyForRoute(route);
          final before =
              oldKey == null ? true : legacyIsModuleEnabled(list, oldKey);
          expect(isRouteAllowed(list, route), before,
              reason: '$route in $list');
        }
      }
    });

    test('documented difference: payroll without hrms now opens payslips only', () {
      expect(legacyIsModuleEnabled(['payroll', 'finance'], 'hrms'), isFalse);
      expect(isRouteAllowed(['payroll', 'finance'], '/hr/payslips'), isTrue);
      expect(isRouteAllowed(['payroll', 'finance'], '/hr/leave'), isFalse);
    });
  });
}
