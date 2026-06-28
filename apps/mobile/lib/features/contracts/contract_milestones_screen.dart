import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Contract milestones — field inspection officers track completion.
/// GET /v1/contract/milestones
class ContractMilestonesScreen extends ConsumerStatefulWidget {
  const ContractMilestonesScreen({super.key});
  @override
  ConsumerState<ContractMilestonesScreen> createState() => _State();
}

class _State extends ConsumerState<ContractMilestonesScreen> {
  bool _loading = true;
  List<Map<String, dynamic>> _milestones = [];

  @override
  void initState() { super.initState(); _fetch(); }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>('/v1/contract/milestones');
      _milestones = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Contract Milestones')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _milestones.isEmpty
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.assignment, size: 64, color: theme.colorScheme.outlineVariant),
                  const SizedBox(height: 16),
                  Text('No milestones', style: theme.textTheme.bodyLarge),
                ]))
              : RefreshIndicator(onRefresh: _fetch, child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _milestones.length,
                  itemBuilder: (_, i) {
                    final m = _milestones[i];
                    final progress = (m['progress'] as num?)?.toInt() ?? 0;
                    final status = m['status'] as String? ?? 'pending';
                    return Card(margin: const EdgeInsets.only(bottom: 12), child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(m['title'] as String? ?? 'Milestone', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600))),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: theme.colorScheme.primaryContainer, borderRadius: BorderRadius.circular(12)),
                            child: Text(status, style: TextStyle(fontSize: 11, color: theme.colorScheme.onPrimaryContainer, fontWeight: FontWeight.w600)),
                          ),
                        ]),
                        const SizedBox(height: 8),
                        Text(m['contractName'] as String? ?? '', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: progress / 100, minHeight: 8, backgroundColor: theme.colorScheme.surfaceContainerHigh))),
                          const SizedBox(width: 12),
                          Text('$progress%', style: TextStyle(fontWeight: FontWeight.bold, color: theme.colorScheme.primary)),
                        ]),
                        if (m['dueDate'] != null) ...[
                          const SizedBox(height: 8),
                          Row(children: [
                            Icon(Icons.calendar_today, size: 12, color: theme.colorScheme.outline),
                            const SizedBox(width: 4),
                            Text('Due: ${m['dueDate']}', style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
                          ]),
                        ],
                      ]),
                    ));
                  },
                )),
    );
  }
}
