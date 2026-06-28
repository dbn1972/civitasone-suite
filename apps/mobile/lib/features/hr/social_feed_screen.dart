import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Combined social feed — kudos, birthdays, new joinees, announcements.
/// GET /v1/hrms/social/feed
class SocialFeedScreen extends ConsumerStatefulWidget {
  const SocialFeedScreen({super.key});

  @override
  ConsumerState<SocialFeedScreen> createState() => _SocialFeedScreenState();
}

class _SocialFeedScreenState extends ConsumerState<SocialFeedScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _feed = [];

  @override
  void initState() {
    super.initState();
    _fetchFeed();
  }

  Future<void> _fetchFeed() async {
    setState(() { _loading = true; _error = null; });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>('/v1/hrms/social/feed');
      _feed = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    } catch (e) { _error = e.toString(); }
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Social Feed'), actions: [
        IconButton(icon: const Icon(Icons.sync), onPressed: _fetchFeed),
      ]),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.wifi_off, size: 48, color: Color(0xFFEF4444)),
                  const SizedBox(height: 12),
                  FilledButton.icon(onPressed: _fetchFeed, icon: const Icon(Icons.refresh), label: const Text('Retry')),
                ]))
              : _feed.isEmpty
                  ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                      const Text('🎉', style: TextStyle(fontSize: 48)),
                      const SizedBox(height: 16),
                      Text('No updates yet', style: theme.textTheme.bodyLarge),
                    ]))
                  : RefreshIndicator(
                      onRefresh: _fetchFeed,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _feed.length,
                        itemBuilder: (_, i) => _FeedCard(item: _feed[i]),
                      ),
                    ),
    );
  }
}

class _FeedCard extends StatelessWidget {
  const _FeedCard({required this.item});
  final Map<String, dynamic> item;

  static const _badgeEmoji = {
    'star': '⭐', 'rocket': '🚀', 'heart': '❤️', 'trophy': '🏆', 'fire': '🔥', 'lightning': '⚡',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final type = item['type'] as String? ?? '';

    switch (type) {
      case 'kudos':
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(padding: const EdgeInsets.all(14), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(_badgeEmoji[item['badge'] as String? ?? 'star'] ?? '⭐', style: const TextStyle(fontSize: 24)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              RichText(text: TextSpan(style: theme.textTheme.bodyMedium, children: [
                TextSpan(text: item['giver_name'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                const TextSpan(text: ' appreciated '),
                TextSpan(text: item['receiver_name'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
              ])),
              if ((item['message'] as String?)?.isNotEmpty == true) ...[
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerLow, borderRadius: BorderRadius.circular(8)),
                  child: Text(item['message'] as String, style: theme.textTheme.bodySmall?.copyWith(fontStyle: FontStyle.italic)),
                ),
              ],
            ])),
          ])),
        );

      case 'birthday':
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          color: const Color(0xFFFFF0F5),
          child: Padding(padding: const EdgeInsets.all(14), child: Row(children: [
            const Text('🎂', style: TextStyle(fontSize: 28)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Happy Birthday, ${item['name']}!', style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFFDB2777))),
              Text('${item['designation']} • ${item['department']}', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
            ])),
          ])),
        );

      case 'new_joinee':
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          color: const Color(0xFFF0FFF4),
          child: Padding(padding: const EdgeInsets.all(14), child: Row(children: [
            const Text('👋', style: TextStyle(fontSize: 28)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Welcome ${item['name']}!', style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF15803D))),
              Text('Joined as ${item['designation']} in ${item['department']}', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
            ])),
          ])),
        );

      case 'announcement':
        final pinned = item['pinned'] == true;
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: pinned ? const BorderSide(color: Color(0xFF6366F1), width: 1) : BorderSide.none,
          ),
          child: Padding(padding: const EdgeInsets.all(14), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(pinned ? '📌' : '📢', style: const TextStyle(fontSize: 22)),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(item['title'] as String? ?? '', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text(item['body'] as String? ?? '', maxLines: 3, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
              const SizedBox(height: 6),
              Row(children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: const Color(0xFF6366F1).withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                  child: Text(item['category'] as String? ?? '', style: const TextStyle(fontSize: 10, color: Color(0xFF6366F1))),
                ),
                const SizedBox(width: 8),
                Text('by ${item['author'] ?? ''}', style: TextStyle(fontSize: 10, color: theme.colorScheme.outline)),
              ]),
            ])),
          ])),
        );

      default:
        return const SizedBox.shrink();
    }
  }
}
