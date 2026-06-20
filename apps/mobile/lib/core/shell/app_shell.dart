import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class AppShell extends StatelessWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  static const _navItems = [
    (label: 'Dashboard', icon: Icons.dashboard, route: '/dashboard'),
    (label: 'Approvals', icon: Icons.approval, route: '/procurement/approvals'),
    (label: 'Finance', icon: Icons.account_balance, route: '/finance/payments'),
    (label: 'HR', icon: Icons.people, route: '/hr/employees'),
    (label: 'Procurement', icon: Icons.shopping_cart, route: '/procurement/indents'),
    (label: 'CRM', icon: Icons.contacts, route: '/crm/contacts'),
    (label: 'Helpdesk', icon: Icons.support_agent, route: '/helpdesk/tickets'),
    (label: 'Projects', icon: Icons.folder, route: '/projects'),
    (label: 'Estab Files', icon: Icons.description, route: '/estab/files'),
    (label: 'MIS', icon: Icons.bar_chart, route: '/mis'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: NavigationDrawer(
        children: [
          const DrawerHeader(
            child: Text('CivitasOne', style: TextStyle(fontSize: 20)),
          ),
          for (final item in _navItems)
            ListTile(
              leading: Icon(item.icon),
              title: Text(item.label),
              onTap: () {
                Navigator.of(context).pop();
                context.go(item.route);
              },
            ),
        ],
      ),
      body: child,
    );
  }
}
