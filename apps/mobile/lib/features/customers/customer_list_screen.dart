import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';
import 'customer_model.dart';

/// Customer list with search. Each card shows name, phone, outstanding balance.
/// FAB to add customer. Tap → customer detail.
class CustomerListScreen extends ConsumerStatefulWidget {
  const CustomerListScreen({super.key});

  @override
  ConsumerState<CustomerListScreen> createState() =>
      _CustomerListScreenState();
}

class _CustomerListScreenState extends ConsumerState<CustomerListScreen> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('customers');
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _formatBalance(int paise) {
    final rupees = (paise.abs()) / 100;
    return '₹${rupees.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dbAsync = ref.watch(dbProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Customers'),
        centerTitle: false,
      ),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('customers'),
          builder: (ctx, snap) {
            if (!snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }

            final rawItems = snap.data!;
            final allCustomers = rawItems
                .map((row) =>
                    Customer.fromJson(row['data'] as Map<String, dynamic>))
                .toList();

            final filtered = _query.isEmpty
                ? allCustomers
                : allCustomers
                    .where((c) =>
                        c.name.toLowerCase().contains(_query.toLowerCase()) ||
                        (c.phone?.contains(_query) ?? false))
                    .toList();

            return Column(
              children: [
                // Search bar
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search customers...',
                      prefixIcon: const Icon(Icons.search),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
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

                // List
                Expanded(
                  child: filtered.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.people,
                                  size: 56, color: theme.colorScheme.outline),
                              const SizedBox(height: 12),
                              Text(_query.isEmpty
                                  ? 'No customers yet'
                                  : 'No results'),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: () async {
                            await ref
                                .read(syncEngineProvider)
                                ?.syncMailbox('customers');
                            setState(() {});
                          },
                          child: ListView.builder(
                            padding:
                                const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: filtered.length,
                            itemBuilder: (ctx, i) {
                              final customer = filtered[i];
                              return Card(
                                margin: const EdgeInsets.only(bottom: 8),
                                child: InkWell(
                                  onTap: () => context.go(
                                      '/biz/customers/${customer.id}'),
                                  borderRadius: BorderRadius.circular(12),
                                  child: Padding(
                                    padding: const EdgeInsets.all(14),
                                    child: Row(
                                      children: [
                                        CircleAvatar(
                                          radius: 22,
                                          backgroundColor: theme
                                              .colorScheme.primaryContainer,
                                          child: Text(
                                            customer.name[0].toUpperCase(),
                                            style: TextStyle(
                                              fontWeight: FontWeight.bold,
                                              color: theme
                                                  .colorScheme.primary,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(customer.name,
                                                  style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.w600)),
                                              if (customer.phone != null)
                                                Text(
                                                  customer.phone!,
                                                  style: TextStyle(
                                                    fontSize: 13,
                                                    color: theme
                                                        .colorScheme.outline,
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ),
                                        if (customer.outstandingBalance != 0)
                                          Text(
                                            _formatBalance(
                                                customer.outstandingBalance),
                                            style: TextStyle(
                                              fontWeight: FontWeight.w600,
                                              color: customer
                                                          .outstandingBalance >
                                                      0
                                                  ? Colors.red
                                                  : Colors.green,
                                            ),
                                          ),
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
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/biz/customers/new'),
        icon: const Icon(Icons.add),
        label: const Text('Customer'),
      ),
    );
  }
}
