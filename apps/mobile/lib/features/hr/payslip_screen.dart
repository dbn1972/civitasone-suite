import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Payslip listing and detail view.
/// GET /v1/payroll/salary-slips — list all slips
/// GET /v1/payroll/slips/:id/pdf — HTML salary slip detail
class PayslipScreen extends ConsumerStatefulWidget {
  const PayslipScreen({super.key});

  @override
  ConsumerState<PayslipScreen> createState() => _PayslipScreenState();
}

class _PayslipScreenState extends ConsumerState<PayslipScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _slips = [];

  @override
  void initState() {
    super.initState();
    _fetchSlips();
  }

  Future<void> _fetchSlips() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // GET /v1/payroll/salary-slips via SyncEngine/Dio
      // Simulated data for offline-first demo
      await Future.delayed(const Duration(milliseconds: 800));
      _slips = [
        {
          'id': 'slip-2024-12',
          'month': 'December 2024',
          'gross': 85000.0,
          'deductions': 12750.0,
          'netPay': 72250.0,
          'pf': 5100.0,
          'esi': 1487.0,
          'tds': 6163.0,
        },
        {
          'id': 'slip-2024-11',
          'month': 'November 2024',
          'gross': 85000.0,
          'deductions': 12750.0,
          'netPay': 72250.0,
          'pf': 5100.0,
          'esi': 1487.0,
          'tds': 6163.0,
        },
        {
          'id': 'slip-2024-10',
          'month': 'October 2024',
          'gross': 82000.0,
          'deductions': 12300.0,
          'netPay': 69700.0,
          'pf': 4920.0,
          'esi': 1435.0,
          'tds': 5945.0,
        },
      ];
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatCurrency(double amount) {
    return '₹${amount.toStringAsFixed(0).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{3})+$)'),
          (m) => '${m[1]},',
        )}';
  }

  void _openSlipDetail(Map<String, dynamic> slip) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _PayslipDetailScreen(slip: slip),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Payslips'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchSlips,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : _slips.isEmpty
                  ? _buildEmpty(theme)
                  : RefreshIndicator(
                      onRefresh: _fetchSlips,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _slips.length,
                        itemBuilder: (ctx, i) => _buildSlipCard(theme, _slips[i]),
                      ),
                    ),
    );
  }

  Widget _buildSlipCard(ThemeData theme, Map<String, dynamic> slip) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: () => _openSlipDetail(slip),
        borderRadius: BorderRadius.circular(12),
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
                    child: const Icon(Icons.receipt_long, color: Color(0xFF6366F1)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          slip['month'] as String,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          'Net Pay: ${_formatCurrency(slip['netPay'] as double)}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: const Color(0xFF22C55E),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Color(0xFF94A3B8)),
                ],
              ),
              const SizedBox(height: 12),
              const Divider(height: 1),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _SlipMini(label: 'Gross', value: _formatCurrency(slip['gross'] as double)),
                  _SlipMini(label: 'Deductions', value: _formatCurrency(slip['deductions'] as double)),
                  _SlipMini(label: 'PF', value: _formatCurrency(slip['pf'] as double)),
                  _SlipMini(label: 'TDS', value: _formatCurrency(slip['tds'] as double)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.receipt_long, size: 64, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No payslips available', style: theme.textTheme.bodyLarge),
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
            Text('Failed to load payslips', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchSlips,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlipMini extends StatelessWidget {
  const _SlipMini({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        Text(label, style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8))),
      ],
    );
  }
}

/// Detail view for a single payslip — displays salary breakdown.
/// In production: loads HTML from GET /v1/payroll/slips/:id/pdf and shows in WebView.
class _PayslipDetailScreen extends StatelessWidget {
  const _PayslipDetailScreen({required this.slip});
  final Map<String, dynamic> slip;

  String _fmt(double amount) {
    return '₹${amount.toStringAsFixed(0).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{3})+$)'),
          (m) => '${m[1]},',
        )}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(slip['month'] as String),
        actions: [
          IconButton(
            tooltip: 'Download PDF',
            icon: const Icon(Icons.download),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('PDF download will open in browser')),
              );
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              children: [
                Text(
                  'Net Pay',
                  style: theme.textTheme.bodyMedium?.copyWith(color: Colors.white70),
                ),
                const SizedBox(height: 4),
                Text(
                  _fmt(slip['netPay'] as double),
                  style: theme.textTheme.headlineMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  slip['month'] as String,
                  style: theme.textTheme.bodySmall?.copyWith(color: Colors.white60),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Earnings section
          Text('Earnings', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _DetailRow(label: 'Basic Salary', value: _fmt((slip['gross'] as double) * 0.5)),
          _DetailRow(label: 'HRA', value: _fmt((slip['gross'] as double) * 0.2)),
          _DetailRow(label: 'DA', value: _fmt((slip['gross'] as double) * 0.15)),
          _DetailRow(label: 'Special Allowance', value: _fmt((slip['gross'] as double) * 0.15)),
          _DetailRow(
            label: 'Gross Salary',
            value: _fmt(slip['gross'] as double),
            isBold: true,
          ),
          const SizedBox(height: 20),

          // Deductions section
          Text('Deductions', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _DetailRow(label: 'Provident Fund (PF)', value: _fmt(slip['pf'] as double)),
          _DetailRow(label: 'ESI', value: _fmt(slip['esi'] as double)),
          _DetailRow(label: 'TDS (Income Tax)', value: _fmt(slip['tds'] as double)),
          _DetailRow(
            label: 'Total Deductions',
            value: _fmt(slip['deductions'] as double),
            isBold: true,
            isDeduction: true,
          ),
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 12),

          // Net pay
          _DetailRow(
            label: 'Net Pay',
            value: _fmt(slip['netPay'] as double),
            isBold: true,
            isHighlight: true,
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.isBold = false,
    this.isDeduction = false,
    this.isHighlight = false,
  });

  final String label;
  final String value;
  final bool isBold;
  final bool isDeduction;
  final bool isHighlight;

  @override
  Widget build(BuildContext context) {
    final color = isHighlight
        ? const Color(0xFF6366F1)
        : isDeduction
            ? Colors.red.shade700
            : null;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: isBold ? 14 : 13,
              fontWeight: isBold ? FontWeight.w600 : FontWeight.normal,
              color: color ?? (isBold ? Colors.black87 : const Color(0xFF64748B)),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: isBold ? 14 : 13,
              fontWeight: isBold ? FontWeight.w700 : FontWeight.w500,
              color: color ?? Colors.black87,
            ),
          ),
        ],
      ),
    );
  }
}
