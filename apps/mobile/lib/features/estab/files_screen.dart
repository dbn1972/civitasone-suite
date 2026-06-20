import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

class EstabFilesScreen extends ConsumerStatefulWidget {
  const EstabFilesScreen({super.key});

  @override
  ConsumerState<EstabFilesScreen> createState() => _EstabFilesScreenState();
}

class _EstabFilesScreenState extends ConsumerState<EstabFilesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('estab_files');
    });
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Files')),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('estab_files'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!;
            if (items.isEmpty) return const Center(child: Text('No data — pull to refresh'));
            return RefreshIndicator(
              onRefresh: () async {
                await ref.read(syncEngineProvider)?.syncMailbox('estab_files');
              },
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final data = items[i]['data'] as Map<String, dynamic>;
                  return ListTile(
                    title: Text(
                      '${data['fileNo'] ?? ''} — ${data['subject'] ?? items[i]['id']}',
                    ),
                    subtitle: Text(data['status'] as String? ?? ''),
                    trailing: Text(data['classification'] as String? ?? ''),
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
