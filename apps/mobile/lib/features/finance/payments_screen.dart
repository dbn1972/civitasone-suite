import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

class PaymentsScreen extends ConsumerStatefulWidget {
  const PaymentsScreen({super.key});

  @override
  ConsumerState<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends ConsumerState<PaymentsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('payments');
    });
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Payments')),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('payments'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!;
            if (items.isEmpty) return const Center(child: Text('No data — pull to refresh'));
            return RefreshIndicator(
              onRefresh: () async {
                await ref.read(syncEngineProvider)?.syncMailbox('payments');
              },
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final data = items[i]['data'] as Map<String, dynamic>;
                  return ListTile(
                    title: Text(data['reference'] as String? ?? items[i]['id'] as String),
                    subtitle: Text(data['status'] as String? ?? ''),
                    trailing: Text(data['amountMinor']?.toString() ?? ''),
                  );
                },
              ),
            );
          },
        ),
      ),
    );
  }
}
