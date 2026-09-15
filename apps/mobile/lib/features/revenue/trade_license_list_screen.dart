import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:dio/dio.dart';
import '../../core/providers.dart';
import '../../core/error_utils.dart';
import '../../core/widgets/status_pill.dart';
import 'models.dart';

/// Trade License list — revenue officers/collectors look up a municipal
/// business's license status and dues while out in the field.
///
/// GET /v1/revenue/trade-licenses -> list of licenses for the tenant.
/// Read-only in this first mobile slice: issue/renew/cancel/record-payment
/// stay web-only for now (see COMP-008 roadmap in this PR's description).
class TradeLicenseListScreen extends ConsumerStatefulWidget {
  const TradeLicenseListScreen({super.key});

  @override
  ConsumerState<TradeLicenseListScreen> createState() =>
      _TradeLicenseListScreenState();
}

class _TradeLicenseListScreenState
    extends ConsumerState<TradeLicenseListScreen> {
  bool _loading = true;
  String? _error;
  List<TradeLicense> _licenses = [];
  bool _isOnline = true;
  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _searchCtrl.addListener(() {
      setState(() => _query = _searchCtrl.text.trim().toLowerCase());
    });
    _fetchLicenses();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchLicenses() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/revenue/trade-licenses',
        params: {'limit': 100},
      );
      final data = res.data?['data'] as List<dynamic>? ?? [];
      _licenses = data
          .cast<Map<String, dynamic>>()
          .map(TradeLicense.fromJson)
          .toList();
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

  List<TradeLicense> get _filtered {
    if (_query.isEmpty) return _licenses;
    return _licenses.where((l) {
      return l.businessName.toLowerCase().contains(_query) ||
          l.licenseNo.toLowerCase().contains(_query) ||
          l.proprietorName.toLowerCase().contains(_query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final visible = _filtered;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Trade Licenses'),
        actions: [
          Semantics(
            label: 'Refresh trade licenses',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.refresh),
              onPressed: _fetchLicenses,
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
          if (!_loading && _error == null && _licenses.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: TextField(
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: 'Search business, proprietor, or license no.',
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

  Widget _buildBody(ThemeData theme, List<TradeLicense> visible) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _licenses.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _fetchLicenses);
    }
    if (_licenses.isEmpty) {
      return const _EmptyState(
        icon: Icons.storefront_outlined,
        title: 'No trade licenses found',
        subtitle: 'Licenses issued for this tenant will appear here',
      );
    }
    if (visible.isEmpty) {
      return const _EmptyState(
        icon: Icons.search_off,
        title: 'No matches',
        subtitle: 'Try a different business name or license number',
      );
    }
    return RefreshIndicator(
      onRefresh: _fetchLicenses,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: visible.length,
        itemBuilder: (ctx, i) => _LicenseCard(
          license: visible[i],
          onTap: () => context.go('/revenue/trade-licenses/${visible[i].id}'),
        ),
      ),
    );
  }
}

class _LicenseCard extends StatelessWidget {
  const _LicenseCard({required this.license, required this.onTap});
  final TradeLicense license;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final due = license.dueMinor;
    return Semantics(
      label: 'Trade license for ${license.businessName}, '
          'status ${license.status.name}',
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
                          Text(license.businessName,
                              style: theme.textTheme.titleSmall
                                  ?.copyWith(fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text(license.proprietorName,
                              style: theme.textTheme.bodySmall
                                  ?.copyWith(color: theme.colorScheme.outline)),
                        ],
                      ),
                    ),
                    StatusPill(status: license.status.name),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Icon(Icons.badge_outlined,
                        size: 14, color: theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(license.licenseNo,
                        style: TextStyle(
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: theme.colorScheme.outline)),
                    if (license.wardNo != null) ...[
                      const SizedBox(width: 12),
                      Icon(Icons.location_on_outlined,
                          size: 14, color: theme.colorScheme.outline),
                      const SizedBox(width: 4),
                      Text('Ward ${license.wardNo}',
                          style: TextStyle(
                              fontSize: 12, color: theme.colorScheme.outline)),
                    ],
                    const Spacer(),
                    if (due != null)
                      Text(
                        due == BigInt.zero
                            ? 'Paid in full'
                            : 'Due ${formatTradeLicenseAmount(due)}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: due == BigInt.zero
                              ? const Color(0xFF15803D)
                              : theme.colorScheme.error,
                        ),
                      ),
                  ],
                ),
                if (license.isExpiringSoon) ...[
                  const SizedBox(height: 8),
                  Row(children: [
                    Icon(Icons.schedule, size: 14, color: Colors.orange.shade800),
                    const SizedBox(width: 4),
                    Text('Expiring soon',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: Colors.orange.shade800)),
                  ]),
                ],
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
          Text('Unable to load trade licenses', style: theme.textTheme.titleMedium),
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
