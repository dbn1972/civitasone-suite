import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/load_more_footer.dart';
import 'assessee_models.dart';

/// Assessee directory — revenue officers/collectors look up a property or
/// water-connection ratepayer while out in the field.
///
/// GET /v1/revenue/assessees -> paginated list of assessees for the tenant.
/// Read-only in this slice: create/update, and the bills/demands/receipts
/// that hang off an assessee, stay web-only for now (see COMP-008 roadmap
/// in this PR's description).
class AssesseeListScreen extends ConsumerStatefulWidget {
  const AssesseeListScreen({super.key});

  @override
  ConsumerState<AssesseeListScreen> createState() => _AssesseeListScreenState();
}

class _AssesseeListScreenState extends ConsumerState<AssesseeListScreen> {
  static const _pageSize = 100;

  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  List<Assessee> _assessees = [];
  int _total = 0;
  bool _isOnline = true;
  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _searchCtrl.addListener(() {
      setState(() => _query = _searchCtrl.text.trim().toLowerCase());
    });
    _fetchAssessees();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchAssessees() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/revenue/assessees',
        params: {'limit': _pageSize, 'offset': 0},
      );
      final body = res.data ?? const <String, dynamic>{};
      final data = body['data'] as List<dynamic>? ?? [];
      final meta = body['meta'] as Map<String, dynamic>?;
      _assessees =
          data.cast<Map<String, dynamic>>().map(Assessee.fromJson).toList();
      _total = (meta?['total'] as num?)?.toInt() ?? _assessees.length;
      _isOnline = true;
    } catch (e) {
      _error = userFriendlyError(e);
      if (e is DioException && e.type == DioExceptionType.connectionError) {
        _isOnline = false;
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _assessees.length >= _total) return;
    setState(() => _loadingMore = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/revenue/assessees',
        params: {'limit': _pageSize, 'offset': _assessees.length},
      );
      final body = res.data ?? const <String, dynamic>{};
      final data = body['data'] as List<dynamic>? ?? [];
      final meta = body['meta'] as Map<String, dynamic>?;
      final more =
          data.cast<Map<String, dynamic>>().map(Assessee.fromJson).toList();
      setState(() {
        _assessees = [..._assessees, ...more];
        _total = (meta?['total'] as num?)?.toInt() ?? _total;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not load more: ${userFriendlyError(e)}')),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  List<Assessee> get _filtered {
    if (_query.isEmpty) return _assessees;
    return _assessees.where((a) {
      return a.ownerName.toLowerCase().contains(_query) ||
          a.identifierNo.toLowerCase().contains(_query) ||
          a.address.toLowerCase().contains(_query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final visible = _filtered;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Assessees'),
        actions: [
          Semantics(
            label: 'Refresh assessees',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
              onPressed: _fetchAssessees,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (!_isOnline)
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
          if (!_loading && _error == null && _assessees.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: TextField(
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: 'Search owner, identifier no., or address',
                  prefixIcon: const Icon(Icons.search),
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            ),
          Expanded(child: _buildBody(theme, visible)),
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme, List<Assessee> visible) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _assessees.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _fetchAssessees);
    }
    if (_assessees.isEmpty) {
      return const _EmptyState(
        icon: Icons.home_work_outlined,
        title: 'No assessees found',
        subtitle: 'Property and water-connection records for this tenant will appear here',
      );
    }
    if (visible.isEmpty) {
      return const _EmptyState(
        icon: Icons.search_off,
        title: 'No matches',
        subtitle: 'Try a different owner name, identifier, or address',
      );
    }
    final showFooter = _query.isEmpty && _assessees.length < _total;
    return RefreshIndicator(
      onRefresh: _fetchAssessees,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: visible.length + (showFooter ? 1 : 0),
        itemBuilder: (ctx, i) {
          if (i == visible.length) {
            return LoadMoreFooter(
              loaded: _assessees.length,
              total: _total,
              loading: _loadingMore,
              onLoadMore: _loadMore,
            );
          }
          return _AssesseeCard(
            assessee: visible[i],
            onTap: () => context.go('/revenue/assessees/${visible[i].id}'),
          );
        },
      ),
    );
  }
}

class _AssesseeCard extends StatelessWidget {
  const _AssesseeCard({required this.assessee, required this.onTap});
  final Assessee assessee;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: 'Assessee ${assessee.ownerName}, '
          'type ${assesseeTypeLabel(assessee.assesseeType)}',
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(assessee.ownerName,
                              style: theme.textTheme.titleSmall
                                  ?.copyWith(fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text(assessee.address.isEmpty ? '—' : assessee.address,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall
                                  ?.copyWith(color: theme.colorScheme.outline)),
                        ],
                      ),
                    ),
                    StatusPill(status: assesseeTypeLabel(assessee.assesseeType)),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Icon(Icons.badge_outlined,
                        size: 14, color: theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(assessee.identifierNo,
                        style: TextStyle(
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: theme.colorScheme.outline)),
                    if (assessee.wardNo != null) ...[
                      const SizedBox(width: 12),
                      Icon(Icons.location_on_outlined,
                          size: 14, color: theme.colorScheme.outline),
                      const SizedBox(width: 4),
                      Text('Ward ${assessee.wardNo}',
                          style: TextStyle(
                              fontSize: 12, color: theme.colorScheme.outline)),
                    ],
                    const Spacer(),
                    StatusPill(status: assessee.isActive ? 'active' : 'inactive'),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
  });
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 64, color: theme.colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(title, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Text(subtitle,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.outline)),
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
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load assessees', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
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
