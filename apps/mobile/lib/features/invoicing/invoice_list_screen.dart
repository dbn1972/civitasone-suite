import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';
import 'invoice_model.dart';

/// Pull-to-refresh invoice list with filter chips.
/// Each card: Invoice #, Customer, ₹ amount, date, status pill.
/// FAB → create new. Tap → detail with Mark Paid + Share.
class InvoiceListScreen extends ConsumerStatefulWidget {
  const InvoiceListScreen({super.key});

  @override
  ConsumerState<InvoiceListScreen> createState() => _InvoiceListScreenState();
}

enum _Filter { all, unpaid, thisMonth }

class _InvoiceListScreenState extends ConsumerState<InvoiceListScreen> {
  _Filter _filter = _Filter.all;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('invoices');
    });
  }

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    if (rupees >= 100000) {
      return '₹${(rupees / 100000).toStringAsFixed(1)}L';
    }
    return '₹${rupees.toStringAsFixed(0)}';
  }

  String _formatDate(DateTime dt) {
    return '${dt.day}/${dt.month}/${dt.year}';
  }

  List<Invoice> _applyFilter(List<Invoice> invoices) {
    switch (_filter) {
      case _Filter.unpaid:
        return invoices
            .where((i) => i.status == InvoiceStatus.unpaid)
            .toList();
      case _Filter.thisMonth:
        final now = DateTime.now();
        return invoices
            .where(
                (i) => i.createdAt.month == now.month && i.createdAt.year == now.year)
            .toList();
      case _Filter.all:
        return invoices;
    }
  }

  Color _statusColor(InvoiceStatus status) {
    switch (status) {
      case InvoiceStatus.paid:
        return Colors.green;
      case InvoiceStatus.unpaid:
        return Colors.red;
      case InvoiceStatus.partial:
        return Colors.orange;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dbAsync = ref.watch(dbProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Invoices'),
        centerTitle: false,
      ),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('invoices'),
          builder: (ctx, snap) {
            if (!snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }

            final rawItems = snap.data!;
            final invoices = rawItems
                .map((row) => Invoice.fromJson(
                    row['data'] as Map<String, dynamic>))
                .toList();
            final filtered = _applyFilter(invoices);

            return Column(
              children: [
                // Filter chips
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      _FilterChip(
                        label: 'All',
                        selected: _filter == _Filter.all,
                        onTap: () => setState(() => _filter = _Filter.all),
                      ),
                      const SizedBox(width: 8),
                      _FilterChip(
                        label: 'Unpaid',
                        selected: _filter == _Filter.unpaid,
                        onTap: () => setState(() => _filter = _Filter.unpaid),
                      ),
                      const SizedBox(width: 8),
                      _FilterChip(
                        label: 'This Month',
                        selected: _filter == _Filter.thisMonth,
                        onTap: () =>
                            setState(() => _filter = _Filter.thisMonth),
                      ),
                    ],
                  ),
                ),
                // List
                Expanded(
                  child: filtered.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.receipt_long,
                                  size: 56, color: theme.colorScheme.outline),
                              const SizedBox(height: 12),
                              const Text('No invoices yet'),
                              const SizedBox(height: 8),
                              TextButton(
                                onPressed: () =>
                                    context.go('/biz/invoices/new'),
                                child: const Text('Create your first invoice'),
                              ),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: () async {
                            await ref
                                .read(syncEngineProvider)
                                ?.syncMailbox('invoices');
                            setState(() {});
                          },
                          child: ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: filtered.length,
                            itemBuilder: (ctx, i) {
                              final inv = filtered[i];
                              return _InvoiceCard(
                                invoice: inv,
                                formatAmount: _formatAmount,
                                formatDate: _formatDate,
                                statusColor: _statusColor,
                                onTap: () => _showInvoiceDetail(inv),
                              );
                            },
                          ),
                        ),
                ),
              ],
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/biz/invoices/new'),
        icon: const Icon(Icons.add),
        label: const Text('Invoice'),
      ),
    );
  }

  void _showInvoiceDetail(Invoice invoice) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (ctx, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(24),
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 20),
                decoration: BoxDecoration(
                  color: Colors.grey[300],
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Text(invoice.invoiceNo,
                style: Theme.of(ctx).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(invoice.customerName,
                style: TextStyle(
                    color: Theme.of(ctx).colorScheme.outline, fontSize: 15)),
            const SizedBox(height: 16),
            Text(
              _formatAmount(invoice.total),
              style: const TextStyle(
                  fontSize: 28, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.pop(ctx),
                    icon: const Icon(Icons.check),
                    label: const Text('Mark Paid'),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => Navigator.pop(ctx),
                    icon: const Icon(Icons.share),
                    label: const Text('Share'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
      showCheckmark: false,
    );
  }
}

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({
    required this.invoice,
    required this.formatAmount,
    required this.formatDate,
    required this.statusColor,
    required this.onTap,
  });

  final Invoice invoice;
  final String Function(int) formatAmount;
  final String Function(DateTime) formatDate;
  final Color Function(InvoiceStatus) statusColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(invoice.invoiceNo,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 15)),
                    const SizedBox(height: 4),
                    Text(invoice.customerName,
                        style: TextStyle(
                            color: theme.colorScheme.outline, fontSize: 13)),
                    const SizedBox(height: 4),
                    Text(formatDate(invoice.createdAt),
                        style: TextStyle(
                            color: theme.colorScheme.outline, fontSize: 12)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(formatAmount(invoice.total),
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: statusColor(invoice.status).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      invoice.status.name.toUpperCase(),
                      style: TextStyle(
                        color: statusColor(invoice.status),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
