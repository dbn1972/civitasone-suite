import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// Work Proposals list — shows all works with status filter, pull-to-refresh.
class WorkProposalsScreen extends ConsumerStatefulWidget {
  const WorkProposalsScreen({super.key});

  @override
  ConsumerState<WorkProposalsScreen> createState() => _WorkProposalsScreenState();
}

class _WorkProposalsScreenState extends ConsumerState<WorkProposalsScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _proposals = [];
  String _statusFilter = 'all';

  static const _statuses = ['all', 'draft', 'dao_finalized', 'ts_eligible', 'approved'];

  @override
  void initState() {
    super.initState();
    _loadProposals();
  }

  Future<void> _loadProposals() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/works/proposals');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _proposals = list.cast<Map<String, dynamic>>();
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
          _isOffline = true;
        });
      }
    }
  }

  List<Map<String, dynamic>> get _filteredProposals {
    if (_statusFilter == 'all') return _proposals;
    return _proposals.where((p) =>
      (p['status'] as String?)?.toLowerCase() == _statusFilter,
    ).toList();
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'approved':
        return const Color(0xFF15803D);
      case 'dao_finalized':
        return const Color(0xFF3B82F6);
      case 'ts_eligible':
        return const Color(0xFF6366F1);
      case 'draft':
        return const Color(0xFF6B7280);
      default:
        return const Color(0xFF6B7280);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Work Proposals'),
        actions: [
          Semantics(
            label: 'Refresh proposals',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadProposals,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_isOffline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(children: [
                Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade800),
                const SizedBox(width: 8),
                Text('Offline — showing cached data',
                    style: TextStyle(fontSize: 12, color: Colors.orange.shade800)),
              ]),
            ),
          // Status filter chips
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              children: _statuses.map((s) {
                final selected = _statusFilter == s;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(s == 'all' ? 'All' : s.replaceAll('_', ' ').toUpperCase(),
                        style: const TextStyle(fontSize: 11)),
                    selected: selected,
                    onSelected: (_) => setState(() => _statusFilter = s),
                  ),
                );
              }).toList(),
            ),
          ),
          Expanded(child: _buildBody(theme)),
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) return const SkeletonList();
    if (_error != null && _proposals.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _loadProposals);
    }
    if (_filteredProposals.isEmpty) {
      return const _EmptyState(
        icon: Icons.description,
        message: 'No work proposals found',
      );
    }

    return RefreshIndicator(
      onRefresh: _loadProposals,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 16),
        itemCount: _filteredProposals.length,
        itemBuilder: (ctx, i) {
          final p = _filteredProposals[i];
          final status = p['status'] as String? ?? 'draft';
          return Semantics(
            label: 'Work ${p['workNumber'] ?? ''}',
            child: Card(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text(
                          p['workNumber'] as String? ?? '—',
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: _statusColor(status).withOpacity(0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          status.replaceAll('_', ' ').toUpperCase(),
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: _statusColor(status),
                          ),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 8),
                    Text(
                      p['description'] as String? ?? '—',
                      style: theme.textTheme.bodyMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 8),
                    Row(children: [
                      Text(
                        p['category'] as String? ?? '—',
                        style: TextStyle(fontSize: 12, color: theme.colorScheme.outline),
                      ),
                      const Spacer(),
                      if (p['estimatedCost'] != null)
                        Text(
                          '₹${p['estimatedCost']}',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                    ]),
                  ],
                ),
              ),
            ),
          );
        },
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
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.outline)),
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
          Text('Unable to load proposals',
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
