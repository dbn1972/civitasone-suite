import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Employee loan & advance status screen.
/// GET /v1/hrms/me/loans — active loans with EMI schedule
/// GET /v1/hrms/me/advances — salary advances with repayment status
class LoanStatusScreen extends ConsumerStatefulWidget {
  const LoanStatusScreen({super.key});

  @override
  ConsumerState<LoanStatusScreen> createState() => _LoanStatusScreenState();
}

class _LoanStatusScreenState extends ConsumerState<LoanStatusScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _loans = [];
  List<Map<String, dynamic>> _advances = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _fetchData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);

      // Fetch loans
      final loansRes =
          await apiClient.get<Map<String, dynamic>>('/v1/hrms/me/loans');
      _loans = ((loansRes.data?['data'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();

      // Fetch advances
      final advRes = await apiClient
          .get<Map<String, dynamic>>('/v1/hrms/me/advances');
      _advances = ((advRes.data?['data'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _fmt(num paise) => '₹${(paise / 100).toStringAsFixed(0)}';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Loans & Advances'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchData,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Loans'),
            Tab(text: 'Advances'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError()
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildLoansList(),
                    _buildAdvancesList(),
                  ],
                ),
    );
  }

  Widget _buildLoansList() {
    final theme = Theme.of(context);

    if (_loans.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.account_balance_wallet,
                size: 64, color: theme.colorScheme.outlineVariant),
            const SizedBox(height: 16),
            Text('No active loans', style: theme.textTheme.bodyLarge),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchData,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Total outstanding summary
          _buildLoanSummary(theme),
          const SizedBox(height: 16),
          ..._loans.map((loan) => _buildLoanCard(theme, loan)),
        ],
      ),
    );
  }

  Widget _buildLoanSummary(ThemeData theme) {
    final totalSanctioned = _loans.fold<num>(
        0, (sum, l) => sum + ((l['sanctionedAmount'] as num?) ?? 0));
    final totalOutstanding = _loans.fold<num>(
        0, (sum, l) => sum + ((l['outstandingAmount'] as num?) ?? 0));
    final totalPaid = totalSanctioned - totalOutstanding;
    final percent =
        totalSanctioned > 0 ? totalPaid / totalSanctioned : 0.0;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Total Outstanding',
                      style: TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(height: 4),
                  Text(_fmt(totalOutstanding),
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.bold)),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Sanctioned',
                      style: TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(height: 4),
                  Text(_fmt(totalSanctioned),
                      style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 16,
                          fontWeight: FontWeight.w500)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Progress bar
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: percent,
              backgroundColor: Colors.white24,
              valueColor:
                  const AlwaysStoppedAnimation(Color(0xFF22C55E)),
              minHeight: 8,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Paid: ${_fmt(totalPaid)}',
                  style: const TextStyle(
                      color: Colors.white70, fontSize: 11)),
              Text('${(percent * 100).toStringAsFixed(0)}% repaid',
                  style: const TextStyle(
                      color: Colors.white, fontSize: 11,
                      fontWeight: FontWeight.w600)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLoanCard(ThemeData theme, Map<String, dynamic> loan) {
    final loanType = loan['loanType'] as String? ?? 'Unknown';
    final sanctioned = (loan['sanctionedAmount'] as num?) ?? 0;
    final outstanding = (loan['outstandingAmount'] as num?) ?? 0;
    final emiAmount = (loan['emiAmount'] as num?) ?? 0;
    final paidEmis = (loan['paidInstallments'] as num?) ?? 0;
    final totalEmis = (loan['totalInstallments'] as num?) ?? 0;
    final nextEmiDate = loan['nextEmiDate'] as String? ?? '—';
    final status = loan['status'] as String? ?? 'active';

    Color statusColor;
    switch (status) {
      case 'active':
        statusColor = const Color(0xFF22C55E);
        break;
      case 'closed':
        statusColor = const Color(0xFF64748B);
        break;
      default:
        statusColor = const Color(0xFFF59E0B);
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF6366F1).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(_loanIcon(loanType),
                      color: const Color(0xFF6366F1), size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_loanLabel(loanType),
                          style: theme.textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w600)),
                      Text('EMI: ${_fmt(emiAmount)}/month',
                          style: theme.textTheme.bodySmall
                              ?.copyWith(color: theme.colorScheme.outline)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(status.toUpperCase(),
                      style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: statusColor)),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Progress
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Outstanding: ${_fmt(outstanding)}',
                    style: const TextStyle(fontSize: 12)),
                Text('$paidEmis / $totalEmis EMIs',
                    style: TextStyle(
                        fontSize: 12, color: theme.colorScheme.outline)),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: totalEmis > 0 ? paidEmis / totalEmis : 0,
                backgroundColor:
                    const Color(0xFF6366F1).withOpacity(0.1),
                valueColor:
                    const AlwaysStoppedAnimation(Color(0xFF6366F1)),
                minHeight: 6,
              ),
            ),
            const SizedBox(height: 8),

            // Next EMI
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.calendar_today, size: 12,
                      color: theme.colorScheme.outline),
                  const SizedBox(width: 6),
                  Text('Next EMI: $nextEmiDate',
                      style: TextStyle(
                          fontSize: 11,
                          color: theme.colorScheme.outline)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAdvancesList() {
    final theme = Theme.of(context);

    if (_advances.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.money_off,
                size: 64, color: theme.colorScheme.outlineVariant),
            const SizedBox(height: 16),
            Text('No active advances', style: theme.textTheme.bodyLarge),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _advances.length,
      itemBuilder: (ctx, i) {
        final adv = _advances[i];
        final amount = (adv['amount'] as num?) ?? 0;
        final repaid = (adv['repaidAmount'] as num?) ?? 0;
        final status = adv['status'] as String? ?? 'active';

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: const Color(0xFFF59E0B).withOpacity(0.1),
              child: const Icon(Icons.payments,
                  color: Color(0xFFF59E0B)),
            ),
            title: Text(
                'Advance: ${_fmt(amount)}',
                style: const TextStyle(fontWeight: FontWeight.w500)),
            subtitle: Text(
              'Repaid: ${_fmt(repaid)} • Status: $status',
              style: TextStyle(
                  fontSize: 12, color: theme.colorScheme.outline),
            ),
            trailing: CircularProgressIndicator(
              value: amount > 0 ? repaid / amount : 0,
              strokeWidth: 3,
              backgroundColor:
                  const Color(0xFFF59E0B).withOpacity(0.1),
              valueColor:
                  const AlwaysStoppedAnimation(Color(0xFFF59E0B)),
            ),
          ),
        );
      },
    );
  }

  Widget _buildError() {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load data', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchData,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  IconData _loanIcon(String type) {
    switch (type.toLowerCase()) {
      case 'hba':
        return Icons.home;
      case 'motor_car':
        return Icons.directions_car;
      case 'computer':
        return Icons.laptop;
      case 'festival':
        return Icons.celebration;
      case 'medical':
        return Icons.local_hospital;
      default:
        return Icons.account_balance_wallet;
    }
  }

  String _loanLabel(String type) {
    switch (type.toLowerCase()) {
      case 'hba':
        return 'House Building Advance';
      case 'motor_car':
        return 'Motor Car Advance';
      case 'computer':
        return 'Computer Advance';
      case 'festival':
        return 'Festival Advance';
      case 'medical':
        return 'Medical Advance';
      case 'personal':
        return 'Personal Loan';
      default:
        return type;
    }
  }
}
