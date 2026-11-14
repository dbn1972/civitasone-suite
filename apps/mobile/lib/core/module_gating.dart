import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'providers.dart';

/// All gatable module keys mapped to their routes.
/// Routes not listed here are always allowed (e.g. /dashboard, /settings).
const Map<String, List<String>> moduleRouteMap = {
  'finance': ['/finance', '/biz/invoices', '/biz/payments', '/biz/expenses'],
  // M2: HR, Payroll and Recruitment are separate switches. Routes resolve by the
  // LONGEST matching prefix, so '/hr/payslips' belongs to payroll and '/hr/vacancies'
  // to recruitment while the rest of '/hr' stays HR.
  'hrms': ['/hr', '/attendance', '/directory'],
  'payroll': ['/hr/payslips'],
  'recruitment': ['/hr/vacancies'],
  'procurement': ['/procurement'],
  'stock': ['/stock'],
  'citizen': ['/citizen'],
  'crm': ['/crm'],
  'helpdesk': ['/helpdesk'],
  'projects': ['/projects'],
  'assets': ['/assets'],
  'grants': ['/grants'],
  'audit': ['/audit'],
  'legal': ['/legal'],
  'knowledge': ['/knowledge'],
  'reports': ['/reports', '/mis'],
  'establishment': ['/estab'],
  'billing': ['/biz/dashboard', '/biz/customers'],
};

/// Provider that fetches enabled modules from the tenant_settings mailbox.
/// Returns null if not yet loaded (show all = backward compatible).
final enabledModulesProvider =
    FutureProvider.autoDispose<List<String>?>((ref) async {
  final db = await ref.watch(dbProvider.future);
  final settings = await db.listEntities('tenant_settings');
  // Look for the 'enabled_modules' key in tenant settings
  for (final setting in settings) {
    final data = setting['data'] as Map<String, dynamic>?;
    if (data != null && data['key'] == 'enabled_modules') {
      final modules = data['value'];
      if (modules is List) return modules.cast<String>();
    }
  }
  return null; // null = show all (backward compatible)
});

/// Switch keys of the HR area (M2). Mirrors apps/web/src/lib/moduleMatch.ts.
const String hrSwitch = 'hrms';
const String payrollSwitch = 'payroll';
const String recruitmentSwitch = 'recruitment';

/// Which tenant-list entries turn each HR-area switch on. EXACT match only (no
/// prefix / substring), lower-case.
///
///   entry                    HR   Payroll  Recruitment
///   hrms (legacy blanket)    on   on       on    <- compat rule: one blanket
///   hr   (legacy alias)      on   on       on       switch keeps all three
///   hrms-leave, -attendance, on   -        -
///    -appraisal, -self-service, -training, -social, -disciplinary,
///    -deputation, -contracts, -assessment, -id-cards, -ai, -rti,
///    -workforce-planning, -board-intake, -competency
///   payroll                  -    on       -
///   hrms-recruitment         -    -        on
///   hrms-payroll             -    -        -     <- NOT the Payroll switch
///   workforce_core           -    -        -     <- core alone never opens HR
const Map<String, List<String>> switchEnablers = {
  hrSwitch: [
    'hrms',
    'hr',
    'hrms-leave',
    'hrms-attendance',
    'hrms-appraisal',
    'hrms-self-service',
    'hrms-training',
    'hrms-social',
    'hrms-disciplinary',
    'hrms-deputation',
    'hrms-contracts',
    'hrms-assessment',
    'hrms-id-cards',
    'hrms-ai',
    'hrms-rti',
    'hrms-workforce-planning',
    'hrms-board-intake',
    'hrms-competency',
  ],
  payrollSwitch: ['hrms', 'hr', 'payroll'],
  recruitmentSwitch: ['hrms', 'hr', 'hrms-recruitment'],
};

/// Exact-match aliases for every other module key (key -> extra list entries
/// that also enable it).
const Map<String, List<String>> moduleAliases = {
  'estab': ['establishment'],
  'establishment': ['estab'],
};

/// Check if a specific module is enabled for the current tenant.
/// Matching is EXACT (M2): the entry equals the key, is in the key's alias
/// table, or - for the HR / Payroll / Recruitment switches - is in
/// [switchEnablers]. No contains() matching, so "hrms-payroll" does not turn
/// Payroll on and "finance" does not turn on "fin".
bool isModuleEnabled(List<String>? enabledModules, String moduleKey) {
  if (enabledModules == null) return true; // unknown = show all
  var key = moduleKey.toLowerCase();
  if (key == 'hr') key = hrSwitch; // old spelling of the HR switch
  final names = enabledModules.map((m) => m.toLowerCase());
  final enablers = switchEnablers[key];
  if (enablers != null) {
    return names.any(enablers.contains);
  }
  final aliases = moduleAliases[key] ?? const <String>[];
  return names.any((name) => name == key || aliases.contains(name));
}

/// The moduleRouteMap entry whose prefix is the longest match for [path].
MapEntry<String, String>? _bestRouteMatch(String path) {
  MapEntry<String, String>? best;
  for (final entry in moduleRouteMap.entries) {
    for (final prefix in entry.value) {
      if (path.startsWith(prefix) &&
          (best == null || prefix.length > best.value.length)) {
        best = MapEntry(entry.key, prefix);
      }
    }
  }
  return best;
}

/// Check if a route is allowed based on enabled modules.
/// Routes not in moduleRouteMap are always allowed.
bool isRouteAllowed(List<String>? enabledModules, String path) {
  if (enabledModules == null) return true;
  final match = _bestRouteMatch(path);
  if (match == null) return true; // routes not in the map are always allowed
  return isModuleEnabled(enabledModules, match.key);
}

/// Find which module key a route belongs to (for the disabled screen message).
String? moduleKeyForRoute(String path) => _bestRouteMatch(path)?.key;
