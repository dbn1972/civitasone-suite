import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Leave balance screen — shows leave type wise balance.
/// GET /v1/hrms/me/leave-balance
class LeaveBalanceScreen extends ConsumerStatefulWidget {
  const LeaveBalanceScreen({super.key});

  @override
  ConsumerState<LeaveBalanceScreen> createState() => _LeaveBalanceScreenState();
}

class _LeaveBalanceScreenState extends ConsumerState<LeaveBalanceScreen> {
  bool _loading = true;
  String? _error;
  List<_LeaveTypeBalance> _balances = [];

  @override
  void initState() {
    super.initState();
    _fetchBalance();
  }

  Future<void> _fetchBalance() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // GET /v1/hrms/me/leave-balance
      await Future.delayed(const Duration(milliseconds: 600));

      _balances = [
        _LeaveTypeBalance(
          type: 'CL',
          label: 'Casual Leave',
          used: 4,
          total: 12,
          icon: Icons.wb_sunny,
        ),
        _LeaveTypeBalance(
          type: 'EL',
          label: 'Earned Leave',
          used: 5,
          total: 30,
          icon: Icons.savings,
        ),
        _LeaveTypeBalance(
          type: 'ML',
          label: 'Medical Leave',
          used: 2,
          total: 10,
          icon: Icons.local_hospital,
        ),
        _LeaveTypeBalance(
          type: 'SL',
          label: 'Sick Leave',
          used: 6,
          total: 7,
          icon: Icons.healing,
        ),
        _LeaveTypeBalance(
          type: 'RH',
          label: 'Restricted Holiday',
          used: 2,
          total: 2,
          icon: Icons.event,
        ),
        _LeaveTypeBalance(
          type: 'CO',
          label: 'Compensatory Off',
          used: 0,
          total: 3,
          icon: Icons.star,
        ),
      ];
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Leave Balance'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchBalance,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : RefreshIndicator(
                  onRefresh: _fetchBalance,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Summary header
                      _buildSummaryHeader(theme),
                      const SizedBox(height: 20),

                      // Leave type cards
                      ..._balances.map((b) => _buildBalanceCard(theme, b)),
                    ],
                  ),
                ),
    );
  }

  Widget _buildSummaryHeader(ThemeData theme) {
    final totalUsed = _balances.fold<int>(0, (sum, b) => sum + b.used);
    final totalAvailable = _balances.fold<int>(0, (sum, b) => sum + b.total);
    final remaining = totalAvailable - totalUsed;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _SummaryItem(label: 'Total', value: '$totalAvailable', color: Colors.white),
          Container(width: 1, height: 40, color: Colors.white30),
          _SummaryItem(label: 'Used', value: '$totalUsed', color: Colors.white70),
          Container(width: 1, height: 40, color: Colors.white30),
          _SummaryItem(label: 'Remaining', value: '$remaining', color: Colors.white),
        ],
      ),
    );
  }

  Widget _buildBalanceCard(ThemeData theme, _LeaveTypeBalance balance) {
    final available = balance.total - balance.used;
    final percent = balance.total > 0 ? available / balance.total : 0.0;

    // Color coding: green if >50% available, orange if <25%, red if 0
    Color statusColor;
    if (available <= 0) {
      statusColor = const Color(0xFFEF4444); // Red
    } else if (percent < 0.25) {
      statusColor = const Color(0xFFF59E0B); // Orange
    } else {
      statusColor = const Color(0xFF22C55E); // Green
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: statusColor.withOpacity(0.2)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(balance.icon, color: statusColor, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        balance.label,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        balance.type,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.outline,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '$available',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: statusColor,
                      ),
                    ),
                    Text(
                      'of ${balance.total}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 12),
            // Progress bar
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: balance.total > 0 ? balance.used / balance.total : 0,
                backgroundColor: statusColor.withOpacity(0.1),
                valueColor: AlwaysStoppedAnimation(statusColor),
                minHeight: 6,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Used: ${balance.used}',
                  style: TextStyle(fontSize: 11, color: theme.colorScheme.outline),
                ),
                Text(
                  'Available: $available',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: statusColor,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
            const SizedBox(height: 16),
            Text('Unable to load leave balance', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchBalance,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _LeaveTypeBalance {
  final String type;
  final String label;
  final int used;
  final int total;
  final IconData icon;

  _LeaveTypeBalance({
    required this.type,
    required this.label,
    required this.used,
    required this.total,
    required this.icon,
  });
}

class _SummaryItem extends StatelessWidget {
  const _SummaryItem({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(fontSize: 12, color: color.withOpacity(0.8)),
        ),
      ],
    );
  }
}
