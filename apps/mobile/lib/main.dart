import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/auth/pkce_auth.dart';
import 'core/providers.dart';
import 'core/shell/app_shell.dart';
import 'features/finance/payments_screen.dart';
import 'features/finance/journal_screen.dart';
import 'features/hr/employees_screen.dart';
import 'features/hr/leave_screen.dart';
import 'features/hr/attendance_screen.dart';
import 'features/procurement/indents_screen.dart';
import 'features/procurement/pos_screen.dart';
import 'features/procurement/approvals_screen.dart';
import 'features/crm/contacts_screen.dart';
import 'features/crm/deals_screen.dart';
import 'features/helpdesk/tickets_screen.dart';
import 'features/projects/projects_screen.dart';
import 'features/estab/files_screen.dart';
import 'features/mis/mis_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: CivitasOneApp()));
}

class CivitasOneApp extends ConsumerWidget {
  const CivitasOneApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = GoRouter(
      initialLocation: '/login',
      redirect: (context, state) async {
        final token = await ref.read(authProvider).accessToken();
        if (token == null && state.matchedLocation != '/login') return '/login';
        return null;
      },
      routes: [
        GoRoute(
          path: '/login',
          builder: (_, __) => LoginScreen(auth: ref.read(authProvider)),
        ),
        ShellRoute(
          builder: (ctx, state, child) => AppShell(child: child),
          routes: [
            GoRoute(path: '/dashboard', builder: (_, __) => const DashboardScreen()),
            GoRoute(path: '/finance/payments', builder: (_, __) => const PaymentsScreen()),
            GoRoute(path: '/finance/journals', builder: (_, __) => const JournalScreen()),
            GoRoute(path: '/hr/employees', builder: (_, __) => const EmployeesScreen()),
            GoRoute(path: '/hr/leave', builder: (_, __) => const LeaveScreen()),
            GoRoute(path: '/hr/attendance', builder: (_, __) => const AttendanceScreen()),
            GoRoute(path: '/procurement/indents', builder: (_, __) => const IndentsScreen()),
            GoRoute(path: '/procurement/pos', builder: (_, __) => const PurchaseOrdersScreen()),
            GoRoute(path: '/procurement/approvals', builder: (_, __) => const ApprovalsScreen()),
            GoRoute(path: '/crm/contacts', builder: (_, __) => const ContactsScreen()),
            GoRoute(path: '/crm/deals', builder: (_, __) => const DealsScreen()),
            GoRoute(path: '/helpdesk/tickets', builder: (_, __) => const TicketsScreen()),
            GoRoute(path: '/projects', builder: (_, __) => const ProjectsScreen()),
            GoRoute(path: '/estab/files', builder: (_, __) => const EstabFilesScreen()),
            GoRoute(path: '/mis', builder: (_, __) => const MisScreen()),
          ],
        ),
      ],
    );
    return MaterialApp.router(
      title: 'CivitasOne Suite',
      routerConfig: router,
      theme: ThemeData(useMaterial3: true),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.auth});
  final PkceAuthService auth;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _loading = false;

  Future<void> _signIn() async {
    setState(() => _loading = true);
    try {
      await widget.auth.signIn();
      if (mounted) context.go('/dashboard');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('CivitasOne — Secure Sign In', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('PKCE · device trust · SQLite offline sync'),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _loading ? null : _signIn,
            child: Text(_loading ? 'Signing in…' : 'Sign in with Keycloak'),
          ),
        ]),
      ),
    );
  }
}

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  static const _modules = [
    (label: 'Approvals', icon: Icons.approval, route: '/procurement/approvals', color: Color(0xFF6366F1)),
    (label: 'Finance', icon: Icons.account_balance, route: '/finance/payments', color: Color(0xFF22C55E)),
    (label: 'HR', icon: Icons.people, route: '/hr/employees', color: Color(0xFFF59E0B)),
    (label: 'Procurement', icon: Icons.shopping_cart, route: '/procurement/indents', color: Color(0xFFEF4444)),
    (label: 'CRM', icon: Icons.contacts, route: '/crm/contacts', color: Color(0xFF8B5CF6)),
    (label: 'Helpdesk', icon: Icons.support_agent, route: '/helpdesk/tickets', color: Color(0xFF06B6D4)),
    (label: 'Projects', icon: Icons.folder, route: '/projects', color: Color(0xFFEC4899)),
    (label: 'MIS', icon: Icons.bar_chart, route: '/mis', color: Color(0xFF10B981)),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('CivitasOne')),
      body: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 1.2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
        ),
        itemCount: _modules.length,
        itemBuilder: (ctx, i) {
          final m = _modules[i];
          return InkWell(
            onTap: () => context.go(m.route),
            borderRadius: BorderRadius.circular(12),
            child: Container(
              decoration: BoxDecoration(
                color: m.color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: m.color.withOpacity(0.3)),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(m.icon, size: 36, color: m.color),
                  const SizedBox(height: 8),
                  Text(m.label, style: TextStyle(fontWeight: FontWeight.w600, color: m.color)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
