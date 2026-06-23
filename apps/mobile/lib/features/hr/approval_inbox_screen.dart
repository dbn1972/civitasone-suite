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
  List<Map<String, dynamic>> _requests = [];
  final Set<String> _processing = {};

  @override
  void initState() {
    super.initState();
    _fetchRequests();
  }

  Future<void> _fetchRequests() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // GET /v1/hrms/leave-applications?status=pending&reportees=true
      await Future.delayed(const Duration(milliseconds: 700));

      _requests = [
        {
          'id': 'la-001',
          'employeeName': 'Priya Sharma',
          'employeeCode': 'EMP-042',
          'leaveType': 'Casual Leave',
          'fromDate': '2025-01-20',
          'toDate': '2025-01-22',
          'days': 3,
          'reason': 'Family function — sister wedding preparations',
          'appliedAt': '2025-01-15',
          'status': 'pending',
        },
        {
          'id': 'la-002',
          'employeeName': 'Rajesh Kumar',
          'employeeCode': 'EMP-087',
          'leaveType': 'Sick Leave',
          'fromDate': '2025-01-18',
          'toDate': '2025-01-18',
          'days': 1,
          'reason': 'Doctor appointment — dental surgery follow-up',
          'appliedAt': '2025-01-16',
          'status': 'pending',
        },
        {
          'id': 'la-003',
          'employeeName': 'Anita Desai',
          'employeeCode': 'EMP-123',
          'leaveType': 'Earned Leave',
          'fromDate': '2025-02-01',
          'toDate': '2025-02-07',
          'days': 7,
          'reason': 'Annual family vacation',
          'appliedAt': '2025-01-14',
          'status': 'pending',
        },
      ];
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleAction(String id, bool approve) async {
    setState(() => _processing.add(id));
    try {
      // PATCH /v1/hrms/leave-applications/:id/approve
      // Body: { "action": "approve" | "reject" }
      await Future.delayed(const Duration(milliseconds: 800));

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
          SnackBar(content: Text('Action failed: $e'), backgroundColor: Colors.red),
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
                backgroundColor: const Color(0xFFF59E0B),
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
                        itemCount: _requests.length,
                        itemBuilder: (ctx, i) =>
                            _buildRequestCard(theme, _requests[i]),
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
                  backgroundColor: const Color(0xFF6366F1).withOpacity(0.1),
                  child: Text(
                    (request['employeeName'] as String).substring(0, 1),
                    style: const TextStyle(
                      color: Color(0xFF6366F1),
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
                    color: const Color(0xFFF59E0B).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    'PENDING',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: Colors.amber.shade800,
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
                const Icon(Icons.category_outlined, size: 14, color: Color(0xFF94A3B8)),
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
                    color: const Color(0xFFE0E7FF),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${request['days']} day${(request['days'] as int) == 1 ? '' : 's'}',
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF4338CA),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.calendar_today, size: 14, color: Color(0xFF94A3B8)),
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
                      foregroundColor: Colors.red,
                      side: const BorderSide(color: Colors.red),
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
                      backgroundColor: const Color(0xFF22C55E),
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
            const Icon(Icons.wifi_off, size: 64, color: Color(0xFFEF4444)),
            const SizedBox(height: 16),
            Text('Unable to load requests', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
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
