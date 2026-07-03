import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../module_gating.dart';

/// Small business shell with bottom navigation.
/// 5 tabs: Home, Invoices, Payments, Expenses, Customers.
/// Large tap targets, zero clutter, one-thumb operation.
/// Filters nav items based on enabled modules for the tenant.
class BizShell extends ConsumerWidget {
  final Widget child;
  const BizShell({super.key, required this.child});

  static const _navItems = [
    (label: 'Home', icon: Icons.home_rounded, route: '/biz/dashboard'),
    (label: 'Invoices', icon: Icons.receipt_long, route: '/biz/invoices'),
    (label: 'Payments', icon: Icons.payments, route: '/biz/payments'),
    (label: 'Expenses', icon: Icons.bar_chart, route: '/biz/expenses'),
    (label: 'Customers', icon: Icons.people, route: '/biz/customers'),
  ];

  int _currentIndex(String location, List<({String label, IconData icon, String route})> visibleItems) {
    for (int i = 0; i < visibleItems.length; i++) {
      if (location.startsWith(visibleItems[i].route)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).matchedLocation;
    final enabledModules = ref.watch(enabledModulesProvider).valueOrNull;

    // Only show nav items whose routes are allowed
    final visibleItems = _navItems
        .where((item) => isRouteAllowed(enabledModules, item.route))
        .toList();

    final currentIdx = _currentIndex(location, visibleItems);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIdx.clamp(0, visibleItems.length - 1),
        onDestinationSelected: (index) {
          context.go(visibleItems[index].route);
        },
        destinations: visibleItems
            .map((item) => NavigationDestination(
                  icon: Icon(item.icon),
                  label: item.label,
                ))
            .toList(),
      ),
    );
  }
}
