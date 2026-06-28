import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Gamified leaderboard — employees ranked by recognition points.
/// GET /v1/hrms/leaderboard
/// GET /v1/hrms/leaderboard/my-points
class LeaderboardScreen extends ConsumerStatefulWidget {
  const LeaderboardScreen({super.key});

  @override
  ConsumerState<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends ConsumerState<LeaderboardScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _leaders = [];
  int _myPoints = 0;
  String _myBadge = 'starter';
  String _period = 'month';

  @override
  void initState() {
    super.initState();
    _fetchLeaderboard();
  }

  Future<void> _fetchLeaderboard() async {
    setState(() { _loading = true; _error = null; });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>('/v1/hrms/leaderboard', params: {'period': _period});
      _leaders = ((res.data?['data'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      _myPoints = (res.data?['myPoints'] as num?)?.toInt() ?? 0;

      // Get my badge
      final myRes = await apiClient.get<Map<String, dynamic>>('/v1/hrms/leaderboard/my-points');
      _myBadge = myRes.data?['badge'] as String? ?? 'starter';
    } catch (e) { _error = e.toString(); }
    finally { if (mounted) setState(() => _loading = false); }
  }

  static const _badgeConfig = {
    'diamond': ('💎', Color(0xFF06B6D4), 'Diamond'),
    'platinum': ('🏅', Color(0xFF8B5CF6), 'Platinum'),
    'gold': ('🥇', Color(0xFFF59E0B), 'Gold'),
    'silver': ('🥈', Color(0xFF94A3B8), 'Silver'),
    'bronze': ('🥉', Color(0xFFCD7F32), 'Bronze'),
    'starter': ('⭐', Color(0xFF64748B), 'Starter'),
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final badgeCfg = _badgeConfig[_myBadge] ?? _badgeConfig['starter']!;

    return Scaffold(
      appBar: AppBar(title: const Text('Leaderboard')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: FilledButton.icon(onPressed: _fetchLeaderboard, icon: const Icon(Icons.refresh), label: const Text('Retry')))
              : RefreshIndicator(
                  onRefresh: _fetchLeaderboard,
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                    // My stats card
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: [badgeCfg.$2, badgeCfg.$2.withOpacity(0.7)]),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Row(children: [
                        Text(badgeCfg.$1, style: const TextStyle(fontSize: 40)),
                        const SizedBox(width: 16),
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('My Points', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                          Text('$_myPoints', style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
                          Text(badgeCfg.$3, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500)),
                        ])),
                      ]),
                    ),
                    const SizedBox(height: 16),

                    // Period filter
                    Row(children: [
                      for (final p in ['month', 'quarter', 'year'])
                        Padding(padding: const EdgeInsets.only(right: 8), child: FilterChip(
                          label: Text(p[0].toUpperCase() + p.substring(1)),
                          selected: _period == p,
                          onSelected: (_) { setState(() => _period = p); _fetchLeaderboard(); },
                          selectedColor: const Color(0xFF6366F1).withOpacity(0.15),
                        )),
                    ]),
                    const SizedBox(height: 16),

                    // Leaderboard list
                    if (_leaders.isEmpty)
                      Center(child: Padding(padding: const EdgeInsets.only(top: 32), child: Text('No activity this period', style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline))))
                    else
                      ...List.generate(_leaders.length, (i) {
                        final l = _leaders[i];
                        final rank = (l['rank'] as num?)?.toInt() ?? i + 1;
                        return _LeaderRow(
                          rank: rank,
                          name: l['name'] as String? ?? '',
                          department: l['department'] as String? ?? '',
                          points: (l['totalPoints'] as num?)?.toInt() ?? 0,
                          badge: l['badge'] as String? ?? 'starter',
                        );
                      }),
                  ]),
                ),
    );
  }
}

class _LeaderRow extends StatelessWidget {
  const _LeaderRow({required this.rank, required this.name, required this.department, required this.points, required this.badge});
  final int rank;
  final String name;
  final String department;
  final int points;
  final String badge;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isTop3 = rank <= 3;
    final rankColors = [Colors.transparent, const Color(0xFFF59E0B), const Color(0xFF94A3B8), const Color(0xFFCD7F32)];
    final rankColor = isTop3 ? rankColors[rank] : theme.colorScheme.outline;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: isTop3 ? BorderSide(color: rankColor.withOpacity(0.3)) : BorderSide.none,
        ),
        child: Padding(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12), child: Row(children: [
          // Rank
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(
              color: isTop3 ? rankColor.withOpacity(0.15) : theme.colorScheme.surfaceContainerLow,
              shape: BoxShape.circle,
            ),
            child: Center(child: Text(
              isTop3 ? ['', '🥇', '🥈', '🥉'][rank] : '#$rank',
              style: TextStyle(fontSize: isTop3 ? 16 : 11, fontWeight: FontWeight.bold, color: rankColor),
            )),
          ),
          const SizedBox(width: 12),
          // Name
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
            Text(department, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
          ])),
          // Points
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('$points', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: isTop3 ? rankColor : const Color(0xFF6366F1))),
            const Text('pts', style: TextStyle(fontSize: 10, color: Color(0xFF94A3B8))),
          ]),
        ])),
      ),
    );
  }
}
