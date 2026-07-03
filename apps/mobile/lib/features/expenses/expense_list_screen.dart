import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';

/// Monthly grouped expense list with category breakdown chart.
/// Summary row at top. Each expense: icon, description, amount, date.
class ExpenseListScreen extends ConsumerStatefulWidget {
  const ExpenseListScreen({super.key});

  @override
  ConsumerState<ExpenseListScreen> createState() => _ExpenseListScreenState();
}

class _ExpenseListScreenState extends ConsumerState<ExpenseListScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('expenses');
    });
  }

  String _formatAmount(int paise) {
    final rupees = paise / 100;
    if (rupees >= 100000) {
      return '₹${(rupees / 100000).toStringAsFixed(1)}L';
    }
    return '₹${rupees.toStringAsFixed(0)}';
  }

  IconData _categoryIcon(String category) {
    switch (category) {
      case 'travel':
        return Icons.directions_car;
      case 'food':
        return Icons.restaurant;
      case 'office':
        return Icons.business;
      case 'utilities':
        return Icons.electrical_services;
      case 'salary':
        return Icons.people;
      default:
        return Icons.more_horiz;
    }
  }

  Color _categoryColor(String category) {
    switch (category) {
      case 'travel':
        return Colors.blue;
      case 'food':
        return Colors.orange;
      case 'office':
        return Colors.purple;
      case 'utilities':
        return Colors.teal;
      case 'salary':
        return Colors.indigo;
      default:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dbAsync = ref.watch(dbProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Expenses'),
        centerTitle: false,
      ),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('expenses'),
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
                    Icon(Icons.receipt,
                        size: 56, color: theme.colorScheme.outline),
                    const SizedBox(height: 12),
                    const Text('No expenses recorded yet'),
                  ],
                ),
              );
            }

            // Calculate totals by category for this month
            final now = DateTime.now();
            final categoryTotals = <String, int>{};
            int monthTotal = 0;

            for (final item in items) {
              final data = item['data'] as Map<String, dynamic>;
              final createdAt = data['createdAt'] as String? ?? '';
              final dt = DateTime.tryParse(createdAt);
              if (dt != null &&
                  dt.month == now.month &&
                  dt.year == now.year) {
                final cat = data['category'] as String? ?? 'other';
                final amount = data['amountMinor'] as int? ?? 0;
                categoryTotals[cat] = (categoryTotals[cat] ?? 0) + amount;
                monthTotal += amount;
              }
            }

            return RefreshIndicator(
              onRefresh: () async {
                await ref
                    .read(syncEngineProvider)
                    ?.syncMailbox('expenses');
                setState(() {});
              },
              child: ListView(
                children: [
                  // Month summary
                  Container(
                    margin: const EdgeInsets.all(16),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'This month: ${_formatAmount(monthTotal)}',
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 12),
                        // Simple bar chart
                        if (categoryTotals.isNotEmpty && monthTotal > 0)
                          ...categoryTotals.entries.map((entry) {
                            final fraction = entry.value / monthTotal;
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Row(
                                children: [
                                  Icon(_categoryIcon(entry.key),
                                      size: 16,
                                      color: _categoryColor(entry.key)),
                                  const SizedBox(width: 8),
                                  SizedBox(
                                    width: 60,
                                    child: Text(
                                      entry.key[0].toUpperCase() +
                                          entry.key.substring(1),
                                      style: const TextStyle(fontSize: 12),
                                    ),
                                  ),
                                  Expanded(
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(4),
                                      child: LinearProgressIndicator(
                                        value: fraction,
                                        backgroundColor: theme
                                            .colorScheme.outlineVariant
                                            .withOpacity(0.3),
                                        valueColor:
                                            AlwaysStoppedAnimation<Color>(
                                                _categoryColor(entry.key)),
                                        minHeight: 8,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    _formatAmount(entry.value),
                                    style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                            );
                          }),
                      ],
                    ),
                  ),

                  // Expense list
                  ...items.map((item) {
                    final data = item['data'] as Map<String, dynamic>;
                    final category = data['category'] as String? ?? 'other';
                    final amount = data['amountMinor'] as int? ?? 0;
                    final description =
                        data['description'] as String? ?? '';
                    final createdAt = data['createdAt'] as String? ?? '';
                    final date = createdAt.length >= 10
                        ? createdAt.substring(0, 10)
                        : '';

                    return Card(
                      margin: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 4),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 18,
                              backgroundColor:
                                  _categoryColor(category).withOpacity(0.1),
                              child: Icon(_categoryIcon(category),
                                  size: 18,
                                  color: _categoryColor(category)),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    description.isEmpty
                                        ? '${category[0].toUpperCase()}${category.substring(1)} expense'
                                        : description,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w500),
                                  ),
                                  Text(date,
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: theme.colorScheme.outline,
                                      )),
                                ],
                              ),
                            ),
                            Text(
                              _formatAmount(amount),
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600, fontSize: 15),
                            ),
                          ],
                        ),
                      ),
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
        onPressed: () => context.go('/biz/expenses/new'),
        icon: const Icon(Icons.add),
        label: const Text('Expense'),
      ),
    );
  }
}
