import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Knowledge base — self-service help articles, FAQs, policies.
/// GET /v1/knowledge/articles?search=
class KnowledgeBaseScreen extends ConsumerStatefulWidget {
  const KnowledgeBaseScreen({super.key});
  @override
  ConsumerState<KnowledgeBaseScreen> createState() => _State();
}

class _State extends ConsumerState<KnowledgeBaseScreen> {
  final _searchCtrl = TextEditingController();
  bool _loading = true;
  List<Map<String, dynamic>> _articles = [];
  String _category = 'all';

  static const _categories = ['all', 'leave', 'payroll', 'attendance', 'travel', 'policy', 'it', 'general'];

  @override
  void initState() { super.initState(); _fetch(); }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(apiClientProvider);
      final params = <String, String>{'limit': '50'};
      if (_searchCtrl.text.isNotEmpty) params['search'] = _searchCtrl.text;
      if (_category != 'all') params['category'] = _category;
      final res = await api.get<Map<String, dynamic>>('/v1/knowledge/articles', params: params);
      _articles = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Knowledge Base')),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 0), child: TextField(
          controller: _searchCtrl,
          decoration: InputDecoration(
            hintText: 'Search articles, FAQs, policies…',
            prefixIcon: const Icon(Icons.search),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
          onSubmitted: (_) => _fetch(),
        )),
        SizedBox(height: 48, child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          children: _categories.map((c) => Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              label: Text(c == 'all' ? 'All' : c[0].toUpperCase() + c.substring(1)),
              selected: _category == c,
              onSelected: (_) { setState(() => _category = c); _fetch(); },
            ),
          )).toList(),
        )),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _articles.isEmpty
                ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.menu_book, size: 64, color: theme.colorScheme.outlineVariant),
                    const SizedBox(height: 16),
                    Text('No articles found', style: theme.textTheme.bodyLarge),
                  ]))
                : RefreshIndicator(onRefresh: _fetch, child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _articles.length,
                    itemBuilder: (_, i) {
                      final a = _articles[i];
                      return Card(margin: const EdgeInsets.only(bottom: 8), child: ListTile(
                        leading: Icon(_catIcon(a['category'] as String? ?? ''), color: theme.colorScheme.primary),
                        title: Text(a['title'] as String? ?? '', maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text(a['category'] as String? ?? '', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
                        trailing: Icon(Icons.chevron_right, color: theme.colorScheme.outline),
                        onTap: () => _showArticle(a),
                      ));
                    },
                  )),
        ),
      ]),
    );
  }

  void _showArticle(Map<String, dynamic> article) {
    showModalBottomSheet(context: context, isScrollControlled: true, builder: (ctx) => DraggableScrollableSheet(
      initialChildSize: 0.85, minChildSize: 0.5, maxChildSize: 0.95,
      builder: (_, ctrl) => Container(
        padding: const EdgeInsets.all(24),
        child: ListView(controller: ctrl, children: [
          Text(article['title'] as String? ?? '', style: Theme.of(ctx).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(color: Theme.of(ctx).colorScheme.primaryContainer, borderRadius: BorderRadius.circular(8)),
            child: Text(article['category'] as String? ?? '', style: TextStyle(fontSize: 12, color: Theme.of(ctx).colorScheme.onPrimaryContainer)),
          ),
          const SizedBox(height: 16),
          Text(article['body'] as String? ?? article['content'] as String? ?? 'No content available.', style: const TextStyle(fontSize: 15, height: 1.6)),
        ]),
      ),
    ));
  }

  IconData _catIcon(String cat) {
    switch (cat) {
      case 'leave': return Icons.event_note;
      case 'payroll': return Icons.receipt_long;
      case 'attendance': return Icons.fingerprint;
      case 'travel': return Icons.flight;
      case 'policy': return Icons.policy;
      case 'it': return Icons.computer;
      default: return Icons.article;
    }
  }
}
