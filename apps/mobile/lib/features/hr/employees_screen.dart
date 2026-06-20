import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

class EmployeesScreen extends ConsumerStatefulWidget {
  const EmployeesScreen({super.key});

  @override
  ConsumerState<EmployeesScreen> createState() => _EmployeesScreenState();
}

class _EmployeesScreenState extends ConsumerState<EmployeesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('employees');
    });
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Employees')),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('employees'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!;
            if (items.isEmpty) return const Center(child: Text('No data — pull to refresh'));
            return RefreshIndicator(
              onRefresh: () async {
                await ref.read(syncEngineProvider)?.syncMailbox('employees');
              },
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final data = items[i]['data'] as Map<String, dynamic>;
                  return ListTile(
                    title: Text(data['name'] as String? ?? items[i]['id'] as String),
                    subtitle: Text(data['designation'] as String? ?? ''),
                    trailing: Text(data['department'] as String? ?? ''),
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
