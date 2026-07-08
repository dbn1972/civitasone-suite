import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Notification Center — paginated list of notifications with read/unread state.
/// GET /v1/notifications?page=1&pageSize=20
/// PATCH /v1/notifications/:id/read → mark single as read
/// POST /v1/notifications/mark-all-read → mark all as read
class NotificationCenterScreen extends ConsumerStatefulWidget {
  const NotificationCenterScreen({super.key});

  @override
  ConsumerState<NotificationCenterScreen> createState() =>
      _NotificationCenterScreenState();
}

class _NotificationCenterScreenState
    extends ConsumerState<NotificationCenterScreen> {
  final ScrollController _scrollCtrl = ScrollController();
  final List<Map<String, dynamic>> _notifications = [];
  int _page = 1;
  int _total = 0;
  int _unreadCount = 0;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  static const int _pageSize = 20;

  @override
  void initState() {
    super.initState();
    _scrollCtrl.addListener(_onScroll);
    _fetchNotifications(reset: true);
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollCtrl.position.pixels >=
            _scrollCtrl.position.maxScrollExtent - 200 &&
        !_loadingMore &&
        _notifications.length < _total) {
      _fetchNotifications(reset: false);
    }
  }

  Future<void> _fetchNotifications({required bool reset}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
        _page = 1;
      });
    } else {
      setState(() => _loadingMore = true);
    }

    try {
      final api = ref.read(apiClientProvider);
      final res = await api.get<Map<String, dynamic>>(
        '/v1/notifications',
        params: {'page': _page, 'pageSize': _pageSize},
      );
      final data = (res.data?['data'] as List<dynamic>? ?? [])
          .cast<Map<String, dynamic>>();
      final meta = res.data?['meta'] as Map<String, dynamic>? ?? {};
      _total = (meta['total'] as num?)?.toInt() ?? 0;
      _unreadCount = (meta['unreadCount'] as num?)?.toInt() ?? 0;

      if (reset) {
        _notifications.clear();
      }
      _notifications.addAll(data);
      _page++;
    } catch (e) {
      if (reset) _error = e.toString();
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  Future<void> _markAsRead(Map<String, dynamic> notification) async {
    final id = notification['id'] as String;
    try {
      final api = ref.read(apiClientProvider);
      await api.patch('/v1/notifications/$id/read');
      setState(() {
        final idx = _notifications.indexWhere((n) => n['id'] == id);
        if (idx >= 0) {
          _notifications[idx] = {..._notifications[idx], 'read': true};
          _unreadCount = (_unreadCount - 1).clamp(0, _total);
        }
      });
    } catch (_) {
      // Silently fail — will sync later
    }
  }

  Future<void> _markAllAsRead() async {
    try {
      final api = ref.read(apiClientProvider);
      await api.post('/v1/notifications/mark-all-read');
      setState(() {
        for (var i = 0; i < _notifications.length; i++) {
          _notifications[i] = {..._notifications[i], 'read': true};
        }
        _unreadCount = 0;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('All notifications marked as read'),
            backgroundColor: Color(0xFF15803D),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  void _onTapNotification(Map<String, dynamic> notification) {
    final isRead = notification['read'] == true;
    if (!isRead) {
      _markAsRead(notification);
    }
    // Navigate to source if available
    final sourceRoute = notification['sourceRoute'] as String?;
    if (sourceRoute != null && sourceRoute.isNotEmpty && mounted) {
      Navigator.of(context).pushNamed(sourceRoute);
    }
  }

  String _relativeTime(String? timestamp) {
    if (timestamp == null || timestamp.isEmpty) return '';
    try {
      final dt = DateTime.parse(timestamp);
      final diff = DateTime.now().difference(dt);
      if (diff.inMinutes < 1) return 'now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  IconData _iconForType(String? type) {
    switch (type) {
      case 'approval':
        return Icons.task_alt;
      case 'finance':
        return Icons.account_balance;
      case 'hr':
        return Icons.people;
      case 'workflow':
        return Icons.account_tree;
      case 'leave':
        return Icons.event_note;
      case 'attendance':
        return Icons.access_time;
      case 'system':
        return Icons.settings;
      case 'alert':
        return Icons.warning_amber;
      default:
        return Icons.notifications;
    }
  }

  Color _colorForType(String? type, ThemeData theme) {
    switch (type) {
      case 'approval':
        return theme.colorScheme.primary;
      case 'finance':
        return const Color(0xFF3B82F6);
      case 'hr':
        return const Color(0xFFF59E0B);
      case 'workflow':
        return const Color(0xFF8B5CF6);
      case 'alert':
        return theme.colorScheme.error;
      default:
        return theme.colorScheme.tertiary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (_unreadCount > 0)
            TextButton.icon(
              onPressed: _markAllAsRead,
              icon: const Icon(Icons.done_all, size: 18),
              label: const Text('Mark all read'),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : _notifications.isEmpty
                  ? _buildEmpty(theme)
                  : RefreshIndicator(
                      onRefresh: () => _fetchNotifications(reset: true),
                      child: ListView.builder(
                        controller: _scrollCtrl,
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        itemCount: _notifications.length + (_loadingMore ? 1 : 0),
                        itemBuilder: (ctx, i) {
                          if (i == _notifications.length) {
                            return const Padding(
                              padding: EdgeInsets.all(16),
                              child: Center(child: CircularProgressIndicator()),
                            );
                          }
                          return _NotificationTile(
                            notification: _notifications[i],
                            relativeTime: _relativeTime,
                            iconForType: _iconForType,
                            colorForType: (type) => _colorForType(type, theme),
                            onTap: () => _onTapNotification(_notifications[i]),
                          );
                        },
                      ),
                    ),
    );
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.notifications_none, size: 72, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No notifications', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            'You\'re all caught up',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
          ),
        ],
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 64, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Unable to load notifications', style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () => _fetchNotifications(reset: true),
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    required this.notification,
    required this.relativeTime,
    required this.iconForType,
    required this.colorForType,
    required this.onTap,
  });

  final Map<String, dynamic> notification;
  final String Function(String?) relativeTime;
  final IconData Function(String?) iconForType;
  final Color Function(String?) colorForType;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = notification['title'] as String? ?? '';
    final body = notification['body'] as String? ?? '';
    final type = notification['type'] as String?;
    final timestamp = notification['createdAt'] as String?;
    final isRead = notification['read'] == true;
    final color = colorForType(type);

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: isRead ? null : theme.colorScheme.primaryContainer.withOpacity(0.15),
          border: Border(
            bottom: BorderSide(color: theme.colorScheme.outlineVariant.withOpacity(0.3)),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(iconForType(type), color: color, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: isRead ? FontWeight.normal : FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (!isRead)
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary,
                            shape: BoxShape.circle,
                          ),
                        ),
                    ],
                  ),
                  if (body.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        body,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.outline,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      relativeTime(timestamp),
                      style: TextStyle(fontSize: 11, color: theme.colorScheme.outline),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
