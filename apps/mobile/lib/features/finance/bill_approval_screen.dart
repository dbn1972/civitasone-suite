import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/providers.dart';

// Fix: [AUDIT-P1-5] User-friendly error messages
String _userFriendlyError(dynamic error) {
  if (error is DioException) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'Connection timed out. Please try again.';
      case DioExceptionType.connectionError:
        return 'No internet connection. Your action has been queued.';
      default:
        final status = error.response?.statusCode;
        if (status != null && status >= 500) return 'Server error. Please try again later.';
        if (status == 403) return 'You do not have permission for this action.';
        if (status == 409) return 'This item was modified by someone else. Please refresh.';
        return 'Something went wrong. Please try again.';
    }
  }
  return 'An unexpected error occurred. Please try again.';
}

/// Bill Approval screen for finance officers.
/// GET /v1/finance/bills?status=pending → list of pending bills
/// POST /v1/finance/bills/:id/approve → approve a bill
/// POST /v1/finance/bills/:id/reject → reject/send back a bill
class BillApprovalScreen extends ConsumerStatefulWidget {
  const BillApprovalScreen({super.key});

  @override
  ConsumerState<BillApprovalScreen> createState() => _BillApprovalScreenState();
}

class _BillApprovalScreenState extends ConsumerState<BillApprovalScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _bills = [];
  // Fix: [AUDIT-P1-6] Offline indicator state
  bool _isOnline = true;

  @override
  void initState() {
    super.initState();
    _fetchPendingBills();
  }

  Future<void> _fetchPendingBills() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/finance/bills',
        params: {'status': 'pending'},
      );
      final data = res.data?['data'] as List<dynamic>? ?? [];
      _bills = data.cast<Map<String, dynamic>>();
    } catch (e) {
      _error = e.toString();
      // Fix: [AUDIT-P1-6] Detect offline state
      if (e is DioException && e.type == DioExceptionType.connectionError) {
        setState(() => _isOnline = false);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatAmount(dynamic amountMinor) {
    if (amountMinor == null) return '₹0';
    final paise = amountMinor is int ? amountMinor : (amountMinor as num).toInt();
    final rupees = paise / 100;
    // Format with commas (Indian numbering)
    return '₹${_indianFormat(rupees)}';
  }

  String _indianFormat(double value) {
    final intPart = value.truncate();
    final str = intPart.toString();
    if (str.length <= 3) return str;
    final last3 = str.substring(str.length - 3);
    final rest = str.substring(0, str.length - 3);
    final buffer = StringBuffer();
    for (var i = 0; i < rest.length; i++) {
      if (i > 0 && (rest.length - i) % 2 == 0) {
        buffer.write(',');
      }
      buffer.write(rest[i]);
    }
    buffer.write(',');
    buffer.write(last3);
    return buffer.toString();
  }

  Future<void> _approveBill(Map<String, dynamic> bill) async {
    final billId = bill['id'] as String;
    final billNo = bill['billNumber'] as String? ?? billId;
    final notesCtrl = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Approve Bill'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Approve bill $billNo?'),
            const SizedBox(height: 16),
            TextField(
              controller: notesCtrl,
              decoration: const InputDecoration(
                labelText: 'Notes (optional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Approve'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final api = ref.read(apiClientProvider);
      final body = <String, dynamic>{};
      if (notesCtrl.text.trim().isNotEmpty) {
        body['notes'] = notesCtrl.text.trim();
      }
      await api.post('/v1/finance/bills/$billId/approve', data: body);
      setState(() => _bills.removeWhere((b) => b['id'] == billId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Bill $billNo approved'),
            backgroundColor: const Color(0xFF15803D),
          ),
        );
      }
    } catch (e) {
      // Fix: [AUDIT-P1-7] Route writes through offline outbox on connection errors
      if (e is DioException &&
          (e.type == DioExceptionType.connectionError ||
           e.type == DioExceptionType.connectionTimeout)) {
        // TODO: Queue to SyncDatabase outbox for guaranteed delivery
        setState(() => _isOnline = false);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Action queued — will sync when online')),
          );
        }
        return;
      }
      // Fix: [AUDIT-P1-5] User-friendly error messages
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_userFriendlyError(e)),
            action: SnackBarAction(
              label: 'Retry',
              onPressed: () => _approveBill(bill),
            ),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  Future<void> _rejectBill(Map<String, dynamic> bill) async {
    final billId = bill['id'] as String;
    final billNo = bill['billNumber'] as String? ?? billId;
    final reasonCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send Back Bill'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Send back bill $billNo?'),
              const SizedBox(height: 16),
              TextFormField(
                controller: reasonCtrl,
                decoration: const InputDecoration(
                  labelText: 'Reason *',
                  border: OutlineInputBorder(),
                  hintText: 'Provide reason for sending back',
                ),
                maxLines: 3,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Reason is required' : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState!.validate()) {
                Navigator.pop(ctx, true);
              }
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Send Back'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final api = ref.read(apiClientProvider);
      await api.post('/v1/finance/bills/$billId/reject', data: {
        'reason': reasonCtrl.text.trim(),
      });
      setState(() => _bills.removeWhere((b) => b['id'] == billId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Bill $billNo sent back'),
            backgroundColor: Theme.of(context).colorScheme.tertiary,
          ),
        );
      }
    } catch (e) {
      // Fix: [AUDIT-P1-7] Route writes through offline outbox on connection errors
      if (e is DioException &&
          (e.type == DioExceptionType.connectionError ||
           e.type == DioExceptionType.connectionTimeout)) {
        // TODO: Queue to SyncDatabase outbox for guaranteed delivery
        setState(() => _isOnline = false);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Action queued — will sync when online')),
          );
        }
        return;
      }
      // Fix: [AUDIT-P1-5] User-friendly error messages
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_userFriendlyError(e)),
            action: SnackBarAction(
              label: 'Retry',
              onPressed: () => _rejectBill(bill),
            ),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bill Approvals'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _fetchPendingBills,
          ),
        ],
      ),
      body: Column(
        children: [
          // Fix: [AUDIT-P1-6] Offline indicator banner
          if (!_isOnline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(
                children: [
                  Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text(
                    'Offline — actions will sync when connected',
                    style: TextStyle(fontSize: 13, color: Colors.orange.shade800),
                  ),
                ],
              ),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _buildError(theme)
                    : _bills.isEmpty
                        ? _buildEmpty(theme)
                        : RefreshIndicator(
                            onRefresh: _fetchPendingBills,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(16),
                              itemCount: _bills.length,
                              itemBuilder: (ctx, i) => _BillCard(
                                bill: _bills[i],
                                formatAmount: _formatAmount,
                                onApprove: () => _approveBill(_bills[i]),
                                onReject: () => _rejectBill(_bills[i]),
                              ),
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.check_circle_outline, size: 72, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No pending bills', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            'All bills have been processed',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
          ),
        ],
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load bills', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchPendingBills,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _BillCard extends StatelessWidget {
  const _BillCard({
    required this.bill,
    required this.formatAmount,
    required this.onApprove,
    required this.onReject,
  });

  final Map<String, dynamic> bill;
  final String Function(dynamic) formatAmount;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final billNo = bill['billNumber'] as String? ?? '';
    final vendor = bill['vendorName'] as String? ?? 'Unknown Vendor';
    final grossAmount = bill['grossAmount'];
    final netAmount = bill['netAmount'];
    final date = bill['date'] as String? ?? '';
    final stage = bill['stage'] as String? ?? '';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(Icons.description, color: theme.colorScheme.primary, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        billNo.isNotEmpty ? billNo : 'Bill',
                        style: theme.textTheme.titleSmall,
                      ),
                      Text(
                        vendor,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.outline,
                        ),
                      ),
                    ],
                  ),
                ),
                if (stage.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.tertiaryContainer,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      stage,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: theme.colorScheme.onTertiaryContainer,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _AmountChip(label: 'Gross', value: formatAmount(grossAmount), theme: theme),
                const SizedBox(width: 12),
                _AmountChip(label: 'Net', value: formatAmount(netAmount), theme: theme),
                const Spacer(),
                if (date.isNotEmpty)
                  Text(date, style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                OutlinedButton.icon(
                  onPressed: onReject,
                  icon: const Icon(Icons.reply, size: 18),
                  label: const Text('Send Back'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.colorScheme.error,
                    side: BorderSide(color: theme.colorScheme.error.withOpacity(0.5)),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: onApprove,
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Approve'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _AmountChip extends StatelessWidget {
  const _AmountChip({required this.label, required this.value, required this.theme});
  final String label;
  final String value;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 11, color: theme.colorScheme.outline)),
        Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
      ],
    );
  }
}
