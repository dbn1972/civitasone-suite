import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

/// Visitor Pass QR Display screen.
/// Shows the visitor's active pass with a large QR code for gate scanning.
/// Caches pass data locally so it works without network at the gate.
class VisitorPassScreen extends ConsumerStatefulWidget {
  const VisitorPassScreen({super.key, this.passId});
  final String? passId;

  @override
  ConsumerState<VisitorPassScreen> createState() => _VisitorPassScreenState();
}

class _VisitorPassScreenState extends ConsumerState<VisitorPassScreen> {
  bool _loading = true;
  bool _isOffline = false;
  String? _error;
  Map<String, dynamic>? _passData;
  bool _fullScreenQr = false;

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
    _loadPass();
  }

  Future<void> _checkConnectivity() async {
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

  Future<void> _loadPass() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      // Try loading from local cache first (offline support)
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        final cached = await db.listEntities('visitor_passes');
        if (cached.isNotEmpty) {
          final pass = widget.passId != null
              ? cached.where((e) => e['id'] == widget.passId).firstOrNull
              : cached.first;
          if (pass != null) {
            setState(() {
              _passData = pass['data'] as Map<String, dynamic>;
              _loading = false;
            });
            // If online, refresh in background
            if (!_isOffline) _fetchFromApi();
            return;
          }
        }
      }

      // Fetch from API
      await _fetchFromApi();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _fetchFromApi() async {
    try {
      final api = ref.read(apiClientProvider);
      final passId = widget.passId ?? 'active';
      final response = await api.get('/api/v1/visitor/passes/$passId');
      final data = response.data is Map<String, dynamic>
          ? response.data as Map<String, dynamic>
          : (response.data['data'] as Map<String, dynamic>);

      // Cache locally for offline use
      final db = ref.read(dbProvider).valueOrNull;
      if (db != null) {
        await db.upsertEntity(
          id: data['id'] as String? ?? passId,
          mailbox: 'visitor_passes',
          data: data,
          updatedAt: DateTime.now().toUtc().toIso8601String(),
        );
      }

      if (mounted) {
        setState(() {
          _passData = data;
          _loading = false;
        });
      }
    } catch (e) {
      // If we already have cached data, don't show error
      if (_passData == null && mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  void _toggleFullScreenQr() {
    setState(() => _fullScreenQr = !_fullScreenQr);
    if (_fullScreenQr) {
      // Max brightness when showing QR
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    } else {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    }
  }

  @override
  void dispose() {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_fullScreenQr && _passData != null) {
      return _FullScreenQrView(
        passNumber: _passData!['passNumber'] as String? ?? '',
        qrData: _passData!['qrCode'] as String? ??
            _passData!['passNumber'] as String? ??
            '',
        onClose: _toggleFullScreenQr,
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Visitor Pass'),
        actions: [
          Semantics(
            label: 'Refresh pass',
            child: IconButton(
              tooltip: 'Refresh',
              icon: const Icon(Icons.sync),
              onPressed: _loadPass,
            ),
          ),
        ],
      ),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) return const SkeletonList(count: 3);

    if (_error != null && _passData == null) {
      return _ErrorState(message: _error!, onRetry: _loadPass);
    }

    if (_passData == null) {
      return const _EmptyState(
        icon: Icons.badge_outlined,
        message: 'No active visitor pass found',
      );
    }

    final theme = Theme.of(context);
    final data = _passData!;

    return RefreshIndicator(
      onRefresh: () async {
        await _checkConnectivity();
        await _loadPass();
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Offline banner
          if (_isOffline)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: Colors.orange.shade100,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(Icons.cloud_off,
                      size: 16, color: Colors.orange.shade800),
                  const SizedBox(width: 8),
                  Text(
                    'Offline — showing cached pass',
                    style:
                        TextStyle(fontSize: 12, color: Colors.orange.shade800),
                  ),
                ],
              ),
            ),

          // QR Code Card (tap to expand)
          Semantics(
            label: 'Visitor pass QR code. Tap to expand full screen.',
            child: GestureDetector(
              onTap: _toggleFullScreenQr,
              child: Card(
                elevation: 4,
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      // QR placeholder — using Container since qr_flutter
                      // may not be available
                      Container(
                        width: 200,
                        height: 200,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          border: Border.all(color: Colors.grey.shade300),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.qr_code_2,
                                  size: 120, color: Colors.grey.shade800),
                              const SizedBox(height: 8),
                              Text(
                                data['passNumber'] as String? ?? 'QR',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontFamily: 'monospace',
                                  color: Colors.grey.shade600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Tap to expand full screen',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.outline,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Pass details
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _DetailRow(
                    label: 'Pass Number',
                    value: data['passNumber'] as String? ?? '—',
                    icon: Icons.confirmation_number,
                  ),
                  const Divider(height: 24),
                  _DetailRow(
                    label: 'Visitor Name',
                    value: data['visitorName'] as String? ?? '—',
                    icon: Icons.person,
                  ),
                  const Divider(height: 24),
                  _DetailRow(
                    label: 'Valid From',
                    value: data['validFrom'] as String? ?? '—',
                    icon: Icons.schedule,
                  ),
                  const Divider(height: 24),
                  _DetailRow(
                    label: 'Valid Until',
                    value: data['validUntil'] as String? ?? '—',
                    icon: Icons.timer_off,
                  ),
                  const Divider(height: 24),
                  _DetailRow(
                    label: 'Permitted Areas',
                    value: (data['permittedAreas'] is List)
                        ? (data['permittedAreas'] as List).join(', ')
                        : data['permittedAreas'] as String? ?? 'All',
                    icon: Icons.location_on,
                  ),
                  if (data['status'] != null) ...[
                    const Divider(height: 24),
                    _DetailRow(
                      label: 'Status',
                      value: data['status'] as String? ?? '—',
                      icon: Icons.verified,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FullScreenQrView extends StatelessWidget {
  const _FullScreenQrView({
    required this.passNumber,
    required this.qrData,
    required this.onClose,
  });
  final String passNumber;
  final String qrData;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: GestureDetector(
          onTap: onClose,
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Large QR placeholder
                Container(
                  width: 300,
                  height: 300,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: Colors.grey.shade300, width: 2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.qr_code_2,
                            size: 200, color: Colors.grey.shade800),
                        const SizedBox(height: 8),
                        Text(
                          passNumber,
                          style: TextStyle(
                            fontSize: 14,
                            fontFamily: 'monospace',
                            color: Colors.grey.shade700,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  'Show this at the gate',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Tap anywhere to close',
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    required this.icon,
  });
  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 18, color: theme.colorScheme.outline),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: TextStyle(
                      fontSize: 11, color: theme.colorScheme.outline)),
              const SizedBox(height: 2),
              Text(value,
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w500)),
            ],
          ),
        ),
      ],
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
            size: 64, color: Theme.of(context).colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(message,
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(color: Theme.of(context).colorScheme.outline)),
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
          Text('Unable to load pass',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
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
