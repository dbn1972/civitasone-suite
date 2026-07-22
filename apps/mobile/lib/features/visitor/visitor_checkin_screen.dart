import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/error_utils.dart';
import '../../core/providers.dart';

class VisitorCheckinScreen extends ConsumerStatefulWidget {
  const VisitorCheckinScreen({super.key});

  @override
  ConsumerState<VisitorCheckinScreen> createState() =>
      _VisitorCheckinScreenState();
}

class _VisitorCheckinScreenState extends ConsumerState<VisitorCheckinScreen> {
  bool _loading = false;
  bool _checkedIn = false;
  String? _error;
  String? _checkinTime;

  Future<void> _checkIn() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final client = ref.read(apiClientProvider);
      final response = await client.post('/v1/visitor/checkin', data: {
        'arrivedAt': DateTime.now().toUtc().toIso8601String(),
      });
      if (mounted) {
        final data = response.data['data'] as Map<String, dynamic>?;
        setState(() {
          _checkedIn = true;
          _checkinTime = data?['checkedInAt'] as String? ??
              DateTime.now().toIso8601String();
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
        title: const Text('Visitor Check-In'),
      ),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Status icon
                Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    color: _checkedIn
                        ? const Color(0xFF22C55E).withOpacity(0.1)
                        : theme.colorScheme.primaryContainer,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    _checkedIn ? Icons.check_circle : Icons.location_on,
                    size: 48,
                    color: _checkedIn
                        ? const Color(0xFF22C55E)
                        : theme.colorScheme.primary,
                  ),
                ),
                const SizedBox(height: 24),

                // Title
                Text(
                  _checkedIn ? 'Checked In!' : 'Self-Service Check-In',
                  style: theme.textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),

                // Subtitle
                Text(
                  _checkedIn
                      ? 'Arrival recorded at $_checkinTime'
                      : 'Tap the button below to notify the host of your arrival.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.outline,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),

                // Error message
                if (_error != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.errorContainer,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.error_outline,
                            size: 20, color: theme.colorScheme.error),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _error!,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.error,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],

                // Action button
                if (!_checkedIn)
                  SizedBox(
                    width: double.infinity,
                    child: Semantics(
                      label: 'Confirm arrival and check in',
                      child: FilledButton.icon(
                        onPressed: _loading ? null : _checkIn,
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          minimumSize: const Size(48, 48),
                        ),
                        icon: _loading
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.touch_app),
                        label: Text(
                          _loading ? 'Checking in…' : "I've Arrived",
                          style: const TextStyle(fontSize: 16),
                        ),
                      ),
                    ),
                  ),

                if (_checkedIn) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Your host has been notified.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: const Color(0xFF22C55E),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
