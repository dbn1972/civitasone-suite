import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:uuid/uuid.dart';
import '../../core/providers.dart';
import 'models.dart';
import 'providers.dart';

/// GPS Check-in screen. ONE action: check in or check out.
/// Shows GPS status, selfie capture, and large action button.
class GpsCheckInScreen extends ConsumerStatefulWidget {
  const GpsCheckInScreen({super.key, this.connectivityOverride});

  final bool? connectivityOverride;

  @override
  ConsumerState<GpsCheckInScreen> createState() => _GpsCheckInScreenState();
}

class _GpsCheckInScreenState extends ConsumerState<GpsCheckInScreen> {
  bool _isOffline = false;
  bool _submitting = false;
  bool _selfieCaptured = false;
  GpsPosition? _currentPosition;
  String? _gpsError;
  bool _gpsAcquiring = true;

  @override
  void initState() {
    super.initState();
    _checkConnectivity();
    _acquireGps();
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

  Future<void> _acquireGps() async {
    // Simulated GPS acquisition — in production, use geolocator package.
    await Future.delayed(const Duration(milliseconds: 800));
    if (mounted) {
      setState(() {
        _currentPosition = GpsPosition(
          latitude: 28.6139,
          longitude: 77.2090,
          accuracy: 12.0,
          timestamp: DateTime.now().toUtc(),
        );
        _gpsAcquiring = false;
      });
    }
  }

  Future<void> _captureSelfie() async {
    // In production: open camera for selfie.
    await Future.delayed(const Duration(milliseconds: 300));
    if (mounted) setState(() => _selfieCaptured = true);
  }

  Future<void> _submit(CheckInType type) async {
    if (_currentPosition == null) return;

    setState(() => _submitting = true);

    final record = CheckInRecord(
      id: const Uuid().v4(),
      tenantId: '',
      employeeId: 'current-user',
      type: type,
      position: _currentPosition!,
      createdAt: DateTime.now().toUtc(),
      selfieUrl: _selfieCaptured ? 'selfie://captured' : null,
    );

    final db = ref.read(dbProvider).valueOrNull;
    if (db != null) {
      await db.enqueueOutbox(
        mailbox: 'attendance',
        operation: 'create',
        entityId: record.id,
        payload: record.toJson(),
      );
      await db.upsertEntity(
        id: record.id,
        mailbox: 'attendance',
        data: record.toJson(),
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        syncState: 'pending',
      );
    }

    ref.read(syncEngineProvider)?.syncMailbox('attendance');

    setState(() => _submitting = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(type == CheckInType.checkIn
              ? 'Checked in successfully'
              : 'Checked out successfully'),
          backgroundColor: Colors.green,
        ),
      );
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Ensure dbProvider resolves before submit.
    ref.watch(dbProvider);
    final latestCheckIn = ref.watch(latestCheckInProvider);
    final isCheckedIn = latestCheckIn.valueOrNull?.type == CheckInType.checkIn;
    final actionType =
        isCheckedIn ? CheckInType.checkOut : CheckInType.checkIn;

    return Scaffold(
      appBar: AppBar(
        title: const Text('GPS Check-In'),
        centerTitle: false,
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await _checkConnectivity();
          await _acquireGps();
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Offline banner
            if (_isOffline)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
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
                      'Offline — will sync when connected',
                      style: TextStyle(
                          fontSize: 12, color: Colors.orange.shade800),
                    ),
                  ],
                ),
              ),

            // GPS Status Card
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          _gpsAcquiring
                              ? Icons.gps_not_fixed
                              : _gpsError != null
                                  ? Icons.gps_off
                                  : Icons.gps_fixed,
                          color: _gpsAcquiring
                              ? Colors.orange
                              : _gpsError != null
                                  ? Colors.red
                                  : Colors.green,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'GPS Status',
                          style: theme.textTheme.titleSmall,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_gpsAcquiring)
                      const Text('Acquiring location...')
                    else if (_gpsError != null)
                      Text(_gpsError!,
                          style: const TextStyle(color: Colors.red))
                    else
                      Text(
                        'Lat: ${_currentPosition!.latitude.toStringAsFixed(4)}, '
                        'Lng: ${_currentPosition!.longitude.toStringAsFixed(4)}\n'
                        'Accuracy: ${_currentPosition!.accuracy.toStringAsFixed(0)}m',
                        style: TextStyle(
                            fontSize: 13, color: theme.colorScheme.outline),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Selfie section
            Card(
              child: InkWell(
                onTap: _captureSelfie,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 28,
                        backgroundColor: _selfieCaptured
                            ? Colors.green.withOpacity(0.1)
                            : theme.colorScheme.surfaceContainerHighest,
                        child: Icon(
                          _selfieCaptured
                              ? Icons.check_circle
                              : Icons.camera_alt,
                          color: _selfieCaptured
                              ? Colors.green
                              : theme.colorScheme.outline,
                          size: 28,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _selfieCaptured
                                  ? 'Selfie captured'
                                  : 'Capture selfie',
                              style: theme.textTheme.titleSmall,
                            ),
                            Text(
                              _selfieCaptured
                                  ? 'Tap to retake'
                                  : 'Required for verification',
                              style: TextStyle(
                                  fontSize: 12,
                                  color: theme.colorScheme.outline),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 32),

            // Main action button — 56dp height for thumb-friendly tap
            SizedBox(
              height: 56,
              child: FilledButton.icon(
                onPressed: (_gpsAcquiring || _submitting)
                    ? null
                    : () => _submit(actionType),
                icon: Icon(actionType == CheckInType.checkIn
                    ? Icons.login
                    : Icons.logout),
                label: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : Text(
                        actionType == CheckInType.checkIn
                            ? 'Check In'
                            : 'Check Out',
                        style: const TextStyle(fontSize: 18),
                      ),
                style: FilledButton.styleFrom(
                  backgroundColor: actionType == CheckInType.checkIn
                      ? Colors.green
                      : Colors.red,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
