import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// Meeting Schedule + Action Items screen.
/// Tab 1: Today's Meetings. Tab 2: Pending Action Items.
class MeetingsScreen extends ConsumerStatefulWidget {
  const MeetingsScreen({super.key});

  @override
  ConsumerState<MeetingsScreen> createState() => _MeetingsScreenState();
}

class _MeetingsScreenState extends ConsumerState<MeetingsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;
  bool _loadingMeetings = true;
  bool _loadingActions = true;
  bool _isOffline = false;
  String? _meetingsError;
  String? _actionsError;
  List<Map<String, dynamic>> _meetings = [];
  List<Map<String, dynamic>> _actionItems = [];

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
    _loadMeetings();
    _loadActionItems();
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMeetings() async {
    setState(() { _loadingMeetings = true; _meetingsError = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get('/api/v1/meeting/upcoming');
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _meetings = list.cast<Map<String, dynamic>>();
          _loadingMeetings = false;
          _isOffline = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _meetingsError = e.toString();
          _loadingMeetings = false;
          _isOffline = true;
        });
      }
    }
  }

  Future<void> _loadActionItems() async {
    setState(() { _loadingActions = true; _actionsError = null; });
    try {
      final api = ref.read(apiClientProvider);
      final response = await api.get(
        '/api/v1/meeting/action-items',
        params: {'status': 'pending'},
      );
      final data = response.data;
      final list = (data is Map && data.containsKey('data'))
          ? (data['data'] as List)
          : (data as List);
      if (mounted) {
        setState(() {
          _actionItems = list.cast<Map<String, dynamic>>();
          _loadingActions = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _actionsError = e.toString();
          _loadingActions = false;
        });
      }
    }
  }

  Future<void> _markActionDone(String actionId) async {
    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'meeting_actions',
        operation: 'complete',
        entityId: actionId,
        payload: {
          'id': actionId,
          'status': 'done',
          'completedAt': DateTime.now().toUtc().toIso8601String(),
        },
      );
    }
    ref.read(syncEngineProvider)?.syncMailbox('meeting_actions');

    setState(() {
      _actionItems.removeWhere((a) => a['id'] == actionId);
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Marked as done — syncing')),
      );
    }
  }

  Future<void> _joinMeeting(String? link) async {
    if (link == null || link.isEmpty) return;
    final uri = Uri.tryParse(link);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Meetings'),
        actions: [
          Semantics(
            label: 'Refresh meetings',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: () {
                _loadMeetings();
                _loadActionItems();
              },
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tabCtrl,
          tabs: const [
            Tab(text: "Today's Meetings"),
            Tab(text: 'Action Items'),
          ],
        ),
      ),
      body: Column(
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
            child: TabBarView(
              controller: _tabCtrl,
              children: [
                _buildMeetingsTab(context),
                _buildActionsTab(context),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMeetingsTab(BuildContext context) {
    if (_loadingMeetings) return const SkeletonList();
    if (_meetingsError != null && _meetings.isEmpty) {
      return _ErrorState(
        message: _meetingsError!, onRetry: _loadMeetings);
    }
    if (_meetings.isEmpty) {
      return const _EmptyState(
        icon: Icons.event_available,
        message: 'No meetings scheduled today',
      );
    }

    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _loadMeetings,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 16, top: 8),
        itemCount: _meetings.length,
        itemBuilder: (ctx, i) {
          final m = _meetings[i];
          return Card(
            margin: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    m['title'] as String? ?? 'Untitled Meeting',
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  Row(children: [
                    Icon(Icons.access_time,
                        size: 14, color: theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(
                      m['time'] as String? ??
                          m['startTime'] as String? ?? '—',
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.colorScheme.outline),
                    ),
                    const SizedBox(width: 16),
                    Icon(Icons.room,
                        size: 14, color: theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        m['room'] as String? ??
                            m['location'] as String? ?? '—',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.outline),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ]),
                  const SizedBox(height: 6),
                  Row(children: [
                    Icon(Icons.people,
                        size: 14, color: theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(
                      '${m['attendeesCount'] ?? m['attendees'] ?? 0} attendees',
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.colorScheme.outline),
                    ),
                    const Spacer(),
                    if (m['meetingLink'] != null)
                      Semantics(
                        label: 'Join meeting',
                        child: FilledButton.tonalIcon(
                          onPressed: () => _joinMeeting(
                            m['meetingLink'] as String?,
                          ),
                          icon: const Icon(Icons.videocam, size: 16),
                          label: const Text('Join'),
                        ),
                      ),
                  ]),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildActionsTab(BuildContext context) {
    if (_loadingActions) return const SkeletonList();
    if (_actionsError != null && _actionItems.isEmpty) {
      return _ErrorState(
        message: _actionsError!, onRetry: _loadActionItems);
    }
    if (_actionItems.isEmpty) {
      return const _EmptyState(
        icon: Icons.check_circle_outline,
        message: 'All action items completed',
      );
    }

    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _loadActionItems,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 16, top: 8),
        itemCount: _actionItems.length,
        itemBuilder: (ctx, i) {
          final a = _actionItems[i];
          return Card(
            margin: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    a['description'] as String? ?? '—',
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 8),
                  Row(children: [
                    Icon(Icons.calendar_today,
                        size: 14, color: theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(
                      'Due: ${a['dueDate'] as String? ?? '—'}',
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.colorScheme.outline),
                    ),
                    const SizedBox(width: 16),
                    Icon(Icons.person_outline,
                        size: 14, color: theme.colorScheme.outline),
                    const SizedBox(width: 4),
                    Text(
                      'By: ${a['assignedBy'] as String? ?? '—'}',
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.colorScheme.outline),
                    ),
                  ]),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Semantics(
                      label: 'Mark action item as done',
                      child: FilledButton.tonalIcon(
                        onPressed: () => _markActionDone(
                          a['id'] as String,
                        ),
                        icon: const Icon(Icons.check, size: 16),
                        label: const Text('Done'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
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
          Text('Unable to load data',
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
