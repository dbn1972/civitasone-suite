import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart'; // Fix: [AUDIT-P2-2]

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

  void _loadData() {
    ref.read(syncEngineProvider)?.syncMailbox('indents');
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Purchase Indents')),
      body: dbAsync.when(
        // Fix: [AUDIT-P2-2] Shimmer/Skeleton loading
        loading: () => const SkeletonList(),
        // Fix: [AUDIT-P2-1] Styled error state
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline, size: 48, color: Colors.grey.shade400),
                const SizedBox(height: 16),
                Text(
                  'Unable to load data',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: Colors.grey.shade700),
                ),
                const SizedBox(height: 8),
                Text(
                  'Please check your connection and try again',
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _loadData,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
        data: (db) => FutureBuilder(
          future: db.listEntities('indents'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const SkeletonList(); // Fix: [AUDIT-P2-2]
            final items = snap.data!;
            // Fix: [AUDIT-P2-1] Styled empty state
            if (items.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.inbox_outlined, size: 48, color: Colors.grey.shade400),
                      const SizedBox(height: 16),
                      Text(
                        'No indent requests',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: Colors.grey.shade700),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Create an indent from the web portal to see it here',
                        style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
                      ),
                    ],
                  ),
                ),
              );
            }
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
