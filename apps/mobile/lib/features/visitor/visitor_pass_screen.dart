import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/error_utils.dart';
import '../../core/providers.dart';
import '../../core/widgets/skeleton_card.dart';

class VisitorPassScreen extends ConsumerStatefulWidget {
  const VisitorPassScreen({super.key, this.passId = 'active'});
  final String passId;

  @override
  ConsumerState<VisitorPassScreen> createState() => _VisitorPassScreenState();
}

class _VisitorPassScreenState extends ConsumerState<VisitorPassScreen> {
  Map<String, dynamic>? _pass;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchPass();
  }

  Future<void> _fetchPass() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      final response = await client.get('/v1/visitor/passes/${widget.passId}');
      if (mounted) {
        setState(() {
          _pass = response.data['data'] as Map<String, dynamic>?;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = userFriendlyError(e);
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Visitor Pass'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.sync),
            onPressed: _fetchPass,
          ),
        ],
      ),
      body: _loading
          ? const SkeletonList(count: 3)
          : _error != null
              ? _ErrorState(message: _error!, onRetry: _fetchPass)
              : _pass == null
                  ? const _EmptyState()
                  : RefreshIndicator(
                      onRefresh: _fetchPass,
                      child: SingleChildScrollView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            // Visitor name
                            Semantics(
                              header: true,
                              child: Text(
                                _pass!['visitorName'] as String? ?? 'Visitor',
                                style: theme.textTheme.titleLarge,
                                textAlign: TextAlign.center,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Pass #${_pass!['passNumber'] ?? '—'}',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.outline,
                                fontFamily: 'monospace',
                              ),
                            ),
                            const SizedBox(height: 24),

                            // QR Code placeholder area
                            Semantics(
                              label: 'QR code for gate scanning',
                              child: Container(
                                width: 240,
                                height: 240,
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(
                                    color: theme.colorScheme.outlineVariant,
                                    width: 2,
                                  ),
                                ),
                                child: Center(
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        Icons.qr_code_2,
                                        size: 180,
                                        color: theme.colorScheme.onSurface,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),

                            // Instruction text
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.primaryContainer,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.security,
                                    size: 18,
                                    color: theme.colorScheme.primary,
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Show to security at gate',
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      color: theme.colorScheme.primary,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 24),

                            // Pass details card
                            Card(
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _DetailRow(
                                      label: 'Valid From',
                                      value: _pass!['validFrom'] as String? ?? '—',
                                    ),
                                    const Divider(height: 20),
                                    _DetailRow(
                                      label: 'Valid Until',
                                      value: _pass!['validUntil'] as String? ?? '—',
                                    ),
                                    const Divider(height: 20),
                                    _DetailRow(
                                      label: 'Permitted Areas',
                                      value: (_pass!['permittedAreas'] as List<dynamic>?)
                                              ?.join(', ') ??
                                          'All public areas',
                                    ),
                                    const Divider(height: 20),
                                    _DetailRow(
                                      label: 'Status',
                                      value: _pass!['status'] as String? ?? 'active',
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.outline,
                ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
          ),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.badge_outlined,
            size: 64, color: Theme.of(context).colorScheme.outlineVariant),
        const SizedBox(height: 16),
        Text(
          'No active visitor pass',
          style: Theme.of(context)
              .textTheme
              .bodyLarge
              ?.copyWith(color: Theme.of(context).colorScheme.outline),
        ),
        const SizedBox(height: 8),
        const Text(
          'Request a pass from the reception desk',
          style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
        ),
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
