import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';

/// Peer Recognition / Kudos — give and receive appreciation.
/// POST /v1/hrms/kudos (via outbox for offline)
/// GET /v1/hrms/kudos/feed — organization-wide recognition feed
class KudosScreen extends ConsumerStatefulWidget {
  const KudosScreen({super.key});

  @override
  ConsumerState<KudosScreen> createState() => _KudosScreenState();
}

class _KudosScreenState extends ConsumerState<KudosScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _feed = [];
  int _myKudosCount = 0;
  int _givenCount = 0;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _fetchFeed();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchFeed() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient
          .get<Map<String, dynamic>>('/v1/hrms/kudos/feed');
      _feed = ((res.data?['data'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
      _myKudosCount = (res.data?['myReceived'] as int?) ?? 0;
      _givenCount = (res.data?['myGiven'] as int?) ?? 0;
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Recognition'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchFeed,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Feed'),
            Tab(text: 'Give Kudos'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildFeed(theme),
                    const _GiveKudosTab(),
                  ],
                ),
    );
  }

  Widget _buildFeed(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: _fetchFeed,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Stats header
          _buildStatsHeader(theme),
          const SizedBox(height: 20),

          if (_feed.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(top: 40),
                child: Column(
                  children: [
                    Icon(Icons.emoji_events,
                        size: 64, color: theme.colorScheme.outlineVariant),
                    const SizedBox(height: 16),
                    Text('No recognition yet',
                        style: theme.textTheme.bodyLarge),
                    const SizedBox(height: 8),
                    Text('Be the first to appreciate a colleague!',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.outline)),
                  ],
                ),
              ),
            )
          else
            ..._feed.map((k) => _KudosCard(kudos: k)),
        ],
      ),
    );
  }

  Widget _buildStatsHeader(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFF59E0B), Color(0xFFEC4899)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _StatItem(
              icon: Icons.star, value: '$_myKudosCount', label: 'Received'),
          Container(width: 1, height: 40, color: Colors.white30),
          _StatItem(
              icon: Icons.volunteer_activism,
              value: '$_givenCount',
              label: 'Given'),
          Container(width: 1, height: 40, color: Colors.white30),
          _StatItem(
              icon: Icons.emoji_events,
              value: '${_feed.length}',
              label: 'This Month'),
        ],
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
          const SizedBox(height: 16),
          Text('Unable to load feed', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _fetchFeed,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem(
      {required this.icon, required this.value, required this.label});
  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(icon, color: Colors.white, size: 22),
        const SizedBox(height: 4),
        Text(value,
            style: const TextStyle(
                fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.white70)),
      ],
    );
  }
}

