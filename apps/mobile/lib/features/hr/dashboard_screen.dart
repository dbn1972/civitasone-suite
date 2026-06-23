import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';

/// HR Dashboard for employee.
/// GET /v1/hrms/dashboard — shows KPI cards, quick actions, today's status.
class HrDashboardScreen extends ConsumerStatefulWidget {
  const HrDashboardScreen({super.key});

  @override
  ConsumerState<HrDashboardScreen> createState() => _HrDashboardScreenState();
}

class _HrDashboardScreenState extends ConsumerState<HrDashboardScreen> {
  bool _loading = true;
  String? _error;

  // KPI data
  int _headcount = 0;
  double _attendancePercent = 0;
  int _pendingLeaves = 0;
  String _todayStatus = 'absent'; // present, absent, on_leave

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
      // GET /v1/hrms/dashboard
      // Simulated API call
      await Future.delayed(const Duration(milliseconds: 700));

      setState(() {
        _headcount = 342;
        _attendancePercent = 91.5;
        _pendingLeaves = 7;
        _todayStatus = 'present';
      });
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('HR Dashboard'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
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
                      // Today's status
                      _buildTodayStatus(theme, colorScheme),
                      const SizedBox(height: 20),

                      // KPI Cards
                      Text('Key Metrics',
                          style: theme.textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 12),
                      _buildKpiGrid(theme),
                      const SizedBox(height: 24),

                      // Quick Actions
                      Text('Quick Actions',
                          style: theme.textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 12),
                      _buildQuickActions(theme, colorScheme),
                    ],
                  ),
                ),
    );
  }

  Widget _buildTodayStatus(ThemeData theme, ColorScheme colorScheme) {
    Color statusColor;
    IconData statusIcon;
    String statusLabel;

    switch (_todayStatus) {
      case 'present':
        statusColor = const Color(0xFF22C55E);
        statusIcon = Icons.check_circle;
        statusLabel = 'Present';
        break;
      case 'on_leave':
        statusColor = const Color(0xFFF59E0B);
        statusIcon = Icons.beach_access;
        statusLabel = 'On Leave';
        break;
      default:
        statusColor = const Color(0xFFEF4444);
        statusIcon = Icons.cancel;
        statusLabel = 'Absent';
    }

    return Card(
      color: statusColor.withOpacity(0.05),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: statusColor.withOpacity(0.2)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: statusColor.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(statusIcon, color: statusColor, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Today's Status",
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.outline,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    statusLabel,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: statusColor,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              _formattedDate(),
              style: theme.textTheme.bodySmall?.copyWith(
                color: colorScheme.outline,
              ),
            ),
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
    return '${now.day} ${months[now.month - 1]} ${now.year}';
  }

  Widget _buildKpiGrid(ThemeData theme) {
    return Row(
      children: [
        Expanded(
          child: _KpiCard(
            title: 'Headcount',
            value: '$_headcount',
            icon: Icons.people,
            color: const Color(0xFF6366F1),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _KpiCard(
            title: 'Attendance',
            value: '${_attendancePercent.toStringAsFixed(1)}%',
            icon: Icons.trending_up,
            color: const Color(0xFF22C55E),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _KpiCard(
            title: 'Pending\nLeaves',
            value: '$_pendingLeaves',
            icon: Icons.pending_actions,
            color: const Color(0xFFF59E0B),
          ),
        ),
      ],
    );
  }

  Widget _buildQuickActions(ThemeData theme, ColorScheme colorScheme) {
    final actions = [
      (
        label: 'Apply Leave',
        icon: Icons.event_note,
        color: const Color(0xFF6366F1),
        route: '/hr/leave/apply',
      ),
      (
        label: 'Mark Attendance',
        icon: Icons.location_on,
        color: const Color(0xFF22C55E),
        route: '/hr/geo-checkin',
      ),
      (
        label: 'View Payslip',
        icon: Icons.receipt_long,
        color: const Color(0xFFF59E0B),
        route: '/hr/payslips',
      ),
    ];

    return Column(
      children: actions.map((a) {
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ListTile(
            onTap: () => context.push(a.route),
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: a.color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(a.icon, color: a.color),
            ),
            title: Text(a.label, style: const TextStyle(fontWeight: FontWeight.w500)),
            trailing: const Icon(Icons.chevron_right, color: Color(0xFF94A3B8)),
          ),
        );
      }).toList(),
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
            Text('Unable to load dashboard', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchDashboard,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  final String title;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            title,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 11,
              color: color.withOpacity(0.8),
            ),
          ),
        ],
      ),
    );
  }
}
