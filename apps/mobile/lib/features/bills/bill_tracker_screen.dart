import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'models.dart';
import 'providers.dart';

/// Bill tracker with search. Shows bill status and amount.
class BillTrackerScreen extends ConsumerStatefulWidget {
  const BillTrackerScreen({super.key, this.connectivityOverride});

  final bool? connectivityOverride;

  @override
  ConsumerState<BillTrackerScreen> createState() =>
      _BillTrackerScreenState();
}

class _BillTrackerScreenState extends ConsumerState<BillTrackerScreen> {
  final _searchController = TextEditingController();
  String _query = '';
  bool _isOffline = false;

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _checkConnectivity() async {
    final override = widget.connectivityOverride;
    if (override != null) {
      if (mounted) setState(() => _isOffline = !override);
      return;
    }
    try {
      final result = await Connectivity().checkConnectivity();
      if (mounted) {
        setState(() {
          _isOffline =
              result.isEmpty || result.first == ConnectivityResult.none;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isOffline = false);
    }
  }

  List<Bill> _filter(List<Bill> bills) {
    if (_query.isEmpty) return bills;
    final q = _query.toLowerCase();
    return bills
        .where((b) =>
            b.billNo.toLowerCase().contains(q) ||
            b.vendorName.toLowerCase().contains(q) ||
            b.description.toLowerCase().contains(q))
        .toList();
  }

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    return '₹${rupees.toStringAsFixed(2)}';
  }

  Color _statusColor(BillStatus status) {
    return switch (status) {
      BillStatus.draft => Colors.grey,
      BillStatus.submitted => Colors.blue,
      BillStatus.underReview => Colors.orange,
      BillStatus.approved => Colors.green,
      BillStatus.rejected => Colors.red,
      BillStatus.paid => Colors.teal,
    };
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final billsAsync = ref.watch(billsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bill Tracker'),
        centerTitle: false,
      ),
      body: Column(
        children: [
          if (_isOffline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(
                children: [
                  Icon(Icons.cloud_off,
                      size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text(
                    'Offline — showing cached data',
                    style:
                        TextStyle(fontSize: 12, color: Colors.orange.shade800),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search by bill number or vendor',
                prefixIcon: const Icon(Icons.search),
                border: const OutlineInputBorder(),
                suffixIcon: _query.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _query = '');
                        },
                      )
                    : null,
              ),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Expanded(
            child: billsAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(child: Text('Error: $err')),
              data: (bills) {
                final filtered = _filter(bills);
                if (filtered.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.receipt_long,
                            size: 48, color: theme.colorScheme.outline),
                        const SizedBox(height: 8),
                        Text(
                          _query.isEmpty
                              ? 'No bills found'
                              : 'No results for "$_query"',
                          style:
                              TextStyle(color: theme.colorScheme.outline),
                        ),
                      ],
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async {
                    await _checkConnectivity();
                    ref.invalidate(billsProvider);
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      final bill = filtered[index];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          onTap: () => context.go('/bills/${bill.id}'),
                          title: Text(bill.billNo,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w500)),
                          subtitle: Text(bill.vendorName,
                              style: TextStyle(
                                  fontSize: 12,
                                  color: theme.colorScheme.outline)),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(_formatAmount(bill.amountMinor),
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w600)),
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: _statusColor(bill.status)
                                      .withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(
                                  bill.status.name,
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w500,
                                    color: _statusColor(bill.status),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
