import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Payslip listing and detail view.
/// GET /v1/payroll/salary-slips — list all slips for current employee
/// GET /v1/payroll/slips/:id — full slip with component breakdown
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
      final apiClient = ref.read(apiClientProvider);

      // GET /v1/payroll/salary-slips
      // The API may support ?employeeId= scoping; include if needed.
      final res = await apiClient.get<Map<String, dynamic>>(
        '/v1/payroll/salary-slips',
      );

      final rawSlips =
          (res.data?['slips'] as List<dynamic>?) ??
          (res.data?['data'] as List<dynamic>?) ??
          [];

      final slips = rawSlips.map((raw) {
        final s = raw as Map<String, dynamic>;
        // Amounts come in paise (integer) — divide by 100 for display.
        final grossPaise = (s['grossAmount'] as num?)?.toInt() ?? 0;
        final deductionsPaise = (s['deductions'] as num?)?.toInt() ?? 0;
        final netPaise = (s['netAmount'] as num?)?.toInt() ?? 0;

        return <String, dynamic>{
          'id': s['id'] as String? ?? '',
          'month': s['payPeriod'] as String? ?? '',
          // Store as doubles in rupees for display
          'gross': grossPaise / 100.0,
          'deductions': deductionsPaise / 100.0,
          'netPay': netPaise / 100.0,
          // PF is not in list response — set 0; detail screen fetches components
          'pf': 0.0,
          'tds': 0.0,
        };
      }).toList();

      if (mounted) setState(() => _slips = slips);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Formats a rupee amount (already divided by 100 from paise).
  String _formatCurrency(double amount) {
    return '₹${amount.toStringAsFixed(2).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{2})+(\d{3})(?!\d))'),
          (m) => '${m[1]},',
        ).replaceAllMapped(
          RegExp(r'^(\d+)(\d{3}\.)', ),
          (m) => '${m[1]},${m[2]}',
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
                  _SlipMini(
                    label: 'Gross',
                    value: _formatCurrency(slip['gross'] as double),
                  ),
                  _SlipMini(
                    label: 'Deductions',
                    value: _formatCurrency(slip['deductions'] as double),
                  ),
                  _SlipMini(
                    label: 'PF',
                    value: _formatCurrency(slip['pf'] as double),
                  ),
                  _SlipMini(
                    label: 'TDS',
                    value: _formatCurrency(slip['tds'] as double),
                  ),
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

// ─── Detail Screen ─────────────────────────────────────────────────────────────

/// Detail view for a single payslip.
/// Fetches GET /v1/payroll/slips/:id to get the full component breakdown.
class _PayslipDetailScreen extends ConsumerStatefulWidget {
  const _PayslipDetailScreen({required this.slip});
  final Map<String, dynamic> slip;

  @override
  ConsumerState<_PayslipDetailScreen> createState() =>
      _PayslipDetailScreenState();
}

class _PayslipDetailScreenState extends ConsumerState<_PayslipDetailScreen> {
  bool _loadingDetail = true;
  String? _detailError;

  /// Earnings components from the API.
  List<_SlipComponent> _earnings = [];

  /// Deduction components from the API.
  List<_SlipComponent> _deductions = [];

  @override
  void initState() {
    super.initState();
    _fetchDetail();
  }

  Future<void> _fetchDetail() async {
    setState(() {
      _loadingDetail = true;
      _detailError = null;
    });
    try {
      final id = widget.slip['id'] as String;
      final apiClient = ref.read(apiClientProvider);

      // GET /v1/payroll/slips/:id — full breakdown with `components` array
      final res = await apiClient.get<Map<String, dynamic>>(
        '/v1/payroll/slips/$id',
      );

      final components =
          (res.data?['components'] as List<dynamic>?) ?? [];

      final earnings = <_SlipComponent>[];
      final deductions = <_SlipComponent>[];

      for (final c in components) {
        final comp = c as Map<String, dynamic>;
        final name = comp['name'] as String? ?? comp['label'] as String? ?? 'Component';
        // Amounts in paise → rupees
        final amountPaise = (comp['amount'] as num?)?.toInt() ?? 0;
        final amountRupees = amountPaise / 100.0;
        final type = comp['type'] as String? ?? 'earning';

        if (type == 'deduction') {
          deductions.add(_SlipComponent(name: name, amount: amountRupees));
        } else {
          earnings.add(_SlipComponent(name: name, amount: amountRupees));
        }
      }

      if (mounted) {
        setState(() {
          _earnings = earnings;
          _deductions = deductions;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _detailError = e.toString());
    } finally {
      if (mounted) setState(() => _loadingDetail = false);
    }
  }

  String _fmt(double amount) {
    return '₹${amount.toStringAsFixed(2).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{2})+(\d{3})(?!\d))'),
          (m) => '${m[1]},',
        ).replaceAllMapped(
          RegExp(r'^(\d+)(\d{3}\.)', ),
          (m) => '${m[1]},${m[2]}',
        )}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.slip['month'] as String),
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
                  _fmt(widget.slip['netPay'] as double),
                  style: theme.textTheme.headlineMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  widget.slip['month'] as String,
                  style: theme.textTheme.bodySmall?.copyWith(color: Colors.white60),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Component breakdown
          if (_loadingDetail) ...[
            const Center(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Column(
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 12),
                    Text(
                      'Loading breakdown…',
                      style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ),
          ] else if (_detailError != null) ...[
            _buildDetailError(theme),
          ] else ...[
            // Earnings section
            Text('Earnings',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ..._earnings.map(
              (c) => _DetailRow(label: c.name, value: _fmt(c.amount)),
            ),
            _DetailRow(
              label: 'Gross Salary',
              value: _fmt(widget.slip['gross'] as double),
              isBold: true,
            ),
            const SizedBox(height: 20),

            // Deductions section
            Text('Deductions',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ..._deductions.map(
              (c) => _DetailRow(label: c.name, value: _fmt(c.amount)),
            ),
            _DetailRow(
              label: 'Total Deductions',
              value: _fmt(widget.slip['deductions'] as double),
              isBold: true,
              isDeduction: true,
            ),
            const SizedBox(height: 20),
            const Divider(),
            const SizedBox(height: 12),

            // Net pay
            _DetailRow(
              label: 'Net Pay',
              value: _fmt(widget.slip['netPay'] as double),
              isBold: true,
              isHighlight: true,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDetailError(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          const Icon(Icons.error_outline, size: 40, color: Color(0xFFEF4444)),
          const SizedBox(height: 8),
          Text('Failed to load breakdown', style: theme.textTheme.bodyMedium),
          const SizedBox(height: 4),
          Text(
            _detailError!,
            style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _fetchDetail,
            icon: const Icon(Icons.refresh, size: 16),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

/// Represents a single salary component (earning or deduction).
class _SlipComponent {
  const _SlipComponent({required this.name, required this.amount});
  final String name;
  final double amount;
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
    final theme = Theme.of(context);
    final color = isHighlight
        ? theme.colorScheme.primary
        : isDeduction
            ? theme.colorScheme.error
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
              color: color ?? (isBold ? theme.colorScheme.onSurface : theme.colorScheme.onSurfaceVariant),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: isBold ? 14 : 13,
              fontWeight: isBold ? FontWeight.w700 : FontWeight.w500,
              color: color ?? theme.colorScheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}
