import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// App shell with bottom navigation bar + drawer for secondary modules.
/// Bottom nav: Home, Approvals, Leave, Payslips, Profile
/// Drawer: Full module list for power users
class AppShell extends StatelessWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  /// Primary bottom nav items — the 5 most-used employee actions
  static const _bottomNavItems = [
    (label: 'Home', icon: Icons.home_rounded, route: '/dashboard'),
    (label: 'Approvals', icon: Icons.task_alt, route: '/hr/approvals'),
    (label: 'Leave', icon: Icons.event_note, route: '/hr/leave'),
    (label: 'Payslips', icon: Icons.receipt_long, route: '/hr/payslips'),
    (label: 'Profile', icon: Icons.person, route: '/hr/profile'),
  ];

  /// Drawer nav — full module access
  static const _drawerSections = [
    (
      title: 'HR & Self-Service',
      items: [
        (label: 'Dashboard', icon: Icons.dashboard, route: '/hr/dashboard'),
        (label: 'My Profile', icon: Icons.person, route: '/hr/profile'),
        (label: 'Leave', icon: Icons.event_note, route: '/hr/leave'),
        (label: 'Leave Balance', icon: Icons.pie_chart, route: '/hr/leave-balance'),
        (label: 'Attendance', icon: Icons.fingerprint, route: '/hr/attendance'),
        (label: 'Geo Check-in', icon: Icons.location_on, route: '/hr/geo-checkin'),
        (label: 'Payslips', icon: Icons.receipt_long, route: '/hr/payslips'),
        (label: 'Loans & Advances', icon: Icons.account_balance_wallet, route: '/hr/loans'),
        (label: 'Holidays', icon: Icons.event, route: '/hr/holidays'),
        (label: 'Team Directory', icon: Icons.people, route: '/hr/team'),
        (label: 'Grievances', icon: Icons.feedback, route: '/hr/grievances'),
        (label: 'Job Vacancies', icon: Icons.work, route: '/hr/vacancies'),
      ],
    ),
    (
      title: 'Finance',
      items: [
        (label: 'Payments', icon: Icons.payments, route: '/finance/payments'),
        (label: 'Journals', icon: Icons.book, route: '/finance/journals'),
      ],
    ),
    (
      title: 'Procurement',
      items: [
        (label: 'Indents', icon: Icons.shopping_cart, route: '/procurement/indents'),
        (label: 'Purchase Orders', icon: Icons.receipt, route: '/procurement/pos'),
        (label: 'Approvals', icon: Icons.approval, route: '/procurement/approvals'),
      ],
    ),
    (
      title: 'Other',
      items: [
        (label: 'CRM Contacts', icon: Icons.contacts, route: '/crm/contacts'),
        (label: 'CRM Deals', icon: Icons.handshake, route: '/crm/deals'),
        (label: 'Helpdesk', icon: Icons.support_agent, route: '/helpdesk/tickets'),
        (label: 'Projects', icon: Icons.folder, route: '/projects'),
        (label: 'Estab Files', icon: Icons.description, route: '/estab/files'),
        (label: 'MIS', icon: Icons.bar_chart, route: '/mis'),
      ],
    ),
  ];

  int _currentIndex(String location) {
    for (int i = 0; i < _bottomNavItems.length; i++) {
      if (location.startsWith(_bottomNavItems[i].route)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final currentIdx = _currentIndex(location);
    final theme = Theme.of(context);

    return Scaffold(
      // Drawer for power users — full module access
      drawer: NavigationDrawer(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 8),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: const Color(0xFF6366F1).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.account_balance,
                      color: Color(0xFF6366F1), size: 22),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('CivitasOne',
                        style: theme.textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    Text('Employee Portal',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.outline)),
                  ],
                ),
              ],
            ),
          ),
          const Divider(),
          // Notifications link at top
          ListTile(
            leading: const Icon(Icons.notifications_active),
            title: const Text('Notifications'),
            onTap: () {
              Navigator.of(context).pop();
              context.go('/notifications');
            },
          ),
          const Divider(),
          for (final section in _drawerSections) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 4),
              child: Text(
                section.title,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.outline,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
            ),
            for (final item in section.items)
              ListTile(
                leading: Icon(item.icon, size: 22),
                title: Text(item.label),
                selected: location.startsWith(item.route),
                selectedTileColor:
                    const Color(0xFF6366F1).withOpacity(0.05),
                onTap: () {
                  Navigator.of(context).pop();
                  context.go(item.route);
                },
                dense: true,
                visualDensity: VisualDensity.compact,
              ),
          ],
        ],
      ),
      // App bar with hamburger + notification bell
      appBar: AppBar(
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
        title: const Text('CivitasOne'),
        centerTitle: false,
        actions: [
          IconButton(
            icon: const Badge(
              smallSize: 8,
              child: Icon(Icons.notifications_outlined),
            ),
            onPressed: () => context.go('/notifications'),
          ),
        ],
      ),
      // Main content
      body: child,
      // Bottom navigation — the core 5 actions
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIdx,
        onDestinationSelected: (index) {
          context.go(_bottomNavItems[index].route);
        },
        destinations: _bottomNavItems
            .map((item) => NavigationDestination(
                  icon: Icon(item.icon),
                  label: item.label,
                ))
            .toList(),
      ),
    );
  }
}
