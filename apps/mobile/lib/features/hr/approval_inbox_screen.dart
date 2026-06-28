import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Manager approval inbox for leave requests.
/// GET /v1/hrms/leave-applications (filtered by reportees)
/// PATCH /v1/hrms/leave-applications/:id/approve
class ApprovalInboxScreen extends ConsumerStatefulWidget {
  const ApprovalInboxScreen({super.key});

  @override
  ConsumerState<ApprovalInboxScreen> createState() => _ApprovalInboxScreenState();
}

class _ApprovalInboxScreenState extends ConsumerState<ApprovalInboxScreen> {
  bool _loading = true;
  String? _error;
  bool _fromCache = false;
  List<Map<String, dynamic>> _requests = [];
  final Set<String> _processing = {};

  /// Cache mailbox key used for offline-first storage.
  static const _cacheMailbox = 'leave_approvals';
  static const _cacheEntityId = 'leave_approvals_singleton';

  @override
  void initState() {
    super.initState();
    _fetchRequests();
  }

  Future<void> _fetchRequests() async {
    setState(() {
      _loading = true;
      _error = null;
      _fromCache = false;
    });
    try {
      final apiClient = ref.read(apiClientProvider);
      final res = await apiClient.get<Map<String, dynamic>>(
        '/v1/hrms/leave-requests',
      );
      final data = (res.data?['data'] as List<dynamic>?) ?? [];

      _requests = data
          .cast<Map<String, dynamic>>()
          .where((r) => (r['status'] as String?) == 'pending')
          .toList();

      // Cache to local DB for offline-first access.
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        await db.upsertEntity(
          id: _cacheEntityId,
          mailbox: _cacheMailbox,
          data: {'requests': _requests},
          updatedAt: DateTime.now().toUtc().toIso8601String(),
        );
      }
    } catch (e) {
      // Fall back to cached data when offline / error.
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities(_cacheMailbox);
        if (cached.isNotEmpty) {
          final cachedData = cached.first['data'] as Map<String, dynamic>;
          final items = (cachedData['requests'] as List<dynamic>?) ?? [];
          _requests = items.cast<Map<String, dynamic>>().toList();
          if (mounted) {
            setState(() {
              _fromCache = true;
              _error = null;
            });
          }
          return;
        }
      }
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleAction(String id, bool approve) async {
    setState(() => _processing.add(id));
    try {
      final apiClient = ref.read(apiClientProvider);
      if (approve) {
        await apiClient.patch<Map<String, dynamic>>(
          '/v1/hrms/leave-requests/$id/approve',
          data: {},
        );
      } else {
        await apiClient.patch<Map<String, dynamic>>(
          '/v1/hrms/leave-requests/$id/reject',
          data: {'reason': 'rejected by manager'},
        );
      }

      setState(() {
        _requests.removeWhere((r) => r['id'] == id);
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(approve ? 'Leave approved' : 'Leave rejected'),
            backgroundColor: approve ? const Color(0xFF15803D) : const Color(0xFFEF4444),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Action failed: $e'), backgroundColor: Theme.of(context).colorScheme.error),
        );
      }
    } finally {
      if (mounted) setState(() => _processing.remove(id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Approval Inbox'),
        actions: [
          if (_requests.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Chip(
                label: Text(
                  '${_requests.length} pending',
                  style: const TextStyle(fontSize: 12, color: Colors.white),
                ),
                backgroundColor: theme.colorScheme.tertiary,
                side: BorderSide.none,
              ),
            ),
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchRequests,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError(theme)
              : _requests.isEmpty
                  ? _buildEmpty(theme)
                  : RefreshIndicator(
                      onRefresh: _fetchRequests,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _requests.length + (_fromCache ? 1 : 0),
                        itemBuilder: (ctx, i) {
                          if (_fromCache && i == 0) {
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: _buildCacheBanner(theme),
                            );
                          }
                          final index = _fromCache ? i - 1 : i;
                          return _buildRequestCard(theme, _requests[index]);
                        },
                      ),
                    ),
    );
  }

  Widget _buildRequestCard(ThemeData theme, Map<String, dynamic> request) {
    final id = request['id'] as String;
    final isProcessing = _processing.contains(id);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                  child: Text(
                    (request['employeeName'] as String).substring(0, 1),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        request['employeeName'] as String,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        request['employeeCode'] as String,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.outline,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.tertiaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    'PENDING',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: Theme.of(context).colorScheme.onTertiaryContainer,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Divider(height: 1),
            const SizedBox(height: 12),

            // Leave details
            Row(
              children: [
                Icon(Icons.category_outlined, size: 14, color: theme.colorScheme.outline),
                const SizedBox(width: 4),
                Text(
                  request['leaveType'] as String,
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${request['days']} day${(request['days'] as int) == 1 ? '' : 's'}',
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.colorScheme.onPrimaryContainer,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.calendar_today, size: 14, color: theme.colorScheme.outline),
                const SizedBox(width: 4),
                Text(
                  '${request['fromDate']} → ${request['toDate']}',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
            if (request['reason'] != null) ...[
              const SizedBox(height: 8),
              Text(
                request['reason'] as String,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.outline,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: 16),

            // Action buttons
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: isProcessing ? null : () => _handleAction(id, false),
                    icon: const Icon(Icons.close, size: 18),
                    label: const Text('Reject'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.colorScheme.error,
                      side: BorderSide(color: theme.colorScheme.error),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: isProcessing ? null : () => _handleAction(id, true),
                    icon: isProcessing
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.check, size: 18),
                    label: const Text('Approve'),
                    style: FilledButton.styleFrom(
                      backgroundColor: theme.colorScheme.primary,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCacheBanner(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.tertiary.withOpacity(0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.tertiary.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Icon(Icons.wifi_off, size: 16, color: theme.colorScheme.tertiary),
          const SizedBox(width: 8),
          Text(
            'Showing cached data',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.tertiary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.inbox, size: 64, color: theme.colorScheme.outlineVariant),
          const SizedBox(height: 16),
          Text('No pending approvals', style: theme.textTheme.bodyLarge),
          const SizedBox(height: 8),
          Text(
            'All caught up!',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildError(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.wifi_off, size: 64, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text('Unable to load requests', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(fontSize: 12, color: theme.colorScheme.outline)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _fetchRequests,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
