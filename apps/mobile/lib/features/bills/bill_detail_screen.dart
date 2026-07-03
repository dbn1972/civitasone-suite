import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'models.dart';
import 'providers.dart';

/// Bill detail with timeline showing status transitions.
class BillDetailScreen extends ConsumerWidget {
  const BillDetailScreen({super.key, required this.billId});

  final String billId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final billAsync = ref.watch(billByIdProvider(billId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bill Details'),
        centerTitle: false,
      ),
      body: billAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (bill) {
          if (bill == null) {
            return const Center(child: Text('Bill not found'));
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Header card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(bill.billNo,
                              style: theme.textTheme.titleMedium),
                          _StatusChip(status: bill.status),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _DetailRow('Vendor', bill.vendorName),
                      _DetailRow('Amount', _formatAmount(bill.amountMinor)),
                      if (bill.category != null)
                        _DetailRow('Category', bill.category!),
                      if (bill.department != null)
                        _DetailRow('Department', bill.department!),
                      if (bill.dueDate != null)
                        _DetailRow('Due Date', _formatDate(bill.dueDate!)),
                      if (bill.isOverdue)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.red.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              'OVERDUE',
                              style: TextStyle(
                                color: Colors.red,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // Timeline
              Text('Timeline', style: theme.textTheme.titleSmall),
              const SizedBox(height: 12),
              if (bill.timeline.isEmpty)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text('No activity yet',
                        style: TextStyle(color: theme.colorScheme.outline)),
                  ),
                )
              else
                ...bill.timeline.map((entry) => _TimelineItem(entry: entry)),
            ],
          );
        },
      ),
    );
  }

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    return '₹${rupees.toStringAsFixed(2)}';
  }

  String _formatDate(DateTime dt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${dt.day} ${months[dt.month - 1]} ${dt.year}';
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final BillStatus status;

  Color get _color => switch (status) {
        BillStatus.draft => Colors.grey,
        BillStatus.submitted => Colors.blue,
        BillStatus.underReview => Colors.orange,
        BillStatus.approved => Colors.green,
        BillStatus.rejected => Colors.red,
        BillStatus.paid => Colors.teal,
      };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: _color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status.name.toUpperCase(),
        style: TextStyle(
          color: _color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(color: Theme.of(context).colorScheme.outline)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _TimelineItem extends StatelessWidget {
  const _TimelineItem({required this.entry});
  final BillTimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: 8, bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary,
                  shape: BoxShape.circle,
                ),
              ),
              Container(width: 2, height: 40, color: theme.colorScheme.outline.withOpacity(0.3)),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.action,
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                Text(
                  '${entry.actor} • ${_formatDateTime(entry.timestamp)}',
                  style: TextStyle(
                      fontSize: 12, color: theme.colorScheme.outline),
                ),
                if (entry.remarks != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(entry.remarks!,
                        style: const TextStyle(fontSize: 13)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    final date =
        '${dt.day}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
    final time =
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    return '$date $time';
  }
}