class _KudosCard extends StatelessWidget {
  const _KudosCard({required this.kudos});
  final Map<String, dynamic> kudos;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final giverName = kudos['giverName'] as String? ?? 'Someone';
    final receiverName = kudos['receiverName'] as String? ?? 'A colleague';
    final message = kudos['message'] as String? ?? '';
    final badge = kudos['badge'] as String? ?? 'star';
    final createdAt = kudos['createdAt'] as String? ?? '';
    final reactions = (kudos['reactions'] as int?) ?? 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header: who → who
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor:
                      const Color(0xFFF59E0B).withOpacity(0.1),
                  child: Text(giverName[0],
                      style: const TextStyle(
                          color: Color(0xFFF59E0B),
                          fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: RichText(
                    text: TextSpan(
                      style: theme.textTheme.bodyMedium,
                      children: [
                        TextSpan(
                            text: giverName,
                            style:
                                const TextStyle(fontWeight: FontWeight.w600)),
                        const TextSpan(text: ' appreciated '),
                        TextSpan(
                            text: receiverName,
                            style:
                                const TextStyle(fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                ),
                _BadgeIcon(badge: badge),
              ],
            ),
            const SizedBox(height: 12),

            // Message
            if (message.isNotEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(message,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(fontStyle: FontStyle.italic)),
              ),
            const SizedBox(height: 10),

            // Footer: time + reactions
            Row(
              children: [
                Icon(Icons.access_time,
                    size: 12, color: theme.colorScheme.outline),
                const SizedBox(width: 4),
                Text(_relativeTime(createdAt),
                    style: TextStyle(
                        fontSize: 11, color: theme.colorScheme.outline)),
                const Spacer(),
                Icon(Icons.favorite,
                    size: 14, color: const Color(0xFFEF4444).withOpacity(0.6)),
                const SizedBox(width: 4),
                Text('$reactions',
                    style: TextStyle(
                        fontSize: 12, color: theme.colorScheme.outline)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _relativeTime(String iso) {
    if (iso.isEmpty) return '';
    final dt = DateTime.tryParse(iso);
    if (dt == null) return iso;
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return iso.split('T').first;
  }
}

class _BadgeIcon extends StatelessWidget {
  const _BadgeIcon({required this.badge});
  final String badge;

  @override
  Widget build(BuildContext context) {
    IconData icon;
    Color color;
    switch (badge) {
      case 'star':
        icon = Icons.star;
        color = const Color(0xFFF59E0B);
        break;
      case 'rocket':
        icon = Icons.rocket_launch;
        color = const Color(0xFF6366F1);
        break;
      case 'heart':
        icon = Icons.favorite;
        color = const Color(0xFFEF4444);
        break;
      case 'trophy':
        icon = Icons.emoji_events;
        color = const Color(0xFF22C55E);
        break;
      case 'fire':
        icon = Icons.local_fire_department;
        color = const Color(0xFFEF4444);
        break;
      case 'lightning':
        icon = Icons.bolt;
        color = const Color(0xFFF59E0B);
        break;
      default:
        icon = Icons.thumb_up;
        color = const Color(0xFF6366F1);
    }

    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        shape: BoxShape.circle,
      ),
      child: Icon(icon, color: color, size: 18),
    );
  }
}

/// Tab for giving kudos to a colleague.
class _GiveKudosTab extends ConsumerStatefulWidget {
  const _GiveKudosTab();

  @override
  ConsumerState<_GiveKudosTab> createState() => _GiveKudosTabState();
}

class _GiveKudosTabState extends ConsumerState<_GiveKudosTab> {
  final _messageCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();
  String _selectedBadge = 'star';
  String? _selectedEmployeeId;
  String? _selectedEmployeeName;
  bool _submitting = false;

  static const _badges = [
    ('star', '⭐', 'Star Performer'),
    ('rocket', '🚀', 'Going Above & Beyond'),
    ('heart', '❤️', 'Team Spirit'),
    ('trophy', '🏆', 'Outstanding Achievement'),
    ('fire', '🔥', 'On Fire This Week'),
    ('lightning', '⚡', 'Quick Turnaround'),
  ];

  @override
  void dispose() {
    _messageCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedEmployeeId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a colleague')),
      );
      return;
    }
    if (_messageCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Please write an appreciation message')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final db = ref.read(dbProvider).valueOrNull;
      if (db == null) throw Exception('Database not ready');

      final entityId = const Uuid().v4();
      final now = DateTime.now().toUtc().toIso8601String();

      final payload = {
        'entityId': entityId,
        'receiverId': _selectedEmployeeId,
        'receiverName': _selectedEmployeeName,
        'badge': _selectedBadge,
        'message': _messageCtrl.text.trim(),
        'createdAt': now,
      };

      await db.enqueueOutbox(
        mailbox: 'kudos',
        operation: 'create',
        entityId: entityId,
        payload: payload,
      );

      ref.read(syncEngineProvider)?.syncMailbox('kudos');

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('🎉 Kudos sent! Your appreciation will be visible to everyone.'),
            backgroundColor: Color(0xFF15803D),
          ),
        );
        _messageCtrl.clear();
        _searchCtrl.clear();
        setState(() {
          _selectedEmployeeId = null;
          _selectedEmployeeName = null;
          _selectedBadge = 'star';
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        // Instruction
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                const Color(0xFFF59E0B).withOpacity(0.05),
                const Color(0xFFEC4899).withOpacity(0.05),
              ],
            ),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
                color: const Color(0xFFF59E0B).withOpacity(0.2)),
          ),
          child: Row(
            children: [
              const Icon(Icons.emoji_events,
                  color: Color(0xFFF59E0B), size: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Recognize a colleague for great work! Your appreciation will be visible to the entire team.',
                  style: theme.textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),

        // Search employee
        TextField(
          controller: _searchCtrl,
          decoration: InputDecoration(
            labelText: 'Select Colleague *',
            border: const OutlineInputBorder(),
            prefixIcon: const Icon(Icons.person_search),
            hintText: 'Type name or employee code…',
            suffixIcon: _selectedEmployeeName != null
                ? Chip(
                    label: Text(_selectedEmployeeName!,
                        style: const TextStyle(fontSize: 11)),
                    deleteIcon:
                        const Icon(Icons.close, size: 14),
                    onDeleted: () => setState(() {
                      _selectedEmployeeId = null;
                      _selectedEmployeeName = null;
                      _searchCtrl.clear();
                    }),
                  )
                : null,
          ),
          onChanged: (v) {
            // In production: debounce + API search
            // For now: simulate selection on typing
            if (v.length >= 3 && _selectedEmployeeId == null) {
              setState(() {
                _selectedEmployeeId = 'emp-${v.hashCode}';
                _selectedEmployeeName = v;
              });
            }
          },
        ),
        const SizedBox(height: 20),

        // Badge selection
        Text('Choose a Badge',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: _badges.map((b) {
            final selected = _selectedBadge == b.$1;
            return GestureDetector(
              onTap: () => setState(() => _selectedBadge = b.$1),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: selected
                      ? const Color(0xFFF59E0B).withOpacity(0.15)
                      : theme.colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: selected
                        ? const Color(0xFFF59E0B)
                        : theme.colorScheme.outlineVariant,
                    width: selected ? 2 : 1,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(b.$2, style: const TextStyle(fontSize: 18)),
                    const SizedBox(width: 6),
                    Text(b.$3,
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: selected
                                ? FontWeight.w600
                                : FontWeight.normal)),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 20),

        // Message
        TextField(
          controller: _messageCtrl,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Appreciation Message *',
            border: OutlineInputBorder(),
            alignLabelWithHint: true,
            hintText:
                'What did they do that deserves recognition? Be specific!',
          ),
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
          label: Text(_submitting ? 'Sending…' : 'Send Kudos 🎉'),
          style: FilledButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
            backgroundColor: const Color(0xFFF59E0B),
          ),
        ),
      ],
    );
  }
}
