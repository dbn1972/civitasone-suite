import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers.dart';

/// Job vacancies screen — internal + public vacancies.
/// Employees can view open positions, apply, and share with friends.
/// GET /v1/hrms/vacancies (internal view)
/// GET /v1/careers/vacancies (public view — same data, no auth)
class VacanciesScreen extends ConsumerStatefulWidget {
  const VacanciesScreen({super.key});

  @override
  ConsumerState<VacanciesScreen> createState() => _VacanciesScreenState();
}

class _VacanciesScreenState extends ConsumerState<VacanciesScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _vacancies = [];
  String _filterType = 'all';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _fetchVacancies();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchVacancies() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>(
        '/v1/hrms/vacancies',
      );
      final data = (res.data?['data'] as List<dynamic>?) ?? [];
      _vacancies = data.cast<Map<String, dynamic>>();
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filteredVacancies {
    if (_filterType == 'all') return _vacancies;
    return _vacancies
        .where((v) => v['vacancyType'] == _filterType)
        .toList();
  }

  List<Map<String, dynamic>> get _internalVacancies =>
      _vacancies.where((v) => v['internal'] == true).toList();

  List<Map<String, dynamic>> get _myApplications =>
      _vacancies.where((v) => v['applied'] == true).toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Job Vacancies'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchVacancies,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'All Open'),
            Tab(text: 'Internal'),
            Tab(text: 'My Applications'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError()
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildVacancyList(_filteredVacancies),
                    _buildVacancyList(_internalVacancies),
                    _buildApplicationsList(),
                  ],
                ),
    );
  }

  Widget _buildVacancyList(List<Map<String, dynamic>> vacancies) {
    final theme = Theme.of(context);

    if (vacancies.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.work_off, size: 64,
                color: theme.colorScheme.outlineVariant),
            const SizedBox(height: 16),
            Text('No open vacancies', style: theme.textTheme.bodyLarge),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchVacancies,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Type filter chips
          _buildFilterChips(theme),
          const SizedBox(height: 12),
          // Vacancy cards
          ...vacancies.map((v) => _VacancyCard(
                vacancy: v,
                onApply: () => _applyForVacancy(v),
                onShare: () => _shareVacancy(v),
              )),
        ],
      ),
    );
  }

  Widget _buildFilterChips(ThemeData theme) {
    const filters = [
      ('all', 'All'),
      ('regular', 'Regular'),
      ('contractual', 'Contractual'),
      ('deputation', 'Deputation'),
      ('internship', 'Internship'),
      ('apprenticeship', 'Apprenticeship'),
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: filters.map((f) {
          final selected = _filterType == f.$1;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              label: Text(f.$2),
              selected: selected,
              onSelected: (_) => setState(() => _filterType = f.$1),
              selectedColor: theme.colorScheme.primary.withOpacity(0.15),
              checkmarkColor: theme.colorScheme.primary,
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildApplicationsList() {
    final theme = Theme.of(context);
    final apps = _myApplications;

    if (apps.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.assignment, size: 64,
                color: theme.colorScheme.outlineVariant),
            const SizedBox(height: 16),
            Text('No applications yet', style: theme.textTheme.bodyLarge),
            const SizedBox(height: 8),
            Text('Apply for a vacancy to track it here',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.outline)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: apps.length,
      itemBuilder: (ctx, i) {
        final v = apps[i];
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: theme.colorScheme.primary.withOpacity(0.1),
              child: Icon(Icons.check, color: theme.colorScheme.primary),
            ),
            title: Text(v['title'] as String? ?? 'Position'),
            subtitle: Text(
                'Applied on ${v['appliedAt'] ?? '—'} • ${v['applicationStatus'] ?? 'Under Review'}'),
            trailing: _applicationStatusChip(
                v['applicationStatus'] as String? ?? 'submitted'),
          ),
        );
      },
    );
  }

  Widget _applicationStatusChip(String status) {
    final theme = Theme.of(context);
    Color color;
    switch (status) {
      case 'shortlisted':
        color = theme.colorScheme.primary;
        break;
      case 'rejected':
        color = theme.colorScheme.error;
        break;
      case 'interview':
        color = theme.colorScheme.tertiary;
        break;
      default:
        color = theme.colorScheme.primary;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(
            fontSize: 10, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }

  Future<void> _applyForVacancy(Map<String, dynamic> vacancy) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Apply for this position?'),
        content: Text(
            'You are about to apply for "${vacancy['title']}". Your employee profile and resume will be shared with the recruitment team.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Apply Now')),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      final apiClient = ref.read(apiClientProvider);
      await apiClient.post<Map<String, dynamic>>(
        '/v1/hrms/vacancies/${vacancy['id']}/apply',
        data: {},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Application submitted successfully!'),
            backgroundColor: Color(0xFF15803D),
          ),
        );
        _fetchVacancies(); // Refresh to show in "My Applications"
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: Theme.of(context).colorScheme.error),
        );
      }
    }
  }

  Future<void> _shareVacancy(Map<String, dynamic> vacancy) async {
    final title = vacancy['title'] as String? ?? 'Job Opening';
    final dept = vacancy['department'] as String? ?? '';
    final type = vacancy['vacancyType'] as String? ?? '';
    final id = vacancy['id'] as String? ?? '';

    // Deep link to public careers page
    final shareUrl = 'https://careers.civitasone.gov.in/vacancy/$id';
    final shareText = '🏛️ $title\n'
        '📍 $dept\n'
        '📋 Type: $type\n\n'
        'Apply here: $shareUrl\n\n'
        '#GovtJobs #CivitasOne';

    // Show share bottom sheet with options
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      builder: (ctx) => _ShareSheet(shareText: shareText, url: shareUrl),
    );
  }

  Widget _buildError() {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.wifi_off, size: 64, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text('Unable to load vacancies',
                style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!,
                style:
                    TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchVacancies,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Individual vacancy card with apply + share actions.
class _VacancyCard extends StatelessWidget {
  const _VacancyCard({
    required this.vacancy,
    required this.onApply,
    required this.onShare,
  });

  final Map<String, dynamic> vacancy;
  final VoidCallback onApply;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = vacancy['title'] as String? ?? 'Position';
    final dept = vacancy['department'] as String? ?? '';
    final location = vacancy['location'] as String? ?? '';
    final type = vacancy['vacancyType'] as String? ?? 'regular';
    final positions = vacancy['positions'] as int? ?? 1;
    final lastDate = vacancy['lastDate'] as String? ?? '';
    final payLevel = vacancy['payLevel'] as String? ?? '';
    final applied = vacancy['applied'] == true;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: _typeColor(theme, type).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(_typeIcon(type),
                      color: _typeColor(theme, type), size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: theme.textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(Icons.business, size: 12,
                              color: theme.colorScheme.outline),
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(dept,
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.outline),
                                overflow: TextOverflow.ellipsis),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                // Share button
                IconButton(
                  onPressed: onShare,
                  icon: const Icon(Icons.share),
                  tooltip: 'Share with friends',
                  style: IconButton.styleFrom(
                    backgroundColor:
                        theme.colorScheme.primary.withOpacity(0.05),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Meta chips
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _MetaChip(
                    icon: Icons.location_on, label: location, color: theme.colorScheme.tertiary),
                _MetaChip(
                    icon: Icons.people, label: '$positions posts', color: theme.colorScheme.primary),
                _MetaChip(
                    icon: Icons.badge, label: type, color: _typeColor(theme, type)),
                if (payLevel.isNotEmpty)
                  _MetaChip(
                      icon: Icons.payments, label: payLevel, color: theme.colorScheme.tertiary),
              ],
            ),

            if (lastDate.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: theme.colorScheme.error.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: theme.colorScheme.error.withOpacity(0.2)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.timer, size: 14,
                        color: theme.colorScheme.error),
                    const SizedBox(width: 6),
                    Text(
                      'Last date: $lastDate',
                      style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.error,
                          fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 16),

            // Action row
            Row(
              children: [
                Expanded(
                  child: applied
                      ? OutlinedButton.icon(
                          onPressed: null,
                          icon: const Icon(Icons.check, size: 18),
                          label: const Text('Applied'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: theme.colorScheme.primary,
                            side: BorderSide(color: theme.colorScheme.primary),
                          ),
                        )
                      : FilledButton.icon(
                          onPressed: onApply,
                          icon: const Icon(Icons.send, size: 18),
                          label: const Text('Apply Now'),
                        ),
                ),
                const SizedBox(width: 12),
                OutlinedButton.icon(
                  onPressed: onShare,
                  icon: const Icon(Icons.share, size: 18),
                  label: const Text('Share'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Color _typeColor(ThemeData theme, String type) {
    switch (type) {
      case 'regular':
        return theme.colorScheme.primary;
      case 'contractual':
        return theme.colorScheme.tertiary;
      case 'deputation':
        return theme.colorScheme.primary;
      case 'internship':
        return theme.colorScheme.tertiary;
      case 'apprenticeship':
        return theme.colorScheme.secondary;
      default:
        return theme.colorScheme.onSurfaceVariant;
    }
  }

  IconData _typeIcon(String type) {
    switch (type) {
      case 'regular':
        return Icons.work;
      case 'contractual':
        return Icons.assignment;
      case 'deputation':
        return Icons.swap_horiz;
      case 'internship':
        return Icons.school;
      case 'apprenticeship':
        return Icons.engineering;
      default:
        return Icons.work_outline;
    }
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    if (label.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(
                  fontSize: 11, color: color, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

/// Bottom sheet for sharing vacancy via WhatsApp, SMS, Email, Copy Link.
class _ShareSheet extends StatelessWidget {
  const _ShareSheet({required this.shareText, required this.url});
  final String shareText;
  final String url;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Share this vacancy',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text('Help someone find their next role',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.outline)),
          const SizedBox(height: 20),

          // Share options
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _ShareOption(
                icon: Icons.message,
                label: 'WhatsApp',
                color: const Color(0xFF25D366),
                onTap: () {
                  // In production: url_launcher with whatsapp:// scheme
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Opening WhatsApp…')),
                  );
                },
              ),
              _ShareOption(
                icon: Icons.sms,
                label: 'SMS',
                color: theme.colorScheme.primary,
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Opening SMS…')),
                  );
                },
              ),
              _ShareOption(
                icon: Icons.email,
                label: 'Email',
                color: theme.colorScheme.error,
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Opening Email…')),
                  );
                },
              ),
              _ShareOption(
                icon: Icons.copy,
                label: 'Copy Link',
                color: theme.colorScheme.onSurfaceVariant,
                onTap: () {
                  // In production: Clipboard.setData(ClipboardData(text: url))
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Link copied to clipboard!'),
                      backgroundColor: Color(0xFF15803D),
                    ),
                  );
                },
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Preview of share text
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              shareText,
              style: theme.textTheme.bodySmall?.copyWith(
                fontFamily: 'monospace',
                fontSize: 11,
              ),
              maxLines: 5,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

class _ShareOption extends StatelessWidget {
  const _ShareOption({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(height: 8),
          Text(label,
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: color)),
        ],
      ),
    );
  }
}
