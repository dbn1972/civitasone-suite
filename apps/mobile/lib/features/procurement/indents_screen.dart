import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

class IndentsScreen extends ConsumerStatefulWidget {
  const IndentsScreen({super.key});

  @override
  ConsumerState<IndentsScreen> createState() => _IndentsScreenState();
}

class _IndentsScreenState extends ConsumerState<IndentsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('indents');
    });
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Purchase Indents')),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('indents'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!;
            if (items.isEmpty) return const Center(child: Text('No data — pull to refresh'));
            return RefreshIndicator(
              onRefresh: () async {
                await ref.read(syncEngineProvider)?.syncMailbox('indents');
              },
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final data = items[i]['data'] as Map<String, dynamic>;
                  return ListTile(
                    title: Text(data['indentNo'] as String? ?? items[i]['id'] as String),
                    subtitle: Text(data['department'] as String? ?? ''),
                    trailing: Text(data['status'] as String? ?? ''),
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
