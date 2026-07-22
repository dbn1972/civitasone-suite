import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';
import '../../core/widgets/skeleton_card.dart';

/// Court Cases & Hearing Reminders screen.
/// Legal officers see upcoming court dates and case status.
class CourtCasesScreen extends ConsumerStatefulWidget {
  const CourtCasesScreen({super.key});

  @override
  ConsumerState<CourtCasesScreen> createState() => _CourtCasesScreenState();
}

class _CourtCasesScreenState extends ConsumerState<CourtCasesScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  List<Map<String, dynamic>> _cases = [];
  Map<String, dynamic>? _selectedCase;
  List<Map<String, dynamic>> _hearings = [];
  bool _loadingHearings = false;

  @override
  void initState() {
    super.initState();
    _loadCases();
  }

  Future<void> _loadCases() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/legal/cases');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);

      if (mounted) {
        setState(() {
          _cases = list.cast<Map<String, dynamic>>();
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      // Try local cache
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities('court_cases');
        if (cached.isNotEmpty && mounted) {
          setState(() {
            _cases = cached
                .map((e) => e['data'] as Map<String, dynamic>)
                .toList();
            _isOffline = true;
            _loading = false;
          });
          return;
        }
      }
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
          _isOffline = true;
        });
      }
    }
  }

  Future<void> _loadHearings(Map<String, dynamic> caseData) async {
    setState(() {
      _selectedCase = caseData;
      _loadingHearings = true;
      _hearings = [];
    });
    try {
      final api = ref.read(apiClientProvider);
      final caseId = caseData['id'] as String;
      final response = await api.get(
        '/api/v1/legal/cases/$caseId/hearings',
      );
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _hearings = list.cast<Map<String, dynamic>>();
          _loadingHearings = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loadingHearings = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load hearings: $e')),
        );
      }
    }
  }

  bool _isOverdue(String? dateStr) {
    if (dateStr == null) return false;
    try {
      final date = DateTime.parse(dateStr);
      return date.isBefore(DateTime.now());
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_selectedCase != null) {
      return _buildDetailView(context);
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Court Cases'),
        actions: [
          Semantics(
            label: 'Refresh court cases',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadCases,
            ),
          ),
        ],
      ),
      body: _buildCasesList(context),
    );
  }

  Widget _buildCasesList(BuildContext context) {
    if (_loading) return const SkeletonList();

    if (_error != null && _cases.isEmpty) {
      return _ErrorState(message: _error!, onRetry: _loadCases);
    }

    if (_cases.isEmpty) {
      return const _EmptyState(
        icon: Icons.gavel,
        message: 'No active court cases',
      );
    }

    final theme = Theme.of(context);

    return Column(
      children: [
        if (_isOffline)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 8,
            ),
            color: Colors.orange.shade100,
            child: Row(children: [
              Icon(Icons.cloud_off,
                  size: 16, color: Colors.orange.shade800),
              const SizedBox(width: 8),
              Text('Offline — showing cached data',
                  style: TextStyle(
                    fontSize: 12, color: Colors.orange.shade800)),
            ]),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadCases,
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: 16, top: 8),
              itemCount: _cases.length,
              itemBuilder: (ctx, i) {
                final c = _cases[i];
                final nextHearing =
                    c['nextHearingDate'] as String?;
                final overdue = _isOverdue(nextHearing);

                return Semantics(
                  label: 'Case ${c['caseNumber'] ?? ''}. '
                      '${overdue ? 'Overdue hearing.' : ''}',
                  child: Card(
                    margin: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 6,
                    ),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => _loadHearings(c),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [
                              Expanded(
                                child: Text(
                                  c['caseNumber'] as String? ?? '—',
                                  style: theme.textTheme.titleMedium
                                      ?.copyWith(
                                        fontWeight: FontWeight.w600),
                                ),
                              ),
                              StatusPill(
                                status: c['status'] as String? ??
                                    'active',
                              ),
                            ]),
                            const SizedBox(height: 6),
                            Row(children: [
                              Icon(Icons.account_balance,
                                  size: 14,
                                  color: theme.colorScheme.outline),
                              const SizedBox(width: 4),
                              Text(
                                c['court'] as String? ?? '—',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: theme.colorScheme.outline,
                                ),
                              ),
                            ]),
                            const SizedBox(height: 6),
                            Row(children: [
                              Icon(
                                Icons.event,
                                size: 14,
                                color: overdue
                                    ? const Color(0xFFEF4444)
                                    : theme.colorScheme.outline,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                'Next: ${nextHearing ?? '—'}',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: overdue
                                      ? FontWeight.w600
                                      : FontWeight.normal,
                                  color: overdue
                                      ? const Color(0xFFEF4444)
                                      : theme.colorScheme.outline,
                                ),
                              ),
                              if (overdue) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 6, vertical: 2,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFEF4444)
                                        .withOpacity(0.1),
                                    borderRadius:
                                        BorderRadius.circular(4),
                                  ),
                                  child: const Text(
                                    'OVERDUE',
                                    style: TextStyle(
                                      fontSize: 9,
                                      fontWeight: FontWeight.w700,
                                      color: Color(0xFFEF4444),
                                    ),
                                  ),
                                ),
                              ],
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
    final c = _selectedCase!;

    return Scaffold(
      appBar: AppBar(
        title: Text(c['caseNumber'] as String? ?? 'Case Details'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => setState(() => _selectedCase = null),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Case info card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _infoRow('Case Number', c['caseNumber'] as String? ?? '—'),
                  _infoRow('Court', c['court'] as String? ?? '—'),
                  _infoRow('Status', c['status'] as String? ?? '—'),
                  _infoRow(
                    'Next Hearing',
                    c['nextHearingDate'] as String? ?? '—',
                  ),
                  if (c['lastOrder'] != null)
                    _infoRow('Last Order', c['lastOrder'] as String),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Hearing History',
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          if (_loadingHearings)
            const Center(child: CircularProgressIndicator())
          else if (_hearings.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No hearing records',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF6B7280))),
            )
          else
            ..._hearings.map((h) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: Icon(
                      Icons.event_note,
                      color: _isOverdue(h['date'] as String?)
                          ? const Color(0xFFEF4444)
                          : theme.colorScheme.primary,
                    ),
                    title: Text(h['date'] as String? ?? '—'),
                    subtitle: Text(
                      h['purpose'] as String? ??
                          h['notes'] as String? ??
                          '',
                    ),
                    trailing: StatusPill(
                      status: h['outcome'] as String? ?? 'scheduled',
                    ),
                  ),
                )),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label,
                style: const TextStyle(
                  fontSize: 12, color: Color(0xFF6B7280))),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(
                  fontSize: 14, fontWeight: FontWeight.w500)),
          ),
        ],
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
          Text('Unable to load cases',
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
