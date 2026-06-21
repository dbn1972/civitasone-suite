import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/skeleton_card.dart';

class ApprovalsScreen extends ConsumerStatefulWidget {
  const ApprovalsScreen({super.key});

  @override
  ConsumerState<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends ConsumerState<ApprovalsScreen> {
  final Set<String> _pendingIds = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('approvals');
    });
  }

  Future<void> _showActionSheet(
    BuildContext context,
    Map<String, dynamic> data,
    String entityId,
  ) async {
    final commentCtrl = TextEditingController();
    String? decision;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(
                  child: Text(
                    data['title'] as String? ?? 'Approval Request',
                    style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(ctx).pop(),
                ),
              ]),
              const SizedBox(height: 4),
              Text(
                '${data['type'] ?? ''} · Requested by ${data['requestedBy'] ?? '—'}',
                style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(ctx).colorScheme.outline,
                    ),
              ),
              if (data['amount'] != null) ...[
                const SizedBox(height: 4),
                Text(
                  '₹${((data['amount'] as num) / 100).toStringAsFixed(2)}',
                  style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                        color: Theme.of(ctx).colorScheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
              const SizedBox(height: 16),
              TextField(
                controller: commentCtrl,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Comment (optional)',
                  border: OutlineInputBorder(),
                  hintText: 'Add a note for the requester…',
                ),
              ),
              const SizedBox(height: 16),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red.shade700,
                      side: BorderSide(color: Colors.red.shade300),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    icon: const Icon(Icons.close),
                    label: const Text('Reject'),
                    onPressed: () {
                      decision = 'rejected';
                      Navigator.of(ctx).pop();
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.green.shade700,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    icon: const Icon(Icons.check),
                    label: const Text('Approve'),
                    onPressed: () {
                      decision = 'approved';
                      Navigator.of(ctx).pop();
                    },
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );

    if (decision == null || !mounted) return;
    await _submitDecision(entityId, decision!, commentCtrl.text.trim());
  }

  Future<void> _submitDecision(
      String entityId, String decision, String comment) async {
    final dbAsync = ref.read(dbProvider);
    final db = dbAsync.valueOrNull;
    if (db == null) return;

    setState(() => _pendingIds.add(entityId));

    await db.enqueueOutbox(
      mailbox: 'approvals',
      operation: decision,
      entityId: entityId,
      payload: {
        'entityId': entityId,
        'decision': decision,
        'comment': comment,
        'decidedAt': DateTime.now().toUtc().toIso8601String(),
      },
    );

    // Optimistic local update.
    await db.upsertEntity(
      id: entityId,
      mailbox: 'approvals',
      data: {
        ...((await db.listEntities('approvals'))
                .where((e) => e['id'] == entityId)
                .firstOrNull?['data'] as Map<String, dynamic>? ??
            {}),
        'status': decision,
      },
      updatedAt: DateTime.now().toUtc().toIso8601String(),
    );

    // Fire-and-forget sync.
    ref.read(syncEngineProvider)?.syncMailbox('approvals');

    if (mounted) {
      setState(() => _pendingIds.remove(entityId));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(decision == 'approved'
              ? 'Approved — syncing to server'
              : 'Rejected — syncing to server'),
          backgroundColor:
              decision == 'approved' ? Colors.green.shade700 : Colors.red.shade700,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final dbAsync = ref.watch(dbProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Approvals'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: () => ref.read(syncEngineProvider)?.syncMailbox('approvals'),
          ),
        ],
      ),
      body: dbAsync.when(
        loading: () => const SkeletonList(),
        error: (e, _) => _ErrorState(
          message: e.toString(),
          onRetry: () => ref.read(syncEngineProvider)?.syncMailbox('approvals'),
        ),
        data: (db) => FutureBuilder(
          future: db.listEntities('approvals'),
          builder: (ctx, snap) {
            if (!snap.hasData) return const SkeletonList();
            final items = snap.data!;
            if (items.isEmpty) {
              return const _EmptyState(
                icon: Icons.approval,
                message: 'No pending approvals',
              );
            }
            return RefreshIndicator(
              onRefresh: () async {
                await ref.read(syncEngineProvider)?.syncMailbox('approvals');
                if (mounted) setState(() {});
              },
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: items.length,
                itemBuilder: (ctx, i) {
                  final id = items[i]['id'] as String;
                  final data = items[i]['data'] as Map<String, dynamic>;
                  final isPending = _pendingIds.contains(id);
                  final status = isPending
                      ? 'pending'
                      : (data['status'] as String? ?? 'pending');
                  final isActionable =
                      status == 'pending' && !isPending;

                  return Card(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: isActionable
                          ? () => _showActionSheet(ctx, data, id)
                          : null,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [
                              Expanded(
                                child: Text(
                                  data['title'] as String? ?? id,
                                  style: Theme.of(ctx)
                                      .textTheme
                                      .titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w600),
                                ),
                              ),
                              StatusPill(status: status),
                            ]),
                            const SizedBox(height: 6),
                            Text(
                              '${data['type'] ?? ''} · ${data['requestedBy'] ?? ''}',
                              style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                                    color: Theme.of(ctx).colorScheme.outline,
                                  ),
                            ),
                            if (data['amount'] != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                '₹${((data['amount'] as num) / 100).toStringAsFixed(2)}',
                                style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(
                                      fontWeight: FontWeight.w500,
                                    ),
                              ),
                            ],
                            if (isActionable) ...[
                              const SizedBox(height: 10),
                              const Align(
                                alignment: Alignment.centerRight,
                                child: Text(
                                  'Tap to approve / reject →',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: Color(0xFF6366F1),
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
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
        const SizedBox(height: 8),
        const Text('Pull down to refresh',
            style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
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
