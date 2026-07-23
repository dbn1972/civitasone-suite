/// Inspection List Screen — shows assigned inspections from local DB/sync package.
///
/// Features:
/// - List of assigned inspections (from sync package)
/// - Sync status indicator (last sync time, pending uploads count)
/// - Pull-to-refresh triggers sync
/// - Tap to start inspection → navigates to checklist fill screen
///
/// SVC-102: Mobile Inspection Checklist
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/inspection_models.dart';
import '../providers/inspection_provider.dart';

/// Screen showing the list of assigned inspections.
class InspectionListScreen extends ConsumerWidget {
  const InspectionListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final syncState = ref.watch(inspectionSyncProvider);
    final inspections = syncState.package?.inspections ?? [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inspections'),
        actions: [
          // Sync status indicator
          _SyncStatusChip(syncState: syncState),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(inspectionSyncProvider.notifier).downloadPackage(),
        child: inspections.isEmpty
            ? _buildEmptyState(context, ref)
            : _buildInspectionList(context, ref, inspections),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context, WidgetRef ref) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.assignment_outlined,
            size: 64,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          const SizedBox(height: 16),
          Text(
            'No inspections assigned',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Pull down to sync or check back later',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: () => ref.read(inspectionSyncProvider.notifier).downloadPackage(),
            icon: const Icon(Icons.sync),
            label: const Text('Sync Now'),
          ),
        ],
      ),
    );
  }

  Widget _buildInspectionList(
    BuildContext context,
    WidgetRef ref,
    List<SyncInspection> inspections,
  ) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: inspections.length,
      itemBuilder: (context, index) {
        final inspection = inspections[index];
        return _InspectionCard(
          inspection: inspection,
          onTap: () {
            // TODO: wire to actual navigation
            // context.push('/inspection/checklist/${inspection.checklistInstanceId}');
          },
        );
      },
    );
  }
}

/// Card showing a single inspection assignment.
class _InspectionCard extends StatelessWidget {
  final SyncInspection inspection;
  final VoidCallback onTap;

  const _InspectionCard({
    required this.inspection,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Inspection ${inspection.id.substring(0, 8)}',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                  _StatusBadge(status: inspection.status),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    Icons.calendar_today,
                    size: 16,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    inspection.scheduledDate,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Icon(
                    Icons.business,
                    size: 16,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Entity: ${inspection.entityId.substring(0, 8)}...',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Status badge for inspection state.
class _StatusBadge extends StatelessWidget {
  final String status;

  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      'scheduled' => (Colors.blue, 'Scheduled'),
      'in_progress' => (Colors.orange, 'In Progress'),
      'completed' => (Colors.green, 'Completed'),
      _ => (Colors.grey, status),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
      ),
    );
  }
}

/// Chip showing current sync status.
class _SyncStatusChip extends StatelessWidget {
  final InspectionSyncState syncState;

  const _SyncStatusChip({required this.syncState});

  @override
  Widget build(BuildContext context) {
    final (icon, label) = switch (syncState.status) {
      SyncStatus.idle => (Icons.cloud_off, 'Not synced'),
      SyncStatus.downloading => (Icons.cloud_download, 'Syncing...'),
      SyncStatus.ready => (Icons.cloud_done, 'Ready'),
      SyncStatus.uploading => (Icons.cloud_upload, 'Uploading...'),
      SyncStatus.synced => (Icons.cloud_done, 'Synced'),
      SyncStatus.error => (Icons.cloud_off, 'Error'),
    };

    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Chip(
        avatar: Icon(icon, size: 16),
        label: Text(label, style: Theme.of(context).textTheme.labelSmall),
        visualDensity: VisualDensity.compact,
      ),
    );
  }
}
