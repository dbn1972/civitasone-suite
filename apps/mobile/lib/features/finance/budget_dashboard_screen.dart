import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Budget Utilization Dashboard for collectors / finance officers.
/// GET /v1/finance/budget/dashboard → { allocated, committed, actual, available }
/// GET /v1/finance/budget/heads?sort=utilization&limit=10 → top heads
class BudgetDashboardScreen extends ConsumerStatefulWidget {
  const BudgetDashboardScreen({super.key});

  @override
  ConsumerState<BudgetDashboardScreen> createState() =>
      _BudgetDashboardScreenState();
}

class _BudgetDashboardScreenState extends ConsumerState<BudgetDashboardScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _heads = [];

  @override
  void initState() {
    super.initState();
    _fetchDashboard();
  }

  Future<void> _fetchDashboard() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final [summaryRes, headsRes] = await Future.wait([
        api.get<Map<String, dynamic>>('/v1/finance/budget/dashboard'),
        api.get<Map<String, dynamic>>(
          '/v1/finance/budget/heads',
          params: {'sort': 'utilization', 'limit': 10},
        ),
      ]);
      _summary = summaryRes.data?['data'] as Map<String, dynamic>? ?? {};
      final headsData = headsRes.data?['data'] as List<dynamic>? ?? [];
      _heads = headsData.cast<Map<String, dynamic>>();
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Format paise amount as ₹ in crores/lakhs for readability.
  String _formatCroresLakhs(dynamic amountMinor) {
    if (amountMinor == null) return '₹0';
    final paise = amountMinor is int ? amountMinor : (amountMinor as num).toInt();
    final rupees = paise / 100;

    if (rupees >= 10000000) {
      return '₹${(rupees / 10000000).toStringAsFixed(2)} Cr';
    } else if (rupees >= 100000) {
      return '₹${(rupees / 100000).toStringAsFixed(2)} L';
    } else if (rupees >= 1000) {
      return '₹${(rupees / 1000).toStringAsFixed(1)}K';
    }
    return '₹${rupees.toStringAsFixed(0)}';
  }

  double _utilizationPercent() {
    final allocated = (_summary['allocated'] as num?)?.toDouble() ?? 0;
    final actual = (_summary['actual'] as num?)?.toDouble() ?? 0;
    if (allocated == 0) return 0;
    return (actual / allocated * 100).clamp(0, 100);
  }

  Color _utilizationColor(double percent) {
    if (percent < 60) return const Color(0xFF22C55E); // green
    if (percent < 80) return const Color(0xFFF59E0B); // yellow
    return const Color(0xFFEF4444); // red
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Budget Dashboard'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _fetchDashboard,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : RefreshIndicator(
                  onRefresh: _fetchDashboard,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Stat cards
                      _buildStatCards(theme),
                      const SizedBox(height: 20),
                      // Utilization bar
                      _buildUtilizationBar(theme),
                      const SizedBox(height: 24),
                      // Top heads
                      Text('Top Heads by Utilization',
                          style: theme.textTheme.titleSmall),
                      const SizedBox(height: 12),
                      ..._heads.map((h) => _HeadTile(
                            head: h,
                            formatAmount: _formatCroresLakhs,
                          )),
                      if (_heads.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: Center(
                            child: Text(
                              'No budget heads data available',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.outline,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildStatCards(ThemeData theme) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.6,
      children: [
        _StatCard(
          label: 'Allocated',
          value: _formatCroresLakhs(_summary['allocated']),
          icon: Icons.account_balance_wallet,
          color: const Color(0xFF3B82F6),
        ),
        _StatCard(
          label: 'Committed',
          value: _formatCroresLakhs(_summary['committed']),
          icon: Icons.handshake,
          color: const Color(0xFF8B5CF6),
        ),
        _StatCard(
          label: 'Spent',
          value: _formatCroresLakhs(_summary['actual']),
          icon: Icons.payments,
          color: const Color(0xFFF59E0B),
        ),
        _StatCard(
          label: 'Available',
          value: _formatCroresLakhs(_summary['available']),
          icon: Icons.savings,
          color: const Color(0xFF22C55E),
        ),
      ],
    );
  }

  Widget _buildUtilizationBar(ThemeData theme) {
    final percent = _utilizationPercent();
    final color = _utilizationColor(percent);

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Overall Utilization', style: theme.textTheme.titleSmall),
                Text(
                  '${percent.toStringAsFixed(1)}%',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: percent / 100,
                minHeight: 12,
                backgroundColor: theme.colorScheme.surfaceContainerHigh,
                valueColor: AlwaysStoppedAnimation(color),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Spent / Allocated',
                    style: TextStyle(fontSize: 11, color: theme.colorScheme.outline)),
                Row(
                  children: [
                    _legendDot(const Color(0xFF22C55E)),
                    const Text(' <60%  ', style: TextStyle(fontSize: 10)),
                    _legendDot(const Color(0xFFF59E0B)),
                    const Text(' 60-80%  ', style: TextStyle(fontSize: 10)),
                    _legendDot(const Color(0xFFEF4444)),
                    const Text(' >80%', style: TextStyle(fontSize: 10)),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _legendDot(Color color) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load budget data', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchDashboard,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, color: color, size: 18),
                ),
                const Spacer(),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.onSurface,
              ),
            ),
            Text(
              label,
              style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeadTile extends StatelessWidget {
  const _HeadTile({required this.head, required this.formatAmount});

  final Map<String, dynamic> head;
  final String Function(dynamic) formatAmount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = head['name'] as String? ?? 'Unknown Head';
    final allocated = head['allocated'];
    final spent = head['actual'] ?? head['spent'];
    final allocatedNum = (allocated as num?)?.toDouble() ?? 0;
    final spentNum = (spent as num?)?.toDouble() ?? 0;
    final utilization = allocatedNum > 0 ? (spentNum / allocatedNum) : 0.0;
    final percent = (utilization * 100).clamp(0, 100).toDouble();

    Color barColor;
    if (percent < 60) {
      barColor = const Color(0xFF22C55E);
    } else if (percent < 80) {
      barColor = const Color(0xFFF59E0B);
    } else {
      barColor = const Color(0xFFEF4444);
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    name,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  '${percent.toStringAsFixed(0)}%',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: barColor,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: utilization.clamp(0, 1).toDouble(),
                minHeight: 6,
                backgroundColor: theme.colorScheme.surfaceContainerHigh,
                valueColor: AlwaysStoppedAnimation(barColor),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Allocated: ${formatAmount(allocated)}',
                  style: TextStyle(fontSize: 11, color: theme.colorScheme.outline),
                ),
                Text(
                  'Spent: ${formatAmount(spent)}',
                  style: TextStyle(fontSize: 11, color: theme.colorScheme.outline),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
