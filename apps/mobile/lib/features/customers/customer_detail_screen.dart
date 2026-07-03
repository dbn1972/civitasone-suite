import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';
import 'customer_model.dart';

/// Customer detail with balance summary, transaction history, and actions.
/// Actions: Call, WhatsApp, New Invoice, Record Payment.
class CustomerDetailScreen extends ConsumerStatefulWidget {
  const CustomerDetailScreen({super.key, required this.customerId});
  final String customerId;

  @override
  ConsumerState<CustomerDetailScreen> createState() =>
      _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends ConsumerState<CustomerDetailScreen> {
  Customer? _customer;
  List<Map<String, dynamic>> _transactions = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadCustomer());
  }

  Future<void> _loadCustomer() async {
    final db = ref.read(dbProvider).valueOrNull;
    if (db == null) return;

    final customers = await db.listEntities('customers');
    final match = customers.firstWhere(
      (c) => (c['data'] as Map<String, dynamic>)['id'] == widget.customerId,
      orElse: () => <String, dynamic>{},
    );

    if (match.isNotEmpty) {
      final data = match['data'] as Map<String, dynamic>;
      _customer = Customer.fromJson(data);
    }

    // Load related transactions (invoices + payments for this customer)
    final invoices = await db.listEntities('invoices');
    final payments = await db.listEntities('biz_payments');

    final txns = <Map<String, dynamic>>[];
    for (final inv in invoices) {
      final data = inv['data'] as Map<String, dynamic>;
      if (data['customerName'] == _customer?.name) {
        txns.add({
          'type': 'invoice',
          'title': data['invoiceNo'] ?? 'Invoice',
          'amount': data['total'] ?? 0,
          'createdAt': data['createdAt'] ?? '',
          'status': data['status'] ?? 'unpaid',
        });
      }
    }
    for (final pay in payments) {
      final data = pay['data'] as Map<String, dynamic>;
      if (data['customerName'] == _customer?.name) {
        txns.add({
          'type': 'payment',
          'title': 'Payment (${data['mode'] ?? ''})',
          'amount': data['amountMinor'] ?? 0,
          'createdAt': data['createdAt'] ?? '',
          'status': 'received',
        });
      }
    }
    txns.sort((a, b) =>
        (b['createdAt'] as String).compareTo(a['createdAt'] as String));

    if (mounted) {
      setState(() {
        _transactions = txns;
        _loading = false;
      });
    }
  }

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    return '₹${rupees.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Customer')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_customer == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Customer')),
        body: const Center(child: Text('Customer not found')),
      );
    }

    final customer = _customer!;
    final balance = customer.outstandingBalance;

    return Scaffold(
      appBar: AppBar(
        title: Text(customer.name),
        centerTitle: false,
      ),
      body: ListView(
        children: [
          // Header card
          Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: theme.colorScheme.primaryContainer,
                      child: Text(
                        customer.name[0].toUpperCase(),
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(customer.name,
                              style: theme.textTheme.titleMedium
                                  ?.copyWith(fontWeight: FontWeight.bold)),
                          if (customer.phone != null)
                            Text(customer.phone!,
                                style: TextStyle(
                                    color: theme.colorScheme.outline)),
                          if (customer.email != null)
                            Text(customer.email!,
                                style: TextStyle(
                                    color: theme.colorScheme.outline,
                                    fontSize: 13)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                // Balance
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: balance > 0
                        ? Colors.red.withOpacity(0.05)
                        : balance < 0
                            ? Colors.green.withOpacity(0.05)
                            : theme.colorScheme.surface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: balance > 0
                          ? Colors.red.withOpacity(0.2)
                          : balance < 0
                              ? Colors.green.withOpacity(0.2)
                              : theme.colorScheme.outlineVariant,
                    ),
                  ),
                  child: Text(
                    balance > 0
                        ? 'They owe you ${_formatAmount(balance)}'
                        : balance < 0
                            ? 'You owe them ${_formatAmount(balance.abs())}'
                            : 'All settled up',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                      color: balance > 0
                          ? Colors.red
                          : balance < 0
                              ? Colors.green
                              : theme.colorScheme.onSurface,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Actions
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                _ActionButton(
                  icon: Icons.phone,
                  label: 'Call',
                  onTap: () {},
                ),
                const SizedBox(width: 8),
                _ActionButton(
                  icon: Icons.chat,
                  label: 'WhatsApp',
                  onTap: () {},
                ),
                const SizedBox(width: 8),
                _ActionButton(
                  icon: Icons.receipt_long,
                  label: 'Invoice',
                  onTap: () => context.go('/biz/invoices/new'),
                ),
                const SizedBox(width: 8),
                _ActionButton(
                  icon: Icons.payments,
                  label: 'Payment',
                  onTap: () => context.go('/biz/payments/new'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Transaction history
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text('Transaction History',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 8),
          if (_transactions.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text('No transactions yet',
                    style: TextStyle(color: theme.colorScheme.outline)),
              ),
            )
          else
            ..._transactions.map((txn) => Card(
                  margin:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Icon(
                          txn['type'] == 'invoice'
                              ? Icons.receipt_long
                              : Icons.payments,
                          size: 20,
                          color: txn['type'] == 'invoice'
                              ? Colors.blue
                              : Colors.green,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(txn['title'] as String,
                              style: const TextStyle(fontSize: 13)),
                        ),
                        Text(
                          _formatAmount(txn['amount'] as int),
                          style: const TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                )),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: OutlinedButton(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 20),
            const SizedBox(height: 4),
            Text(label, style: const TextStyle(fontSize: 11)),
          ],
        ),
      ),
    );
  }
}
