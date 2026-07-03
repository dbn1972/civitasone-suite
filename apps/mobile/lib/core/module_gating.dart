import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'providers.dart';

/// All gatable module keys mapped to their routes.
/// Routes not listed here are always allowed (e.g. /dashboard, /settings).
const Map<String, List<String>> moduleRouteMap = {
  'finance': ['/finance', '/biz/invoices', '/biz/payments', '/biz/expenses'],
  'hrms': ['/hr', '/attendance', '/directory'],
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

/// Check if a specific module is enabled for the current tenant.
/// Lenient matching: "hrms" matches "hr", "establishment" matches "estab", etc.
bool isModuleEnabled(List<String>? enabledModules, String moduleKey) {
  if (enabledModules == null) return true; // unknown = show all
  final key = moduleKey.toLowerCase();
  return enabledModules.any((m) {
    final name = m.toLowerCase();
    return name == key || name.contains(key) || key.contains(name);
  });
}

/// Check if a route is allowed based on enabled modules.
/// Routes not in moduleRouteMap are always allowed.
bool isRouteAllowed(List<String>? enabledModules, String path) {
  if (enabledModules == null) return true;
  for (final entry in moduleRouteMap.entries) {
    if (entry.value.any((prefix) => path.startsWith(prefix))) {
      return isModuleEnabled(enabledModules, entry.key);
    }
  }
  return true; // routes not in the map are always allowed
}

/// Find which module key a route belongs to (for the disabled screen message).
String? moduleKeyForRoute(String path) {
  for (final entry in moduleRouteMap.entries) {
    if (entry.value.any((prefix) => path.startsWith(prefix))) {
      return entry.key;
    }
  }
  return null;
}
