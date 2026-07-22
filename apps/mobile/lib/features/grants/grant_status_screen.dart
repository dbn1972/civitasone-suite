import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/skeleton_card.dart';

/// Grant Application Status screen (read-only for applicants).
/// Citizens/applicants check their grant application status.
class GrantStatusScreen extends ConsumerStatefulWidget {
  const GrantStatusScreen({super.key});

  @override
  ConsumerState<GrantStatusScreen> createState() =>
      _GrantStatusScreenState();
}

class _GrantStatusScreenState extends ConsumerState<GrantStatusScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _applications = [];
  Map<String, dynamic>? _selectedApp;
  List<Map<String, dynamic>> _timeline = [];

  @override
  void initState() {
    super.initState();
    _loadApplications();
  }

  Future<void> _loadApplications() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get(
        '/api/v1/grants/applications',
        params: {'applicantId': 'me'},
      );
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _applications = list.cast<Map<String, dynamic>>();
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

  void _selectApplication(Map<String, dynamic> app) {
    final timeline = (app['timeline'] as List?)
            ?.cast<Map<String, dynamic>>() ??
        [];
    setState(() {
      _selectedApp = app;
      _timeline = timeline;
    });
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'approved':
      case 'disbursed':
        return const Color(0xFF15803D);
      case 'rejected':
        return const Color(0xFFEF4444);
      case 'under_review':
        return const Color(0xFFF59E0B);
      default:
        return const Color(0xFF6B7280);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_selectedApp != null) return _buildDetailView(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Grant Applications'),
        actions: [
          Semantics(
            label: 'Refresh applications',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadApplications,
            ),
          ),
        ],
      ),
      body: _buildList(context),
    );
  }

  Widget _buildList(BuildContext context) {
    if (_loading) return const SkeletonList();
    if (_error != null && _applications.isEmpty) {
      return _ErrorState(
        message: _error!, onRetry: _loadApplications);
    }
    if (_applications.isEmpty) {
      return const _EmptyState(
        icon: Icons.card_giftcard,
        message: 'No grant applications found',
      );
    }

    final theme = Theme.of(context);
    return Column(
      children: [
        if (_isOffline)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 8),
            color: Colors.orange.shade100,
            child: Row(children: [
              Icon(Icons.cloud_off,
                  size: 16, color: Colors.orange.shade800),
              const SizedBox(width: 8),
              Text('Offline — showing cached data',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.orange.shade800)),
            ]),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadApplications,
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: 16, top: 8),
              itemCount: _applications.length,
              itemBuilder: (ctx, i) {
                final app = _applications[i];
                final status =
                    app['status'] as String? ?? 'submitted';
                return Semantics(
                  label: 'Grant application ${app['reference'] ?? ''}',
                  child: Card(
                    margin: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 6),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => _selectApplication(app),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [
                              Expanded(
                                child: Text(
                                  app['schemeName'] as String? ??
                                      'Grant Scheme',
                                  style: theme.textTheme.titleMedium
                                      ?.copyWith(
                                        fontWeight: FontWeight.w600),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: _statusColor(status)
                                      .withOpacity(0.1),
                                  borderRadius:
                                      BorderRadius.circular(4),
                                ),
                                child: Text(
                                  status.replaceAll('_', ' ')
                                      .toUpperCase(),
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                    color: _statusColor(status),
                                  ),
                                ),
                              ),
                            ]),
                            const SizedBox(height: 8),
                            Row(children: [
                              Text(
                                'Ref: ${app['reference'] ?? '—'}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: theme.colorScheme.outline,
                                  fontFamily: 'monospace',
                                ),
                              ),
                              const Spacer(),
                              if (app['amount'] != null)
                                Text(
                                  '₹${app['amount']}',
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
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDetailView(BuildContext context) {
    final theme = Theme.of(context);
    final app = _selectedApp!;
    final status = app['status'] as String? ?? 'submitted';

    return Scaffold(
      appBar: AppBar(
        title: Text(app['reference'] as String? ?? 'Application'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => setState(() => _selectedApp = null),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Summary card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(app['schemeName'] as String? ?? '—',
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  _infoRow('Reference', app['reference'] as String? ?? '—'),
                  _infoRow('Status', status.replaceAll('_', ' ')),
                  if (app['amount'] != null)
                    _infoRow('Amount', '₹${app['amount']}'),
                  if (app['appliedDate'] != null)
                    _infoRow('Applied', app['appliedDate'] as String),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Timeline
          Text('Timeline',
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),

          if (_timeline.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No timeline data available',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF6B7280))),
            )
          else
            ..._timeline.asMap().entries.map((entry) {
              final t = entry.value;
              final isLast = entry.key == _timeline.length - 1;
              return _TimelineItem(
                status: t['status'] as String? ?? '',
                date: t['date'] as String? ?? '—',
                note: t['note'] as String?,
                isLast: isLast,
                color: _statusColor(
                  t['status'] as String? ?? 'submitted'),
              );
            }),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(children: [
        SizedBox(
          width: 100,
          child: Text(label,
              style: const TextStyle(
                fontSize: 12, color: Color(0xFF6B7280))),
        ),
        Expanded(
          child: Text(value,
              style: const TextStyle(
                fontSize: 14, fontWeight: FontWeight.w500)),
        ),
      ]),
    );
  }
}

class _TimelineItem extends StatelessWidget {
  const _TimelineItem({
    required this.status,
    required this.date,
    this.note,
    required this.isLast,
    required this.color,
  });
  final String status;
  final String date;
  final String? note;
  final bool isLast;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color,
              ),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 48,
                color: color.withOpacity(0.3),
              ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  status.replaceAll('_', ' ').toUpperCase(),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: color,
                  ),
                ),
                Text(date,
                    style: const TextStyle(
                      fontSize: 11, color: Color(0xFF6B7280))),
                if (note != null) ...[
                  const SizedBox(height: 4),
                  Text(note!,
                      style: const TextStyle(fontSize: 13)),
                ],
              ],
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
            size: 64,
            color: Theme.of(context).colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(message,
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(
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
          Text('Unable to load applications',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12, color: Color(0xFF94A3B8))),
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
