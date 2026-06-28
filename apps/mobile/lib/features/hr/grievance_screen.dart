import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';
import '../../core/widgets/status_pill.dart';

/// Grievance filing and tracking screen.
/// Employees can file grievances, track status, and view resolution.
/// POST /v1/hrms/grievances (via outbox for offline)
/// GET /v1/hrms/grievances (list my grievances)
class GrievanceScreen extends ConsumerStatefulWidget {
  const GrievanceScreen({super.key});

  @override
  ConsumerState<GrievanceScreen> createState() => _GrievanceScreenState();
}

class _GrievanceScreenState extends ConsumerState<GrievanceScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(syncEngineProvider)?.syncMailbox('grievances');
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Grievances'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'My Grievances'),
            Tab(text: 'File New'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _GrievanceListTab(),
          const _GrievanceFileTab(),
        ],
      ),
    );
  }
}

class _GrievanceListTab extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dbAsync = ref.watch(dbProvider);
    final theme = Theme.of(context);

    return dbAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Error: $e')),
      data: (db) => FutureBuilder(
        future: db.listEntities('grievances'),
        builder: (ctx, snap) {
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final items = snap.data!;
          if (items.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.sentiment_satisfied_alt,
                      size: 64, color: theme.colorScheme.outlineVariant),
                  const SizedBox(height: 16),
                  Text('No grievances filed',
                      style: theme.textTheme.bodyLarge),
                  const SizedBox(height: 8),
                  Text('Your workplace concerns will appear here',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.outline)),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async {
              await ref.read(syncEngineProvider)?.syncMailbox('grievances');
            },
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              itemBuilder: (ctx, i) {
                final data = items[i]['data'] as Map<String, dynamic>;
                final status = data['status'] as String? ?? 'pending';
                final category = data['category'] as String? ?? '';
                final subject = data['subject'] as String? ?? 'Grievance';
                final filedAt = data['filedAt'] as String? ?? '';
                final syncState =
                    items[i]['sync_state'] as String? ?? 'synced';

                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: _categoryColor(category)
                                    .withOpacity(0.1),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(_categoryIcon(category),
                                  color: _categoryColor(category), size: 20),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(subject,
                                      style: theme.textTheme.titleSmall
                                          ?.copyWith(
                                              fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 2),
                                  Text(category,
                                      style: theme.textTheme.bodySmall
                                          ?.copyWith(
                                              color:
                                                  theme.colorScheme.outline)),
                                ],
                              ),
                            ),
                            StatusPill(status: status),
                          ],
                        ),
                        if (data['description'] != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            data['description'] as String,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.outline),
                          ),
                        ],
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Icon(Icons.access_time,
                                size: 12, color: theme.colorScheme.outline),
                            const SizedBox(width: 4),
                            Text(filedAt.split('T').first,
                                style: TextStyle(
                                    fontSize: 11,
                                    color: theme.colorScheme.outline)),
                            if (syncState == 'queued') ...[
                              const Spacer(),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF59E0B)
                                      .withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.cloud_upload,
                                        size: 10,
                                        color: Color(0xFFF59E0B)),
                                    SizedBox(width: 4),
                                    Text('Syncing',
                                        style: TextStyle(
                                            fontSize: 10,
                                            color: Color(0xFFF59E0B))),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }

  Color _categoryColor(String category) {
    switch (category.toLowerCase()) {
      case 'workplace_safety':
        return const Color(0xFFEF4444);
      case 'harassment':
        return const Color(0xFFDC2626);
      case 'pay_discrepancy':
        return const Color(0xFFF59E0B);
      case 'transfer':
        return const Color(0xFF6366F1);
      case 'promotion':
        return const Color(0xFF8B5CF6);
      case 'facilities':
        return const Color(0xFF06B6D4);
      default:
        return const Color(0xFF64748B);
    }
  }

  IconData _categoryIcon(String category) {
    switch (category.toLowerCase()) {
      case 'workplace_safety':
        return Icons.health_and_safety;
      case 'harassment':
        return Icons.report;
      case 'pay_discrepancy':
        return Icons.payments;
      case 'transfer':
        return Icons.swap_horiz;
      case 'promotion':
        return Icons.trending_up;
      case 'facilities':
        return Icons.business;
      default:
        return Icons.feedback;
    }
  }
}

class _GrievanceFileTab extends ConsumerStatefulWidget {
  const _GrievanceFileTab();

  @override
  ConsumerState<_GrievanceFileTab> createState() => _GrievanceFileTabState();
}

