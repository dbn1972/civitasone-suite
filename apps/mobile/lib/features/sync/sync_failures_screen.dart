import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/sync/write_outbox.dart';

/// Screen displaying dead-lettered (failed) sync commands with manual retry.
///
/// Each entry shows:
/// - Target service/topic
/// - Operation type (POST/PUT/PATCH)
/// - Failure reason
/// - Timestamp
///
/// Each entry has a "Retry" button that calls `outbox.retryDead(id)` to move
/// the command back to pending for re-sync.
///
/// **Validates: Requirement 4.8**
class SyncFailuresScreen extends ConsumerWidget {
  const SyncFailuresScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final deadEntriesAsync = ref.watch(deadEntriesProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sync Failures'),
        centerTitle: false,
      ),
      body: deadEntriesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 48, color: theme.colorScheme.error),
              const SizedBox(height: 12),
              Text(
                'Failed to load sync failures',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => ref.invalidate(deadEntriesProvider),
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (entries) {
          if (entries.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check_circle_outline,
                      size: 64, color: theme.colorScheme.primary),
                  const SizedBox(height: 16),
                  Text(
                    'All synced',
                    style: theme.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'No failed commands to retry.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.outline,
                    ),
                  ),
                ],
              ),
            );
          }

          return ListView.builder(
            itemCount: entries.length,
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemBuilder: (context, index) {
              final entry = entries[index];
              return _FailedCommandTile(entry: entry);
            },
          );
        },
      ),
    );
  }
}

/// Individual tile for a failed sync command with retry action.
class _FailedCommandTile extends ConsumerWidget {
  const _FailedCommandTile({required this.entry});

  final WriteOutboxEntry entry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final service = entry.service ?? _extractService(entry.topic);
    final operation = (entry.method ?? 'POST').toUpperCase();
    final failureReason = entry.lastError ?? 'Unknown error';
    final timestamp = _formatTimestamp(entry.createdAt);

    return Semantics(
      label: 'Failed command to $service. $operation operation. '
          'Error: $failureReason. Created $timestamp. '
          'Double tap to retry.',
      child: Card(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row: service + operation badge
              Row(
                children: [
                  Icon(Icons.cloud_off,
                      size: 20, color: theme.colorScheme.error),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      service,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      operation,
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Topic
              Text(
                entry.topic,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.outline,
                ),
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
              const SizedBox(height: 4),

              // Failure reason
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_amber,
                      size: 14, color: theme.colorScheme.error),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      failureReason,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.error,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Bottom row: timestamp + retry button
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    timestamp,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.outline,
                    ),
                  ),
                  // ≥ 48dp touch target for accessibility
                  SizedBox(
                    height: 48,
                    child: TextButton.icon(
                      onPressed: () => _retry(ref),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Retry'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _retry(WidgetRef ref) async {
    final outbox = ref.read(writeOutboxProvider);
    if (outbox == null) return;
    await outbox.retryDead(entry.id);
    // Refresh the dead entries list
    ref.invalidate(deadEntriesProvider);
  }

  /// Extract the service name from a topic string like 'hrms.leave.create'.
  String _extractService(String topic) {
    final parts = topic.split('.');
    if (parts.isNotEmpty) return parts.first;
    return topic;
  }

  /// Format ISO 8601 timestamp to a human-readable relative or absolute string.
  String _formatTimestamp(String isoTimestamp) {
    try {
      final dt = DateTime.parse(isoTimestamp);
      final now = DateTime.now().toUtc();
      final diff = now.difference(dt);

      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';

      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return isoTimestamp;
    }
  }
}
