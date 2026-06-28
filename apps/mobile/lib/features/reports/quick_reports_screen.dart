import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Quick reports — on-the-go MIS dashboards for managers.
/// GET /v1/reports/summary
class QuickReportsScreen extends ConsumerStatefulWidget {
  const QuickReportsScreen({super.key});
  @override
  ConsumerState<QuickReportsScreen> createState() => _State();
}

class _State extends ConsumerState<QuickReportsScreen> {
  bool _loading = true;
  Map<String, dynamic> _summary = {};

  @override
  void initState() { super.initState(); _fetch(); }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/reports/summary');
      _summary = res.data ?? {};
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Quick Reports')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(onRefresh: _fetch, child: ListView(padding: const EdgeInsets.all(16), children: [
              // KPI Grid
              GridView.count(
                shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 2, mainAxisSpacing: 12, crossAxisSpacing: 12, childAspectRatio: 1.4,
                children: [
                  _KpiCard(icon: Icons.people, label: 'Headcount', value: '${_summary['headcount'] ?? '—'}', color: theme.colorScheme.primary),
                  _KpiCard(icon: Icons.trending_up, label: 'Attendance %', value: '${_summary['attendancePct'] ?? '—'}%', color: theme.colorScheme.tertiary),
                  _KpiCard(icon: Icons.pending_actions, label: 'Pending Leaves', value: '${_summary['pendingLeaves'] ?? '—'}', color: theme.colorScheme.error),
                  _KpiCard(icon: Icons.account_balance_wallet, label: 'Payroll (₹L)', value: '${((_summary['payrollTotal'] as num?) ?? 0) ~/ 10000000}', color: theme.colorScheme.secondary),
                  _KpiCard(icon: Icons.shopping_cart, label: 'Open POs', value: '${_summary['openPOs'] ?? '—'}', color: theme.colorScheme.primary),
                  _KpiCard(icon: Icons.support_agent, label: 'Open Tickets', value: '${_summary['openTickets'] ?? '—'}', color: theme.colorScheme.tertiary),
                ],
              ),
              const SizedBox(height: 24),

              // Quick links
              Text('Reports', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              ...[
                ('Attendance Summary', Icons.fingerprint, '/v1/reports/attendance'),
                ('Leave Utilization', Icons.event_note, '/v1/reports/leave'),
                ('Payroll Register', Icons.receipt_long, '/v1/reports/payroll'),
                ('Budget vs Actual', Icons.bar_chart, '/v1/reports/budget'),
                ('Procurement Status', Icons.shopping_cart, '/v1/reports/procurement'),
              ].map((r) => Card(margin: const EdgeInsets.only(bottom: 8), child: ListTile(
                leading: Icon(r.$2, color: theme.colorScheme.primary),
                title: Text(r.$1),
                trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
                onTap: () => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Loading ${r.$1}…'))),
              ))),
            ])),
    );
  }
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({required this.icon, required this.label, required this.value, required this.color});
  final IconData icon; final String label; final String value; final Color color;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: color.withOpacity(0.05),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: color.withOpacity(0.15)),
    ),
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Icon(icon, color: color, size: 24),
      const SizedBox(height: 8),
      Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
      Text(label, textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: color.withOpacity(0.8))),
    ]),
  );
}
