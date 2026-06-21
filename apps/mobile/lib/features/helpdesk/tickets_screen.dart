import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/skeleton_card.dart';

class TicketsScreen extends ConsumerStatefulWidget {
  const TicketsScreen({super.key});

  @override
  ConsumerState<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends ConsumerState<TicketsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('helpdesk_tickets');
    });
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tickets'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: () =>
                ref.read(syncEngineProvider)?.syncMailbox('helpdesk_tickets'),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/helpdesk/tickets/new'),
        icon: const Icon(Icons.add),
        label: const Text('New Ticket'),
      ),
      body: dbAsync.when(
        loading: () => const SkeletonList(),
        error: (e, _) => _ErrorState(
          message: e.toString(),
          onRetry: () =>
              ref.read(syncEngineProvider)?.syncMailbox('helpdesk_tickets'),
        ),
        data: (db) => FutureBuilder(
          future: db.listEntities('helpdesk_tickets'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const SkeletonList();
            final items = snap.data!;
            if (items.isEmpty) {
              return const _EmptyState(
                icon: Icons.support_agent,
                message: 'No tickets yet',
              );
            }
            return RefreshIndicator(
              onRefresh: () async {
                await ref
                    .read(syncEngineProvider)
                    ?.syncMailbox('helpdesk_tickets');
                if (mounted) setState(() {});
              },
              child: ListView.builder(
                padding: const EdgeInsets.only(bottom: 96, top: 8),
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final data = items[i]['data'] as Map<String, dynamic>;
                  final status = data['status'] as String? ?? 'open';
                  final priority = data['priority'] as String? ?? 'medium';
                  return Card(
                    margin:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Expanded(
                              child: Text(
                                data['subject'] as String? ??
                                    '${data['ticketNo'] ?? ''} — ${items[i]['id']}',
                                style: Theme.of(ctx)
                                    .textTheme
                                    .titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w600),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ]),
                          const SizedBox(height: 8),
                          Row(children: [
                            StatusPill(status: status),
                            const SizedBox(width: 8),
                            StatusPill(status: priority),
                          ]),
                          if (data['category'] != null) ...[
                            const SizedBox(height: 6),
                            Row(children: [
                              const Icon(Icons.label_outline,
                                  size: 14, color: Color(0xFF94A3B8)),
                              const SizedBox(width: 4),
                              Text(
                                data['category'] as String,
                                style: Theme.of(ctx)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(
                                        color: Theme.of(ctx)
                                            .colorScheme
                                            .outline),
                              ),
                            ]),
                          ],
                          if (data['ticketNo'] != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              '#${data['ticketNo']}',
                              style: const TextStyle(
                                fontSize: 11,
                                fontFamily: 'monospace',
                                color: Color(0xFF94A3B8),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
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

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.message});
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 64, color: Theme.of(context).colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(message,
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(color: Theme.of(context).colorScheme.outline)),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: () => context.push('/helpdesk/tickets/new'),
          icon: const Icon(Icons.add),
          label: const Text('Create Ticket'),
        ),
      ]),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load data',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ]),
      ),
    );
  }
}
