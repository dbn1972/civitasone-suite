/// Evidence Capture Screen — camera capture with GPS tagging.
///
/// Features:
/// - Camera capture with GPS tagging (from device, not user-typed)
/// - EXIF metadata extraction
/// - SHA-256 hash computation on capture
/// - Queue for upload (offline-first)
/// - Progress indicator for uploads
///
/// SVC-102: Mobile Inspection Checklist
library;

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/inspection_models.dart';
import '../providers/inspection_provider.dart';

/// Screen for capturing evidence (photos) during an inspection.
class EvidenceCaptureScreen extends ConsumerStatefulWidget {
  final String inspectionId;

  const EvidenceCaptureScreen({
    super.key,
    required this.inspectionId,
  });

  @override
  ConsumerState<EvidenceCaptureScreen> createState() => _EvidenceCaptureScreenState();
}

class _EvidenceCaptureScreenState extends ConsumerState<EvidenceCaptureScreen> {
  bool _isCapturing = false;
  String? _lastCapturedPath;

  @override
  Widget build(BuildContext context) {
    final queueState = ref.watch(evidenceQueueProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Capture Evidence'),
        actions: [
          // Upload queue badge
          Badge(
            label: Text('${queueState.totalPending}'),
            isLabelVisible: queueState.totalPending > 0,
            child: IconButton(
              icon: const Icon(Icons.cloud_upload),
              onPressed: queueState.totalPending > 0
                  ? () => ref.read(evidenceQueueProvider.notifier).processQueue()
                  : null,
              tooltip: 'Upload pending evidence',
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Camera preview area
          Expanded(
            flex: 3,
            child: _CameraPreview(
              isCapturing: _isCapturing,
              lastCapturedPath: _lastCapturedPath,
            ),
          ),
          // Capture controls
          Expanded(
            flex: 1,
            child: _CaptureControls(
              isCapturing: _isCapturing,
              onCapture: _handleCapture,
            ),
          ),
          // Upload queue status
          if (queueState.totalPending > 0 || queueState.uploading.isNotEmpty)
            _UploadQueueStatus(queueState: queueState),
        ],
      ),
    );
  }

  Future<void> _handleCapture() async {
    setState(() => _isCapturing = true);

    try {
      // TODO: wire to actual camera capture
      // 1. Open camera and capture photo
      // 2. Get GPS coordinates from device location service
      // 3. Extract EXIF metadata
      // 4. Compute SHA-256 hash of the file
      // 5. Create EvidenceCapture record
      // 6. Queue for upload

      // Simulated capture flow:
      await Future<void>.delayed(const Duration(seconds: 1));

      final capturedAt = DateTime.now().toIso8601String();
      const deviceId = 'device-placeholder'; // TODO: wire to actual device ID
      const filePath = '/tmp/evidence_placeholder.jpg'; // TODO: wire to actual captured file

      // TODO: wire to actual GPS service
      const gpsLatitude = 28.6139;
      const gpsLongitude = 77.2090;

      // TODO: wire to actual SHA-256 computation
      const sha256Hash = 'placeholder_sha256_hash';

      final evidence = EvidenceCapture(
        id: DateTime.now().millisecondsSinceEpoch.toString(), // TODO: use UUID
        inspectionId: widget.inspectionId,
        filePath: filePath,
        mimeType: 'image/jpeg',
        sha256Hash: sha256Hash,
        gpsLatitude: gpsLatitude,
        gpsLongitude: gpsLongitude,
        capturedAt: capturedAt,
        deviceId: deviceId,
      );

      // Queue for upload
      ref.read(evidenceQueueProvider.notifier).enqueue(evidence);
      ref.read(inspectionSyncProvider.notifier).addPendingUpload();

      setState(() {
        _lastCapturedPath = filePath;
        _isCapturing = false;
      });

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Evidence captured and queued for upload'),
          duration: Duration(seconds: 2),
        ),
      );
    } catch (e) {
      setState(() => _isCapturing = false);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Capture failed: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }
}

/// Camera preview placeholder.
class _CameraPreview extends StatelessWidget {
  final bool isCapturing;
  final String? lastCapturedPath;

  const _CameraPreview({
    required this.isCapturing,
    this.lastCapturedPath,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black,
      child: Center(
        child: isCapturing
            ? const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: Colors.white),
                  SizedBox(height: 16),
                  Text(
                    'Capturing...',
                    style: TextStyle(color: Colors.white),
                  ),
                ],
              )
            : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    lastCapturedPath != null ? Icons.check_circle : Icons.camera_alt,
                    color: Colors.white54,
                    size: 64,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    lastCapturedPath != null
                        ? 'Last capture: ${lastCapturedPath!.split('/').last}'
                        : 'Camera preview will appear here',
                    style: const TextStyle(color: Colors.white54),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'GPS coordinates will be auto-captured',
                    style: TextStyle(color: Colors.white38, fontSize: 12),
                  ),
                ],
              ),
      ),
    );
  }
}

/// Capture button and controls.
class _CaptureControls extends StatelessWidget {
  final bool isCapturing;
  final VoidCallback onCapture;

  const _CaptureControls({
    required this.isCapturing,
    required this.onCapture,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surface,
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Capture button
            GestureDetector(
              onTap: isCapturing ? null : onCapture,
              child: Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isCapturing
                      ? Colors.grey
                      : Theme.of(context).colorScheme.primary,
                  border: Border.all(
                    color: Theme.of(context).colorScheme.outline,
                    width: 4,
                  ),
                ),
                child: Icon(
                  Icons.camera,
                  color: Colors.white,
                  size: 32,
                  semanticLabel: 'Capture evidence photo',
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Tap to capture',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

/// Shows the status of the upload queue.
class _UploadQueueStatus extends StatelessWidget {
  final EvidenceQueueState queueState;

  const _UploadQueueStatus({required this.queueState});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Row(
        children: [
          if (queueState.uploading.isNotEmpty) ...[
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 8),
            Text(
              'Uploading ${queueState.uploading.length} file(s)...',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ] else ...[
            Icon(
              Icons.cloud_queue,
              size: 16,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Text(
              '${queueState.totalPending} file(s) pending upload',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const Spacer(),
          if (queueState.totalCompleted > 0)
            Text(
              '${queueState.totalCompleted} uploaded ✓',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.green,
                  ),
            ),
        ],
      ),
    );
  }
}
