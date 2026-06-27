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
  bool _fromCache = false;

  // KPI data
  int _headcount = 0;
  double _attendancePercent = 0;
  int _pendingLeaves = 0;
  String _todayStatus = 'absent'; // present, absent, on_leave

  /// Cache mailbox key used for offline-first storage.
  static const _cacheMailbox = 'hr_dashboard';
  static const _cacheEntityId = 'hr_dashboard_singleton';

  @override
  void initState() {
    super.initState();
    _fetchDashboard();
  }

  Future<void> _fetchDashboard() async {
    setState(() {
      _loading = true;
      _error = null;
      _fromCache = false;
    });

    try {
      final apiClient = ref.read(apiClientProvider);

      // ── 1. Fetch main dashboard KPIs ─────────────────────────────────────
      final dashRes = await apiClient.get<Map<String, dynamic>>(
        '/v1/hrms/dashboard',
      );
      final dash = dashRes.data!;

      // ── 2. Fetch today's attendance status ────────────────────────────────
      final now = DateTime.now();
      final month =
          '${now.year}-${now.month.toString().padLeft(2, '0')}';
      String todayStatus = 'absent';
      try {
        final attendanceRes = await apiClient.get<Map<String, dynamic>>(
          '/v1/hrms/attendance',
          params: {'month': month},
        );
        final records =
            (attendanceRes.data?['records'] as List<dynamic>?) ?? [];
        final todayStr =
            '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
        for (final rec in records) {
          if ((rec as Map<String, dynamic>)['date'] == todayStr) {
            todayStatus = (rec['status'] as String?) ?? 'absent';
            break;
          }
        }
      } catch (_) {
        // Attendance fetch is non-fatal; keep 'absent' as default.
      }

      final dashData = {
        'headcount': dash['headcount'] as int? ?? 0,
        'attendanceTodayPct':
            (dash['attendanceTodayPct'] as num?)?.toDouble() ?? 0.0,
        'pendingLeaves': dash['pendingLeaves'] as int? ?? 0,
        'todayStatus': todayStatus,
      };

      // ── 3. Cache to local DB ──────────────────────────────────────────────
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        await db.upsertEntity(
          id: _cacheEntityId,
          mailbox: _cacheMailbox,
          data: dashData,
          updatedAt: DateTime.now().toUtc().toIso8601String(),
        );
      }

      if (mounted) {
        setState(() {
          _headcount = dashData['headcount'] as int;
          _attendancePercent = dashData['attendanceTodayPct'] as double;
          _pendingLeaves = dashData['pendingLeaves'] as int;
          _todayStatus = dashData['todayStatus'] as String;
        });
      }
    } catch (e) {
      // ── 4. Fall back to cached data when offline / error ─────────────────
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities(_cacheMailbox);
        if (cached.isNotEmpty) {
          final data =
              cached.first['data'] as Map<String, dynamic>;
          if (mounted) {
            setState(() {
              _headcount = data['headcount'] as int? ?? 0;
              _attendancePercent =
                  (data['attendanceTodayPct'] as num?)?.toDouble() ?? 0.0;
              _pendingLeaves = data['pendingLeaves'] as int? ?? 0;
              _todayStatus = data['todayStatus'] as String? ?? 'absent';
              _fromCache = true;
              _error = null; // suppress error banner; show cache banner instead
            });
            return;
          }
        }
      }
      if (mounted) setState(() => _error = e.toString());
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
                      // Cached data indicator
                      if (_fromCache)
                        _buildCacheBanner(theme, colorScheme),
                      if (_fromCache) const SizedBox(height: 12),

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

  Widget _buildCacheBanner(ThemeData theme, ColorScheme colorScheme) {
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
