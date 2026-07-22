import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/skeleton_card.dart';

/// DAK Inbox screen for eOffice.
/// Officers read incoming DAK items and take action (mark read, forward).
class DakInboxScreen extends ConsumerStatefulWidget {
  const DakInboxScreen({super.key});

  @override
  ConsumerState<DakInboxScreen> createState() => _DakInboxScreenState();
}

class _DakInboxScreenState extends ConsumerState<DakInboxScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _items = [];

  @override
  void initState() {
    super.initState();
    _loadDak();
  }

  Future<void> _loadDak() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      // Try offline-first from sync DB
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities('dak_inbox');
        if (cached.isNotEmpty) {
          setState(() {
            _items = cached
                .map((e) => {
                      'id': e['id'],
                      ...e['data'] as Map<String, dynamic>,
                    })
                .toList();
            _loading = false;
          });
        }
      }

      // Fetch from API
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/estab/dak/inbox');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);

      final items = list.cast<Map<String, dynamic>>();

      // Cache locally
      if (db != null) {
        for (final item in items) {
          await db.upsertEntity(
            id: item['id'] as String,
            mailbox: 'dak_inbox',
            data: item,
            updatedAt: DateTime.now().toUtc().toIso8601String(),
          );
        }
      }

      if (mounted) {
        setState(() {
          _items = items;
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isOffline = true;
          if (_items.isEmpty) _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _markAsRead(String id) async {
    final db = ref.read(dbProvider).valueOrNull;
    if (db == null) return;

    await db.enqueueOutbox(
      mailbox: 'dak_inbox',
      operation: 'mark_read',
      entityId: id,
      payload: {'id': id, 'action': 'mark_read'},
    );

    setState(() {
      final idx = _items.indexWhere((e) => e['id'] == id);
      if (idx >= 0) {
        _items[idx] = {..._items[idx], 'status': 'noted'};
      }
    });

    ref.read(syncEngineProvider)?.syncMailbox('dak_inbox');

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Marked as read')),
      );
    }
  }

  Future<void> _forward(String id) async {
    final db = ref.read(dbProvider).valueOrNull;
    if (db == null) return;

    await db.enqueueOutbox(
      mailbox: 'dak_inbox',
      operation: 'forward',
      entityId: id,
      payload: {'id': id, 'action': 'forward'},
    );

    ref.read(syncEngineProvider)?.syncMailbox('dak_inbox');

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Forwarded — syncing')),
      );
    }
  }

  Color _priorityColor(String priority) {
    switch (priority.toLowerCase()) {
      case 'urgent':
        return const Color(0xFFEF4444);
      case 'immediate':
        return const Color(0xFFDC2626);
      default:
        return const Color(0xFF6B7280);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('DAK Inbox'),
        actions: [
          Semantics(
            label: 'Refresh DAK inbox',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadDak,
            ),
          ),
        ],
      ),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading && _items.isEmpty) return const SkeletonList();

    if (_error != null && _items.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _loadDak);
    }

    if (_items.isEmpty) {
      return const _EmptyState(
        icon: Icons.mail_outline,
        message: 'No DAK items in inbox',
      );
    }

    final theme = Theme.of(context);

    return Column(
      children: [
        // Offline banner
        if (_isOffline)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: Colors.orange.shade100,
            child: Row(
              children: [
                Icon(Icons.cloud_off,
                    size: 16, color: Colors.orange.shade800),
                const SizedBox(width: 8),
                Text(
                  'Offline — showing cached items',
                  style:
                      TextStyle(fontSize: 12, color: Colors.orange.shade800),
                ),
              ],
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadDak,
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: 16, top: 8),
              itemCount: _items.length,
              itemBuilder: (ctx, i) {
                final item = _items[i];
                final priority =
                    item['priority'] as String? ?? 'routine';
                final status = item['status'] as String? ?? 'pending';

                return Card(
                  margin: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 6),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item['subject'] as String? ?? 'No subject',
                                style: theme.textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w600),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color:
                                    _priorityColor(priority).withOpacity(0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                priority.toUpperCase(),
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                  color: _priorityColor(priority),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Icon(Icons.person_outline,
                                size: 14, color: theme.colorScheme.outline),
                            const SizedBox(width: 4),
                            Text(
                              item['from'] as String? ?? '—',
                              style: TextStyle(
                                  fontSize: 12,
                                  color: theme.colorScheme.outline),
                            ),
                            const Spacer(),
                            Icon(Icons.calendar_today,
                                size: 14, color: theme.colorScheme.outline),
                            const SizedBox(width: 4),
                            Text(
                              item['receivedAt'] as String? ?? '—',
                              style: TextStyle(
                                  fontSize: 12,
                                  color: theme.colorScheme.outline),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            StatusPill(status: status),
                            const Spacer(),
                            Semantics(
                              label: 'Mark as read',
                              child: TextButton.icon(
                                onPressed: status == 'pending'
                                    ? () =>
                                        _markAsRead(item['id'] as String)
                                    : null,
                                icon: const Icon(Icons.done, size: 16),
                                label: const Text('Read'),
                              ),
                            ),
                            Semantics(
                              label: 'Forward DAK item',
                              child: TextButton.icon(
                                onPressed: () =>
                                    _forward(item['id'] as String),
                                icon: const Icon(Icons.forward, size: 16),
                                label: const Text('Forward'),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
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
        Icon(icon,
            size: 64, color: Theme.of(context).colorScheme.outlineVariant),
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
          Text('Unable to load DAK inbox',
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
