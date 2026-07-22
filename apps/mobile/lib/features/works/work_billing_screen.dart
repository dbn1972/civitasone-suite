import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// Work Billing screen — view bills, pending approvals for field DO/SDO.
class WorkBillingScreen extends ConsumerStatefulWidget {
  const WorkBillingScreen({super.key});

  @override
  ConsumerState<WorkBillingScreen> createState() => _WorkBillingScreenState();
}

class _WorkBillingScreenState extends ConsumerState<WorkBillingScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _bills = [];

  @override
  void initState() {
    super.initState();
    _loadBills();
  }

  Future<void> _loadBills() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/works/billing/bills');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _bills = list.cast<Map<String, dynamic>>();
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
          _isOffline = true;
        });
      }
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'finalized':
      case 'submitted_ifms':
        return const Color(0xFF15803D);
      case 'pending':
        return const Color(0xFFF59E0B);
      case 'rejected':
        return const Color(0xFFEF4444);
      default:
        return const Color(0xFF6B7280);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Works Billing'),
        actions: [
          Semantics(
            label: 'Refresh bills',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadBills,
            ),
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    final theme = Theme.of(context);
    if (_loading) return const SkeletonList();
    if (_error != null && _bills.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
            const SizedBox(height: 16),
            Text('Unable to load bills', style: theme.textTheme.titleMedium),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loadBills,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ]),
        ),
      );
    }
    if (_bills.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.receipt_long, size: 64, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No billing records',
              style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline)),
        ]),
      );
    }

    return Column(
      children: [
        if (_isOffline)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: Colors.orange.shade100,
            child: Row(children: [
              Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade800),
              const SizedBox(width: 8),
              Text('Offline — showing cached data',
                  style: TextStyle(fontSize: 12, color: Colors.orange.shade800)),
            ]),
          ),
        // Summary bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          color: theme.colorScheme.surfaceContainerLow,
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
            _summaryChip('Total', _bills.length.toString(), const Color(0xFF3B82F6)),
            _summaryChip('Pending', _bills.where((b) =>
              (b['status'] as String?)?.toLowerCase() == 'pending').length.toString(), const Color(0xFFF59E0B)),
            _summaryChip('Finalized', _bills.where((b) =>
              (b['status'] as String?)?.toLowerCase() == 'finalized').length.toString(), const Color(0xFF15803D)),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadBills,
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: 16, top: 8),
              itemCount: _bills.length,
              itemBuilder: (ctx, i) {
                final bill = _bills[i];
                final status = bill['status'] as String? ?? 'pending';
                return Semantics(
                  label: 'Bill ${bill['billNo'] ?? ''}',
                  child: Card(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Expanded(
                              child: Text(
                                'Bill #${bill['billNo'] ?? '—'}',
                                style: theme.textTheme.titleSmall?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: _statusColor(status).withOpacity(0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                status.replaceAll('_', ' ').toUpperCase(),
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                  color: _statusColor(status),
                                ),
                              ),
                            ),
                          ]),
                          const SizedBox(height: 8),
                          Text(
                            bill['work'] as String? ?? '—',
                            style: theme.textTheme.bodyMedium,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 8),
                          Row(children: [
                            Text(
                              bill['mode'] as String? ?? 'e-MB',
                              style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
                            ),
                            const Spacer(),
                            if (bill['netPayable'] != null)
                              Text(
                                '₹${bill['netPayable']}',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: theme.colorScheme.primary,
                                ),
                              ),
                          ]),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _summaryChip(String label, String value, Color color) {
    return Column(children: [
      Text(value,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color)),
      Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF6B7280))),
    ]);
  }
}
