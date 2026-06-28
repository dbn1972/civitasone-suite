import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Goals / OKR tracking — set goals, track progress, check-in.
/// GET /v1/hrms/goals
/// POST /v1/hrms/goals/:id/checkin
class GoalsScreen extends ConsumerStatefulWidget {
  const GoalsScreen({super.key});

  @override
  ConsumerState<GoalsScreen> createState() => _GoalsScreenState();
}

class _GoalsScreenState extends ConsumerState<GoalsScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _goals = [];

  @override
  void initState() {
    super.initState();
    _fetchGoals();
  }

  Future<void> _fetchGoals() async {
    setState(() { _loading = true; _error = null; });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>('/v1/hrms/goals', params: {'status': 'all'});
      _goals = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (e) { _error = e.toString(); }
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _checkin(String goalId, int progress) async {
    final controller = TextEditingController();
    final result = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Progress Check-in'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Update progress: $progress%'),
          Slider(
            value: progress.toDouble(),
            min: 0, max: 100, divisions: 20,
            label: '$progress%',
            onChanged: (v) {},
          ),
          TextField(controller: controller, decoration: const InputDecoration(hintText: 'Note (optional)'), maxLines: 2),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, progress), child: const Text('Save')),
        ],
      ),
    );
    if (result == null) return;
    try {
      final apiClient = ref.read(apiClientProvider);
      await apiClient.post<Map<String, dynamic>>('/v1/hrms/goals/$goalId/checkin', data: {'progress': result, 'note': controller.text});
      _fetchGoals();
      if (mounted && result >= 100) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('🎉 Goal completed! +50 points'), backgroundColor: Color(0xFF15803D)));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final active = _goals.where((g) => g['status'] == 'active').toList();
    final completed = _goals.where((g) => g['status'] == 'completed').toList();

    return Scaffold(
      appBar: AppBar(title: const Text('My Goals')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: FilledButton.icon(onPressed: _fetchGoals, icon: const Icon(Icons.refresh), label: const Text('Retry')))
              : RefreshIndicator(
                  onRefresh: _fetchGoals,
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                    // Summary
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)]),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                        _StatCol(value: '${active.length}', label: 'Active'),
                        Container(width: 1, height: 40, color: Colors.white30),
                        _StatCol(value: '${completed.length}', label: 'Completed'),
                        Container(width: 1, height: 40, color: Colors.white30),
                        _StatCol(value: '${_avgProgress(active)}%', label: 'Avg Progress'),
                      ]),
                    ),
                    const SizedBox(height: 20),

                    if (active.isNotEmpty) ...[
                      Text('Active Goals', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      ...active.map((g) => _GoalCard(goal: g, onCheckin: _checkin)),
                    ],
                    if (completed.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      Text('Completed', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      ...completed.map((g) => _GoalCard(goal: g, onCheckin: _checkin)),
                    ],
                    if (_goals.isEmpty)
                      Center(child: Padding(padding: const EdgeInsets.only(top: 40), child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.flag, size: 64, color: theme.colorScheme.outlineVariant),
                        const SizedBox(height: 16),
                        Text('No goals set', style: theme.textTheme.bodyLarge),
                        const SizedBox(height: 8),
                        Text('Set goals to track your growth', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                      ]))),
                  ]),
                ),
    );
  }

  int _avgProgress(List<Map<String, dynamic>> goals) {
    if (goals.isEmpty) return 0;
    final total = goals.fold<int>(0, (sum, g) => sum + ((g['progress'] as num?)?.toInt() ?? 0));
    return total ~/ goals.length;
  }
}

class _StatCol extends StatelessWidget {
  const _StatCol({required this.value, required this.label});
  final String value;
  final String label;
  @override
  Widget build(BuildContext context) => Column(children: [
    Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white)),
    Text(label, style: const TextStyle(fontSize: 11, color: Colors.white70)),
  ]);
}

class _GoalCard extends StatelessWidget {
  const _GoalCard({required this.goal, required this.onCheckin});
  final Map<String, dynamic> goal;
  final Future<void> Function(String id, int progress) onCheckin;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = goal['title'] as String? ?? '';
    final progress = (goal['progress'] as num?)?.toInt() ?? 0;
    final status = goal['status'] as String? ?? 'active';
    final category = goal['category'] as String? ?? '';
    final dueDate = goal['dueDate'] as String? ?? goal['due_date'] as String? ?? '';
    final isCompleted = status == 'completed';

    final progressColor = isCompleted ? const Color(0xFF22C55E) : const Color(0xFF6366F1);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        onTap: isCompleted ? null : () => onCheckin(goal['id'] as String, progress),
        borderRadius: BorderRadius.circular(14),
        child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600))),
            Text('$progress%', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: progressColor)),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            if (category.isNotEmpty) ...[
              Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2), decoration: BoxDecoration(color: const Color(0xFF6366F1).withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                child: Text(category, style: const TextStyle(fontSize: 10, color: Color(0xFF6366F1)))),
              const SizedBox(width: 8),
            ],
            if (dueDate.isNotEmpty) Text('Due: $dueDate', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          ]),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: progress / 100, backgroundColor: progressColor.withOpacity(0.1), valueColor: AlwaysStoppedAnimation(progressColor), minHeight: 8),
          ),
          if (!isCompleted) ...[
            const SizedBox(height: 8),
            Text('Tap to update progress', style: TextStyle(fontSize: 11, color: theme.colorScheme.outline)),
          ],
        ])),
      ),
    );
  }
}
