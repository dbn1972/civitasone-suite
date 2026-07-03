import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Small business shell with bottom navigation.
/// 5 tabs: Home, Invoices, Payments, Expenses, Customers.
/// Large tap targets, zero clutter, one-thumb operation.
class BizShell extends StatelessWidget {
  final Widget child;
  const BizShell({super.key, required this.child});

  static const _navItems = [
    (label: 'Home', icon: Icons.home_rounded, route: '/biz/dashboard'),
    (label: 'Invoices', icon: Icons.receipt_long, route: '/biz/invoices'),
    (label: 'Payments', icon: Icons.payments, route: '/biz/payments'),
    (label: 'Expenses', icon: Icons.bar_chart, route: '/biz/expenses'),
    (label: 'Customers', icon: Icons.people, route: '/biz/customers'),
  ];

  int _currentIndex(String location) {
    for (int i = 0; i < _navItems.length; i++) {
      if (location.startsWith(_navItems[i].route)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final currentIdx = _currentIndex(location);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIdx,
        onDestinationSelected: (index) {
          context.go(_navItems[index].route);
        },
        destinations: _navItems
            .map((item) => NavigationDestination(
                  icon: Icon(item.icon),
                  label: item.label,
                ))
            .toList(),
      ),
    );
  }
}
