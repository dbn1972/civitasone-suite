import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'models.dart';
import 'providers.dart';

/// Request detail screen with timeline and SLA indicator.
class RequestDetailScreen extends ConsumerWidget {
  const RequestDetailScreen({super.key, required this.requestId});

  final String requestId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final requestAsync = ref.watch(citizenRequestByIdProvider(requestId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Request Details'),
        centerTitle: false,
      ),
      body: requestAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (request) {
          if (request == null) {
            return const Center(child: Text('Request not found'));
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Header card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(request.subject,
                                style: theme.textTheme.titleMedium),
                          ),
                          _StatusChip(status: request.status),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(request.requestNo,
                          style: TextStyle(
                              fontSize: 13,
                              color: theme.colorScheme.outline)),
                      const SizedBox(height: 12),
                      _DetailRow('Category', request.category.name),
                      _DetailRow('Priority', request.priority.name.toUpperCase()),
                      if (request.citizenName != null)
                        _DetailRow('Filed by', request.citizenName!),
                      if (request.assignedTo != null)
                        _DetailRow('Assigned to', request.assignedTo!),
                      _DetailRow('Age', '${request.ageDays} days'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // SLA Card
              if (request.slaDeadline != null)
                Card(
                  color: request.isSlaBreached
                      ? Colors.red.shade50
                      : Colors.green.shade50,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Icon(
                          request.isSlaBreached
                              ? Icons.warning
                              : Icons.timer,
                          color: request.isSlaBreached
                              ? Colors.red
                              : Colors.green,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                request.isSlaBreached
                                    ? 'SLA Breached'
                                    : 'SLA Active',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: request.isSlaBreached
                                      ? Colors.red
                                      : Colors.green,
                                ),
                              ),
                              Text(
                                request.isSlaBreached
                                    ? '${(-request.slaHoursRemaining!)} hours overdue'
                                    : '${request.slaHoursRemaining} hours remaining',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: request.isSlaBreached
                                      ? Colors.red.shade700
                                      : Colors.green.shade700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 16),

              // Description
              if (request.description.isNotEmpty) ...[
                Text('Description', style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(request.description),
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // Documents
              if (request.documents != null &&
                  request.documents!.isNotEmpty) ...[
                Text('Attachments', style: theme.textTheme.titleSmall),
                const SizedBox(height: 8),
                ...request.documents!.map((doc) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: const Icon(Icons.attach_file),
                        title: Text(doc.fileName,
                            style: const TextStyle(fontSize: 14)),
                        subtitle: Text(doc.formattedSize,
                            style: TextStyle(
                                fontSize: 12,
                                color: theme.colorScheme.outline)),
                      ),
                    )),
                const SizedBox(height: 16),
              ],

              // Timeline
              Text('Timeline', style: theme.textTheme.titleSmall),
              const SizedBox(height: 12),
              if (request.timeline.isEmpty)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text('No activity yet',
                        style: TextStyle(color: theme.colorScheme.outline)),
                  ),
                )
              else
                ...request.timeline.map(
                    (entry) => _TimelineItem(entry: entry)),
            ],
          );
        },
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final RequestStatus status;

  Color get _color => switch (status) {
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: _color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status.name,
        style: TextStyle(
          color: _color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: TextStyle(color: Theme.of(context).colorScheme.outline)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _TimelineItem extends StatelessWidget {
  const _TimelineItem({required this.entry});
  final RequestTimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: 8, bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary,
                  shape: BoxShape.circle,
                ),
              ),
              Container(
                  width: 2,
                  height: 40,
                  color: theme.colorScheme.outline.withOpacity(0.3)),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.action,
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                Text(
                  '${entry.actor} • ${_formatDateTime(entry.timestamp)}',
                  style: TextStyle(
                      fontSize: 12, color: theme.colorScheme.outline),
                ),
                if (entry.remarks != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(entry.remarks!,
                        style: const TextStyle(fontSize: 13)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    final date =
        '${dt.day}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
    final time =
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    return '$date $time';
  }
}
