import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';

/// Timeline-style payment list with running balance header.
/// Green = received, Red = paid out. Pull-to-refresh + infinite scroll.
class PaymentListScreen extends ConsumerStatefulWidget {
  const PaymentListScreen({super.key});

  @override
  ConsumerState<PaymentListScreen> createState() => _PaymentListScreenState();
}

class _PaymentListScreenState extends ConsumerState<PaymentListScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('biz_payments');
    });
  }

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    return '₹${rupees.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dbAsync = ref.watch(dbProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Payments'),
        centerTitle: false,
      ),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('biz_payments'),
          builder: (ctx, snap) {
            if (!snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }

            final items = snap.data!;
            if (items.isEmpty) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.payments,
                        size: 56, color: theme.colorScheme.outline),
                    const SizedBox(height: 12),
                    const Text('No payments recorded yet'),
                  ],
                ),
              );
            }

            // Calculate running balance
            int totalReceived = 0;
            int totalPaid = 0;
            for (final item in items) {
              final data = item['data'] as Map<String, dynamic>;
              final amount = data['amountMinor'] as int? ?? 0;
              if (data['type'] == 'paid') {
                totalPaid += amount;
              } else {
                totalReceived += amount;
              }
            }
            final balance = totalReceived - totalPaid;

            // Group by date
            final grouped = <String, List<Map<String, dynamic>>>{};
            for (final item in items) {
              final data = item['data'] as Map<String, dynamic>;
              final createdAt = data['createdAt'] as String? ?? '';
              final date = createdAt.length >= 10
                  ? createdAt.substring(0, 10)
                  : 'Unknown';
              grouped.putIfAbsent(date, () => []).add(data);
            }

            return RefreshIndicator(
              onRefresh: () async {
                await ref
                    .read(syncEngineProvider)
                    ?.syncMailbox('biz_payments');
                setState(() {});
              },
              child: ListView(
                children: [
                  // Gradient balance header
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.all(16),
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          theme.colorScheme.primary,
                          theme.colorScheme.primary.withOpacity(0.8),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Running Balance',
                            style: TextStyle(
                                color: Colors.white.withOpacity(0.8),
                                fontSize: 13)),
                        const SizedBox(height: 4),
                        Text(
                          _formatAmount(balance),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            _BalanceStat(
                              label: 'Received',
                              amount: _formatAmount(totalReceived),
                              color: Colors.green[200]!,
                            ),
                            const SizedBox(width: 24),
                            _BalanceStat(
                              label: 'Paid',
                              amount: _formatAmount(totalPaid),
                              color: Colors.red[200]!,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  // Timeline
                  ...grouped.entries.map((entry) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                          child: Text(
                            entry.key,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: theme.colorScheme.outline,
                            ),
                          ),
                        ),
                        ...entry.value.map((data) {
                          final isReceived = data['type'] != 'paid';
                          final amount = data['amountMinor'] as int? ?? 0;
                          return Card(
                            margin: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 4),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 18,
                                    backgroundColor: isReceived
                                        ? Colors.green.withOpacity(0.1)
                                        : Colors.red.withOpacity(0.1),
                                    child: Icon(
                                      isReceived
                                          ? Icons.arrow_downward
                                          : Icons.arrow_upward,
                                      size: 18,
                                      color: isReceived
                                          ? Colors.green
                                          : Colors.red,
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          data['customerName'] as String? ??
                                              'Unknown',
                                          style: const TextStyle(
                                              fontWeight: FontWeight.w500),
                                        ),
                                        Text(
                                          (data['mode'] as String? ?? '')
                                              .toUpperCase(),
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: theme.colorScheme.outline,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text(
                                    '${isReceived ? '+' : '-'} ${_formatAmount(amount)}',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w600,
                                      fontSize: 15,
                                      color: isReceived
                                          ? Colors.green
                                          : Colors.red,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }),
                      ],
                    );
                  }),
                  const SizedBox(height: 80),
                ],
              ),
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/biz/payments/new'),
        icon: const Icon(Icons.add),
        label: const Text('Record'),
      ),
    );
  }
}

class _BalanceStat extends StatelessWidget {
  const _BalanceStat({
    required this.label,
    required this.amount,
    required this.color,
  });

  final String label;
  final String amount;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 12)),
        Text(amount,
            style: TextStyle(
                color: color, fontWeight: FontWeight.w600, fontSize: 14)),
      ],
    );
  }
}
