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
  bool _fromCache = false;
  List<_LeaveTypeBalance> _balances = [];

  /// Cache mailbox key used for offline-first storage.
  static const _cacheMailbox = 'leave_balance';
  static const _cacheEntityId = 'leave_balance_singleton';

  @override
  void initState() {
    super.initState();
    _fetchBalance();
  }

  Future<void> _fetchBalance() async {
    setState(() {
      _loading = true;
      _error = null;
      _fromCache = false;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>(
        '/v1/hrms/leave-allocations',
      );
      final data = (res.data?['data'] as List<dynamic>?) ?? [];

      _balances = data.map((item) {
        final map = item as Map<String, dynamic>;
        final totalDays = (map['totalDays'] as num?)?.toInt() ?? 0;
        final balanceDays = (map['balanceDays'] as num?)?.toInt() ?? 0;
        final used = totalDays - balanceDays;
        final code = (map['leaveTypeCode'] as String?) ?? '';
        return _LeaveTypeBalance(
          type: code,
          label: (map['leaveTypeName'] as String?) ?? code,
          used: used,
          total: totalDays,
          icon: _iconForLeaveType(code),
        );
      }).toList();

      // Cache to local DB for offline-first access.
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        await db.upsertEntity(
          id: _cacheEntityId,
          mailbox: _cacheMailbox,
          data: {
            'balances': data,
          },
          updatedAt: DateTime.now().toUtc().toIso8601String(),
        );
      }
    } catch (e) {
      // Fall back to cached data when offline / error.
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities(_cacheMailbox);
        if (cached.isNotEmpty) {
          final cachedData = cached.first['data'] as Map<String, dynamic>;
          final items = (cachedData['balances'] as List<dynamic>?) ?? [];
          _balances = items.map((item) {
            final map = item as Map<String, dynamic>;
            final totalDays = (map['totalDays'] as num?)?.toInt() ?? 0;
            final balanceDays = (map['balanceDays'] as num?)?.toInt() ?? 0;
            final used = totalDays - balanceDays;
            final code = (map['leaveTypeCode'] as String?) ?? '';
            return _LeaveTypeBalance(
              type: code,
              label: (map['leaveTypeName'] as String?) ?? code,
              used: used,
              total: totalDays,
              icon: _iconForLeaveType(code),
            );
          }).toList();
          if (mounted) {
            setState(() {
              _fromCache = true;
              _error = null;
            });
          }
          return;
        }
      }
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Map leave type codes to icons.
  static IconData _iconForLeaveType(String code) {
    switch (code.toUpperCase()) {
      case 'CL':
        return Icons.wb_sunny;
      case 'EL':
        return Icons.savings;
      case 'ML':
        return Icons.local_hospital;
      case 'SL':
        return Icons.healing;
      case 'RH':
        return Icons.event;
      case 'CO':
        return Icons.star;
      default:
        return Icons.calendar_today;
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
                      // Cached data indicator
                      if (_fromCache) _buildCacheBanner(theme),
                      if (_fromCache) const SizedBox(height: 12),

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

  Widget _buildCacheBanner(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF59E0B).withOpacity(0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.wifi_off, size: 16, color: Color(0xFFF59E0B)),
          const SizedBox(width: 8),
          Text(
            'Showing cached data',
            style: theme.textTheme.bodySmall?.copyWith(
              color: const Color(0xFFF59E0B),
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
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
