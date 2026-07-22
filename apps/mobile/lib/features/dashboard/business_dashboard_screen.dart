import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../../core/providers.dart';

// Fix: [AUDIT-P3-10] Pre-compute color constants instead of withOpacity in build methods
final _invoiceIconBg = Colors.blue.withOpacity(0.1);
final _paymentIconBg = Colors.green.withOpacity(0.1);

/// Daily business dashboard. Zero clutter. One-thumb operation.
/// Gradient header with date, 3 stat cards, quick actions, recent activity.
class BusinessDashboardScreen extends ConsumerStatefulWidget {
  const BusinessDashboardScreen({super.key, this.connectivityOverride});

  /// For testing: override connectivity check. Null means use real check.
  final bool? connectivityOverride;

  @override
  ConsumerState<BusinessDashboardScreen> createState() =>
      _BusinessDashboardScreenState();
}

class _BusinessDashboardScreenState
    extends ConsumerState<BusinessDashboardScreen> {
  bool _isOffline = false;
  int _todaySales = 0;
  int _todayExpenses = 0;
  int _receivables = 0;
  List<Map<String, dynamic>> _recentActivity = [];
  bool _loading = true;

  bool _dataLoaded = false;

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
  }

  Future<void> _checkConnectivity() async {
    final override = widget.connectivityOverride;
    if (override != null) {
      if (mounted) setState(() => _isOffline = !override);
      return;
    }
    try {
      final result = await Connectivity().checkConnectivity();
      if (mounted) {
        setState(() {
          _isOffline =
              result.isEmpty || result.first == ConnectivityResult.none;
        });
      }
    } catch (_) {
      // Connectivity plugin unavailable (e.g. in tests)
      if (mounted) setState(() => _isOffline = false);
    }
  }

  Future<void> _loadData() async {
    final db = ref.read(dbProvider).valueOrNull;
    if (db == null) return;

    // Sync all relevant mailboxes
    final engine = ref.read(syncEngineProvider);
    if (engine != null) {
      await Future.wait([
        engine.syncMailbox('invoices'),
        engine.syncMailbox('biz_payments'),
        engine.syncMailbox('expenses'),
      ]);
    }

    final now = DateTime.now();
    final todayStr =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

    // Calculate today's sales from invoices
    final invoices = await db.listEntities('invoices');
    int sales = 0;
    int receivables = 0;
    for (final inv in invoices) {
      final data = inv['data'] as Map<String, dynamic>;
      final total = data['total'] as int? ?? 0;
      final status = data['status'] as String? ?? 'unpaid';
      final createdAt = data['createdAt'] as String? ?? '';
      if (createdAt.startsWith(todayStr)) {
        sales += total;
      }
      if (status == 'unpaid' || status == 'partial') {
        receivables += total;
      }
    }

    // Calculate today's expenses
    final expenses = await db.listEntities('expenses');
    int expenseTotal = 0;
    for (final exp in expenses) {
      final data = exp['data'] as Map<String, dynamic>;
      final createdAt = data['createdAt'] as String? ?? '';
      if (createdAt.startsWith(todayStr)) {
        expenseTotal += data['amountMinor'] as int? ?? 0;
      }
    }

    // Recent activity: combine invoices + payments, sort by time
    final payments = await db.listEntities('biz_payments');
    final activity = <Map<String, dynamic>>[];
    for (final inv in invoices.take(5)) {
      final data = inv['data'] as Map<String, dynamic>;
      activity.add({
        'type': 'invoice',
        'title': 'Invoice ${data['invoiceNo'] ?? ''}',
        'subtitle': data['customerName'] ?? '',
        'amount': data['total'] ?? 0,
        'createdAt': data['createdAt'] ?? '',
      });
    }
    for (final pay in payments.take(5)) {
      final data = pay['data'] as Map<String, dynamic>;
      activity.add({
        'type': 'payment',
        'title': 'Payment received',
        'subtitle': data['customerName'] ?? '',
        'amount': data['amountMinor'] ?? 0,
        'createdAt': data['createdAt'] ?? '',
      });
    }
    activity.sort((a, b) =>
        (b['createdAt'] as String).compareTo(a['createdAt'] as String));

    if (mounted) {
      setState(() {
        _todaySales = sales;
        _todayExpenses = expenseTotal;
        _receivables = receivables;
        _recentActivity = activity.take(5).toList();
        _loading = false;
      });
    }
  }

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    if (rupees >= 100000) {
      return '₹${(rupees / 100000).toStringAsFixed(1)}L';
    }
    if (rupees >= 1000) {
      return '₹${(rupees / 1000).toStringAsFixed(1)}K';
    }
    return '₹${rupees.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Watch the dbProvider so we know when it resolves. Trigger data load.
    final dbAsync = ref.watch(dbProvider);
    if (dbAsync.hasValue && !_dataLoaded) {
      _dataLoaded = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadData());
    }

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          await _checkConnectivity();
          await _loadData();
        },
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            // Offline banner
            if (_isOffline)
              Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                color: Colors.orange.shade100,
                child: Row(
                  children: [
                    Icon(Icons.cloud_off,
                        size: 16, color: Colors.orange.shade800),
                    const SizedBox(width: 8),
                    Text(
                      'Offline — changes will sync when connected',
                      style: TextStyle(
                          fontSize: 12, color: Colors.orange.shade800),
                    ),
                  ],
                ),
              ),

            // Gradient header
            Container(
              padding: EdgeInsets.fromLTRB(
                  20, MediaQuery.of(context).padding.top + 20, 20, 20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    theme.colorScheme.primary,
                    theme.colorScheme.primary.withOpacity(0.8),
                  ],
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Today',
                    style: TextStyle(
                      color: Colors.white.withOpacity(0.8),
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    _formattedDate(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),

            // Stat cards
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(
                    child: _StatCard(
                      label: 'Sales',
                      value: _formatAmount(_todaySales),
                      icon: Icons.trending_up,
                      color: Colors.green,
                      loading: _loading,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _StatCard(
                      label: 'Expenses',
                      value: _formatAmount(_todayExpenses),
                      icon: Icons.trending_down,
                      color: Colors.red,
                      loading: _loading,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _StatCard(
                      label: 'Receivables',
                      value: _formatAmount(_receivables),
                      icon: Icons.account_balance_wallet,
                      color: Colors.orange,
                      loading: _loading,
                    ),
                  ),
                ],
              ),
            ),

            // Quick Actions
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text('Quick Actions',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _QuickAction(
                    icon: Icons.receipt_long,
                    label: 'Invoice',
                    color: const Color(0xFF6366F1),
                    onTap: () => context.go('/biz/invoices/new'),
                  ),
                  _QuickAction(
                    icon: Icons.payments,
                    label: 'Payment',
                    color: const Color(0xFF22C55E),
                    onTap: () => context.go('/biz/payments/new'),
                  ),
                  _QuickAction(
                    icon: Icons.receipt,
                    label: 'Expense',
                    color: const Color(0xFFF59E0B),
                    onTap: () => context.go('/biz/expenses/new'),
                  ),
                  _QuickAction(
                    icon: Icons.people,
                    label: 'Customers',
                    color: const Color(0xFF8B5CF6),
                    onTap: () => context.go('/biz/customers'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Recent Activity
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text('Recent Activity',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 8),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_recentActivity.isEmpty)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Center(
                  child: Text('No activity yet',
                      style: TextStyle(color: theme.colorScheme.outline)),
                ),
              )
            else
              ...(_recentActivity.map((item) => Card(
                    margin:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 16,
                            // Fix: [AUDIT-P3-10] Use pre-computed color constants
                            backgroundColor: item['type'] == 'invoice'
                                ? _invoiceIconBg
                                : _paymentIconBg,
                            child: Icon(
                              item['type'] == 'invoice'
                                  ? Icons.receipt_long
                                  : Icons.payments,
                              size: 16,
                              color: item['type'] == 'invoice'
                                  ? Colors.blue
                                  : Colors.green,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(item['title'] as String,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w500,
                                        fontSize: 13)),
                                Text(item['subtitle'] as String,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: theme.colorScheme.outline,
                                    )),
                              ],
                            ),
                          ),
                          Text(
                            _formatAmount(item['amount'] as int),
                            style: const TextStyle(
                                fontWeight: FontWeight.w600, fontSize: 14),
                          ),
                        ],
                      ),
                    ),
                  ))),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  String _formattedDate() {
    final now = DateTime.now();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return '${days[now.weekday - 1]}, ${now.day} ${months[now.month - 1]} ${now.year}';
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    required this.loading,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    // Fix: [AUDIT-P2-5] Semantics for screen readers
    return Semantics(
      label: '$label: $value',
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(height: 8),
              loading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      value,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.bold),
                    ),
              const SizedBox(height: 2),
              Text(label,
                  style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context).colorScheme.outline)),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  // Fix: [AUDIT-P3-10] Cache computed color to avoid allocation in build
  Color get _bgColor => color.withOpacity(0.1);

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 26,
              backgroundColor: _bgColor,
              child: Icon(icon, color: color, size: 24),
            ),
            const SizedBox(height: 6),
            Text(label,
                style:
                    const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}