class _GrievanceFileTabState extends ConsumerState<_GrievanceFileTab> {
  final _formKey = GlobalKey<FormState>();
  final _subjectCtrl = TextEditingController();
  final _descriptionCtrl = TextEditingController();
  String _category = 'general';
  String _priority = 'medium';
  bool _anonymous = false;
  bool _submitting = false;

  static const _categories = [
    ('general', 'General'),
    ('workplace_safety', 'Workplace Safety'),
    ('harassment', 'Harassment'),
    ('pay_discrepancy', 'Pay Discrepancy'),
    ('transfer', 'Transfer Related'),
    ('promotion', 'Promotion Related'),
    ('facilities', 'Facilities / Infrastructure'),
    ('leave_policy', 'Leave Policy'),
    ('workload', 'Workload / Overtime'),
    ('other', 'Other'),
  ];

  static const _priorities = [
    ('low', 'Low'),
    ('medium', 'Medium'),
    ('high', 'High'),
    ('critical', 'Critical'),
  ];

  @override
  void dispose() {
    _subjectCtrl.dispose();
    _descriptionCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
    try {
      final db = ref.read(dbProvider).valueOrNull;
      if (db == null) throw Exception('Database not ready');

      final entityId = const Uuid().v4();
      final now = DateTime.now().toUtc().toIso8601String();

      final payload = {
        'entityId': entityId,
        'subject': _subjectCtrl.text.trim(),
        'description': _descriptionCtrl.text.trim(),
        'category': _category,
        'priority': _priority,
        'anonymous': _anonymous,
        'status': 'pending',
        'filedAt': now,
      };

      await db.enqueueOutbox(
        mailbox: 'grievances',
        operation: 'create',
        entityId: entityId,
        payload: payload,
      );

      // Optimistic local insert
      await db.upsertEntity(
        id: entityId,
        mailbox: 'grievances',
        data: payload,
        updatedAt: now,
        syncState: 'queued',
      );

      // Fire-and-forget sync
      ref.read(syncEngineProvider)?.syncMailbox('grievances');

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Grievance filed successfully'),
            backgroundColor: Color(0xFF15803D),
          ),
        );
        _formKey.currentState?.reset();
        _subjectCtrl.clear();
        _descriptionCtrl.clear();
        setState(() {
          _category = 'general';
          _priority = 'medium';
          _anonymous = false;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          // Info card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF6366F1).withOpacity(0.05),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: const Color(0xFF6366F1).withOpacity(0.2)),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline,
                    color: Color(0xFF6366F1), size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Your grievance will be routed to the appropriate authority. '
                    'You can track its status in the "My Grievances" tab.',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: const Color(0xFF6366F1)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Category
          DropdownButtonFormField<String>(
            value: _category,
            decoration: const InputDecoration(
              labelText: 'Category *',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.category),
            ),
            items: _categories
                .map((c) =>
                    DropdownMenuItem(value: c.$1, child: Text(c.$2)))
                .toList(),
            onChanged: (v) => setState(() => _category = v!),
          ),
          const SizedBox(height: 16),

          // Subject
          TextFormField(
            controller: _subjectCtrl,
            decoration: const InputDecoration(
              labelText: 'Subject *',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.short_text),
              hintText: 'Brief summary of your grievance',
            ),
            validator: (v) => (v == null || v.trim().isEmpty)
                ? 'Subject is required'
                : null,
          ),
          const SizedBox(height: 16),

          // Description
          TextFormField(
            controller: _descriptionCtrl,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Description *',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
              hintText:
                  'Provide details about the issue, including dates, people involved, and evidence if any…',
            ),
            validator: (v) => (v == null || v.trim().length < 20)
                ? 'Please provide at least 20 characters of detail'
                : null,
          ),
          const SizedBox(height: 16),

          // Priority
          DropdownButtonFormField<String>(
            value: _priority,
            decoration: const InputDecoration(
              labelText: 'Priority',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.flag),
            ),
            items: _priorities
                .map((p) =>
                    DropdownMenuItem(value: p.$1, child: Text(p.$2)))
                .toList(),
            onChanged: (v) => setState(() => _priority = v!),
          ),
          const SizedBox(height: 16),

          // Anonymous toggle
          SwitchListTile(
            title: const Text('File Anonymously'),
            subtitle: const Text(
                'Your identity will not be revealed to the respondent'),
            value: _anonymous,
            onChanged: (v) => setState(() => _anonymous = v),
            contentPadding: EdgeInsets.zero,
          ),
          const SizedBox(height: 24),

          // Submit
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.send),
            label: Text(_submitting ? 'Submitting…' : 'File Grievance'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
        ],
      ),
    );
  }
}
