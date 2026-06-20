import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

class ContactsScreen extends ConsumerStatefulWidget {
  const ContactsScreen({super.key});

  @override
  ConsumerState<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends ConsumerState<ContactsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('crm_contacts');
    });
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Contacts')),
      body: dbAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (db) => FutureBuilder(
          future: db.listEntities('crm_contacts'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!;
            if (items.isEmpty) return const Center(child: Text('No data — pull to refresh'));
            return RefreshIndicator(
              onRefresh: () async {
                await ref.read(syncEngineProvider)?.syncMailbox('crm_contacts');
              },
              child: ListView.builder(
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final data = items[i]['data'] as Map<String, dynamic>;
                  return ListTile(
                    title: Text(data['name'] as String? ?? items[i]['id'] as String),
                    subtitle: Text(data['email'] as String? ?? ''),
                    trailing: Text(data['phone'] as String? ?? ''),
                    isThreeLine: data['organisation'] != null,
                    leadingAndTrailingTextStyle: Theme.of(context).textTheme.bodySmall,
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
