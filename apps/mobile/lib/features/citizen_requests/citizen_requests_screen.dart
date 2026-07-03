import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'models.dart';
import 'providers.dart';

/// Citizen requests list with status indicators and SLA badges.
class CitizenRequestsScreen extends ConsumerStatefulWidget {
  const CitizenRequestsScreen({super.key, this.connectivityOverride});

  final bool? connectivityOverride;

  @override
  ConsumerState<CitizenRequestsScreen> createState() =>
      _CitizenRequestsScreenState();
}

class _CitizenRequestsScreenState
    extends ConsumerState<CitizenRequestsScreen> {
  bool _isOffline = false;

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
  }

  Future<void> _checkConnectivity() async {
    final override = widget.connectivityOverride;
    if (override != null) {
      if (mounted) setState(() => _isOffline = !override);
      return;
    }
    try {
      final result = await Connectivity().checkConnectivity();
      if (mounted) {
        setState(() {
          _isOffline =
              result.isEmpty || result.first == ConnectivityResult.none;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isOffline = false);
    }
  }

  Color _statusColor(RequestStatus status) => switch (status) {
        RequestStatus.draft => Colors.grey,
        RequestStatus.submitted => Colors.blue,
        RequestStatus.acknowledged => Colors.indigo,
        RequestStatus.inProgress => Colors.orange,
        RequestStatus.resolved => Colors.green,
        RequestStatus.closed => Colors.teal,
        RequestStatus.rejected => Colors.red,
      };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final requestsAsync = ref.watch(citizenRequestsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Citizen Requests'),
        centerTitle: false,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/citizen/requests/new'),
        icon: const Icon(Icons.add),
        label: const Text('New Request'),
      ),
      body: Column(
        children: [
          if (_isOffline)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.orange.shade100,
              child: Row(
                children: [
                  Icon(Icons.cloud_off,
                      size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text(
                    'Offline — showing cached data',
                    style:
                        TextStyle(fontSize: 12, color: Colors.orange.shade800),
                  ),
                ],
              ),
            ),
          Expanded(
            child: requestsAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(child: Text('Error: $err')),
              data: (requests) {
                if (requests.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.assignment_outlined,
                            size: 48, color: theme.colorScheme.outline),
                        const SizedBox(height: 8),
                        Text('No requests filed yet',
                            style: TextStyle(
                                color: theme.colorScheme.outline)),
                      ],
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async {
                    await _checkConnectivity();
                    ref.invalidate(citizenRequestsProvider);
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: requests.length,
                    itemBuilder: (context, index) {
                      final req = requests[index];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          onTap: () =>
                              context.go('/citizen/requests/${req.id}'),
                          title: Text(req.subject,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w500),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis),
                          subtitle: Text(
                            '${req.requestNo} • ${req.category.name}',
                            style: TextStyle(
                                fontSize: 12,
                                color: theme.colorScheme.outline),
                          ),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: _statusColor(req.status)
                                      .withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(
                                  req.status.name,
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w500,
                                    color: _statusColor(req.status),
                                  ),
                                ),
                              ),
                              if (req.isSlaBreached) ...[
                                const SizedBox(height: 4),
                                Text('SLA BREACHED',
                                    style: TextStyle(
                                      fontSize: 9,
                                      color: Colors.red.shade700,
                                      fontWeight: FontWeight.bold,
                                    )),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
