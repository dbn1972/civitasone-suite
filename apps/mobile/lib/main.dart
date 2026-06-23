import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/auth/pkce_auth.dart';
import 'core/background_sync.dart';
import 'core/providers.dart';
import 'core/shell/app_shell.dart';
import 'features/finance/payments_screen.dart';
import 'features/finance/journal_screen.dart';
import 'features/hr/hr_module.dart';
import 'features/procurement/indents_screen.dart';
import 'features/procurement/pos_screen.dart';
import 'features/procurement/approvals_screen.dart';
import 'features/crm/contacts_screen.dart';
import 'features/crm/deals_screen.dart';
import 'features/helpdesk/tickets_screen.dart';
import 'features/helpdesk/ticket_create_screen.dart';
import 'features/projects/projects_screen.dart';
import 'features/estab/files_screen.dart';
import 'features/mis/mis_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // MOB-1c (02-T3): register background sync. Guarded so an unsupported platform
  // (e.g. tests / desktop) never blocks app start.
  try {
    await initBackgroundSync();
  } catch (_) {/* background sync unavailable on this platform */}
  runApp(const ProviderScope(child: CivitasOneApp()));
}

class CivitasOneApp extends ConsumerStatefulWidget {
  const CivitasOneApp({super.key});

  @override
  ConsumerState<CivitasOneApp> createState() => _CivitasOneAppState();
}

class _CivitasOneAppState extends ConsumerState<CivitasOneApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // MOB-1c: flush queued mutations + pull deltas when the app returns to foreground.
    if (state == AppLifecycleState.resumed) {
      final engine = ref.read(syncEngineProvider);
      if (engine != null) {
        // Fire and forget; failures are retried by the periodic task.
        // ignore: discarded_futures
        syncAllMailboxes(engine);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ref = this.ref;
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
            ...hrShellRoutes(),
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
        // Write-path screens rendered outside the shell (no bottom nav).
        ...hrFullScreenRoutes(),
        GoRoute(
          path: '/helpdesk/tickets/new',
          builder: (_, __) => const TicketCreateScreen(),
        ),
      ],
    );
    return MaterialApp.router(
      title: 'CivitasOne Suite',
      routerConfig: router,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF6366F1),
      ),
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
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Sign-in failed: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: const Color(0xFF6366F1).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.account_balance,
                    size: 36, color: Color(0xFF6366F1)),
              ),
              const SizedBox(height: 24),
              Text('CivitasOne Suite',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(
                'Government · PSU · Enterprise',
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: Theme.of(context).colorScheme.outline),
              ),
              const SizedBox(height: 8),
              const Text('PKCE · device trust · offline sync',
                  style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _loading ? null : _signIn,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                  child: _loading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Sign in with Keycloak',
                          style: TextStyle(fontSize: 16)),
                ),
              ),
            ]),
          ),
        ),
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
      appBar: AppBar(
        title: const Text('CivitasOne'),
        centerTitle: false,
      ),
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
                  Text(m.label,
                      style: TextStyle(
                          fontWeight: FontWeight.w600, color: m.color)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
