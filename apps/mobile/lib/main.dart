import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/auth/pkce_auth.dart';
import 'core/background_sync.dart';
import 'core/providers.dart';
import 'core/shell/app_shell.dart';
import 'core/theme/app_colors.dart';
import 'core/splash_screen.dart';
import 'core/auth/biometric_lock.dart';
import 'core/auth/lock_screen.dart';
import 'core/device_heartbeat.dart';
import 'core/onboarding_screen.dart';
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
import 'features/estab/efile_screen.dart';
import 'features/mis/mis_screen.dart';
import 'features/assets/asset_scan_screen.dart';
import 'features/contracts/contract_milestones_screen.dart';
import 'features/knowledge/knowledge_base_screen.dart';
import 'features/reports/quick_reports_screen.dart';
import 'features/settings/settings_screen.dart';

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
      // Device trust heartbeat — report posture to server
      final heartbeat = DeviceHeartbeat(
        apiBaseUrl: ref.read(apiBaseProvider),
        auth: ref.read(authProvider),
      );
      // ignore: discarded_futures
      heartbeat.send();
    }
  }

  @override
  Widget build(BuildContext context) {
    final ref = this.ref;
    final router = GoRouter(
      initialLocation: '/splash',
      redirect: (context, state) async {
        final path = state.matchedLocation;

        // Splash screen handles its own transition
        if (path == '/splash') return null;

        // Check if user has a valid session (Gmail-style: token persists)
        final token = await ref.read(authProvider).accessToken();
        if (token == null && path != '/login') return '/login';
        if (token != null && path == '/login') return '/dashboard';
        return null;
      },
      routes: [
        GoRoute(
          path: '/splash',
          builder: (_, __) => _SplashRouter(auth: ref.read(authProvider)),
        ),
        GoRoute(
          path: '/onboarding',
          builder: (_, __) => const OnboardingScreen(),
        ),
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
            GoRoute(path: '/estab/files', builder: (_, __) => const EFileScreen()),
            GoRoute(path: '/mis', builder: (_, __) => const MisScreen()),
            GoRoute(path: '/assets/scan', builder: (_, __) => const AssetScanScreen()),
            GoRoute(path: '/contracts/milestones', builder: (_, __) => const ContractMilestonesScreen()),
            GoRoute(path: '/knowledge', builder: (_, __) => const KnowledgeBaseScreen()),
            GoRoute(path: '/reports', builder: (_, __) => const QuickReportsScreen()),
            GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
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
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en'),
        Locale('hi'),
      ],
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF6366F1),
        brightness: Brightness.light,
        extensions: const [AppColors.light],
        // Accessibility: larger default text for govt officers
        textTheme: const TextTheme(
          bodySmall: TextStyle(fontSize: 12),
          bodyMedium: TextStyle(fontSize: 14),
          bodyLarge: TextStyle(fontSize: 16),
          titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          labelSmall: TextStyle(fontSize: 12),
          labelMedium: TextStyle(fontSize: 13),
          labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF6366F1),
        brightness: Brightness.dark,
        extensions: const [AppColors.dark],
        textTheme: const TextTheme(
          bodySmall: TextStyle(fontSize: 12),
          bodyMedium: TextStyle(fontSize: 14),
          bodyLarge: TextStyle(fontSize: 16),
          titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          labelSmall: TextStyle(fontSize: 12),
          labelMedium: TextStyle(fontSize: 13),
          labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        ),
      ),
      themeMode: ThemeMode.system,
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
          SnackBar(content: Text('Sign-in failed: $e'), backgroundColor: Theme.of(context).colorScheme.error),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
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
                  color: theme.colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Icon(Icons.account_balance,
                    size: 36, color: theme.colorScheme.primary),
              ),
              const SizedBox(height: 24),
              Text('CivitasOne Suite',
                  style: theme
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(
                'Government · PSU · Enterprise',
                style: theme
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: theme.colorScheme.outline),
              ),
              const SizedBox(height: 8),
              Text('PKCE · device trust · offline sync',
                  style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
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

/// Dashboard — employee's home screen with quick actions + today's summary.
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Greeting
        Text(
          'Good ${_greeting()}',
          style: theme.textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 4),
        Text(
          'What would you like to do today?',
          style: theme.textTheme.bodyMedium
              ?.copyWith(color: theme.colorScheme.outline),
        ),
        const SizedBox(height: 20),

        // Quick actions grid
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 3,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 0.95,
          children: _quickActions.map((a) {
            return InkWell(
              onTap: () => context.go(a.route),
              borderRadius: BorderRadius.circular(12),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: a.color.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Icon(a.icon, color: a.color, size: 24),
                  ),
                  const SizedBox(height: 6),
                  Text(a.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: theme.colorScheme.onSurface)),
                ],
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 24),

        // Module cards
        Text('Modules',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        ..._modules.map((m) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                onTap: () => context.go(m.route),
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: m.color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(m.icon, color: m.color, size: 22),
                ),
                title: Text(m.label,
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                subtitle: Text(m.description,
                    style: TextStyle(
                        fontSize: 12, color: theme.colorScheme.outline)),
                trailing: Icon(Icons.chevron_right,
                    color: theme.colorScheme.outline),
              ),
            )),
      ],
    );
  }

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Morning';
    if (hour < 17) return 'Afternoon';
    return 'Evening';
  }

  static const _quickActions = [
    (label: 'Check In', icon: Icons.location_on, route: '/hr/geo-checkin', color: Color(0xFF22C55E)),
    (label: 'Leave', icon: Icons.event_note, route: '/hr/leave/apply', color: Color(0xFF6366F1)),
    (label: 'Payslip', icon: Icons.receipt_long, route: '/hr/payslips', color: Color(0xFFF59E0B)),
    (label: 'Approvals', icon: Icons.task_alt, route: '/hr/approvals', color: Color(0xFFEF4444)),
    (label: 'Holidays', icon: Icons.event, route: '/hr/holidays', color: Color(0xFF8B5CF6)),
    (label: 'Vacancies', icon: Icons.work, route: '/hr/vacancies', color: Color(0xFF06B6D4)),
    (label: 'Loans', icon: Icons.account_balance_wallet, route: '/hr/loans', color: Color(0xFFEC4899)),
    (label: 'Team', icon: Icons.people, route: '/hr/team', color: Color(0xFF10B981)),
  ];

  static const _modules = [
    (label: 'HR & Self-Service', icon: Icons.people, route: '/hr/dashboard', color: Color(0xFFF59E0B), description: 'Leave, attendance, payslip, profile'),
    (label: 'Finance', icon: Icons.account_balance, route: '/finance/payments', color: Color(0xFF22C55E), description: 'Payments, journals, vouchers'),
    (label: 'Procurement', icon: Icons.shopping_cart, route: '/procurement/indents', color: Color(0xFFEF4444), description: 'Indents, POs, approvals'),
    (label: 'CRM', icon: Icons.contacts, route: '/crm/contacts', color: Color(0xFF8B5CF6), description: 'Contacts, deals, pipeline'),
    (label: 'Helpdesk', icon: Icons.support_agent, route: '/helpdesk/tickets', color: Color(0xFF06B6D4), description: 'Tickets, SLA, support'),
    (label: 'Projects', icon: Icons.folder, route: '/projects', color: Color(0xFFEC4899), description: 'Tasks, milestones, resources'),
    (label: 'MIS Reports', icon: Icons.bar_chart, route: '/mis', color: Color(0xFF10B981), description: 'Analytics, dashboards'),
  ];
}

/// Splash → checks token → routes to dashboard or login.
/// Gmail-style: if refresh token exists, skip login, just show biometric lock.
class _SplashRouter extends StatefulWidget {
  const _SplashRouter({required this.auth});
  final PkceAuthService auth;

  @override
  State<_SplashRouter> createState() => _SplashRouterState();
}

class _SplashRouterState extends State<_SplashRouter> {
  @override
  void initState() {
    super.initState();
    _checkSession();
  }

  Future<void> _checkSession() async {
    // Give splash a minimum display time (brand impression)
    await Future.delayed(const Duration(milliseconds: 1200));

    if (!mounted) return;

    // First-time install → show onboarding
    final onboarded = await OnboardingScreen.hasCompleted();
    if (!onboarded) {
      context.go('/onboarding');
      return;
    }

    // Check for existing session (Gmail-style: persist login)
    final token = await widget.auth.accessToken();
    if (!mounted) return;

    if (token != null) {
      // User has valid session — go to dashboard
      context.go('/dashboard');
    } else {
      // No session — show login
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) => const SplashScreen();
}
