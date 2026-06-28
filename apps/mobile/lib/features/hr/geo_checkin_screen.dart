import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';

/// Geo-fenced attendance check-in with camera selfie.
class GeoCheckinScreen extends ConsumerStatefulWidget {
  const GeoCheckinScreen({super.key});

  @override
  ConsumerState<GeoCheckinScreen> createState() => _GeoCheckinScreenState();
}

class _GeoCheckinScreenState extends ConsumerState<GeoCheckinScreen> {
  bool _locating = false;
  bool _submitting = false;
  bool _selfieTaken = false;
  String? _selfieKey;

  // Current position
  double? _latitude;
  double? _longitude;

  // Office geofence center (configurable per tenant)
  static const double _officeLat = 28.6139;
  static const double _officeLng = 77.2090;
  static const double _geofenceRadiusMeters = 200.0;

  // Result — populated from API response
  String? _resultStatus; // 'within_geofence' or 'outside_geofence'
  double? _distanceMeters;

  @override
  void initState() {
    super.initState();
    _fetchLocation();
  }

  Future<void> _fetchLocation() async {
    setState(() => _locating = true);
    try {
      // TODO(geolocator): Replace this simulation with a real GPS call once
      // the `geolocator` package is added to pubspec.yaml:
      //
      //   geolocator: ^11.0.0  (or latest)
      //
      // Then:
      //   import 'package:geolocator/geolocator.dart';
      //
      //   bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      //   if (!serviceEnabled) throw Exception('Location services disabled');
      //
      //   LocationPermission permission = await Geolocator.checkPermission();
      //   if (permission == LocationPermission.denied) {
      //     permission = await Geolocator.requestPermission();
      //   }
      //   if (permission == LocationPermission.deniedForever) {
      //     throw Exception('Location permission permanently denied');
      //   }
      //
      //   final position = await Geolocator.getCurrentPosition(
      //     desiredAccuracy: LocationAccuracy.high,
      //   );
      //   setState(() {
      //     _latitude = position.latitude;
      //     _longitude = position.longitude;
      //   });
      //
      // Also add the required platform permissions:
      //   Android: ACCESS_FINE_LOCATION in AndroidManifest.xml
      //   iOS: NSLocationWhenInUseUsageDescription in Info.plist
      await Future.delayed(const Duration(milliseconds: 800));
      setState(() {
        _latitude = 28.6145; // Simulated nearby position
        _longitude = 77.2085;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Location error: $e'), backgroundColor: Theme.of(context).colorScheme.error),
        );
      }
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  double _calculateDistance() {
    if (_latitude == null || _longitude == null) return 0;
    // Flat-earth approximation for short distances (<1km)
    final latDiff = (_latitude! - _officeLat) * 111320;
    final lngDiff = (_longitude! - _officeLng) * 111320 * math.cos(_officeLat * math.pi / 180);
    return math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  }

  Future<void> _takeSelfie() async {
    // TODO(image_picker): Replace with real camera capture once `image_picker`
    // is added to pubspec.yaml:
    //
    //   image_picker: ^1.1.0  (or latest)
    //
    // Then:
    //   import 'package:image_picker/image_picker.dart';
    //   final picker = ImagePicker();
    //   final photo = await picker.pickImage(
    //     source: ImageSource.camera,
    //     preferredCameraDevice: CameraDevice.front,
    //     imageQuality: 80,
    //   );
    //   if (photo == null) return; // user cancelled
    //   // Upload to presigned S3 URL or multipart POST, then store the returned key
    //   final selfieKey = await _uploadSelfie(photo.path);
    //   setState(() { _selfieTaken = true; _selfieKey = selfieKey; });
    await Future.delayed(const Duration(milliseconds: 500));
    setState(() {
      _selfieTaken = true;
      _selfieKey = 'selfie_${DateTime.now().millisecondsSinceEpoch}.jpg';
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Selfie captured'),
          backgroundColor: Color(0xFF15803D),
          duration: Duration(seconds: 1),
        ),
      );
    }
  }

  Future<void> _submitCheckin() async {
    if (_latitude == null || _longitude == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Location not available. Please wait.')),
      );
      return;
    }
    if (!_selfieTaken || _selfieKey == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please take a selfie first.')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final apiClient = ref.read(apiClientProvider);

      // POST /v1/hrms/attendance/geo-check-in
      final res = await apiClient.post<Map<String, dynamic>>(
        '/v1/hrms/attendance/geo-check-in',
        data: {
          'latitude': _latitude,
          'longitude': _longitude,
          'selfieKey': _selfieKey,
          'checkInTime': DateTime.now().toUtc().toIso8601String(),
        },
      );

      final status = res.data?['status'] as String? ?? 'outside_geofence';
      // Server-computed distance is authoritative when available; fall back to
      // the local Haversine approximation.
      final distance =
          (res.data?['distanceMeters'] as num?)?.toDouble() ??
          _calculateDistance();

      setState(() {
        _resultStatus = status;
        _distanceMeters = distance;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Check-in failed: $e'), backgroundColor: Theme.of(context).colorScheme.error),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Geo Check-In')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          // Map placeholder with geofence circle
          _buildMapSection(theme, colorScheme),
          const SizedBox(height: 24),

          // Location info
          _buildLocationCard(theme),
          const SizedBox(height: 16),

          // Selfie section
          _buildSelfieSection(theme, colorScheme),
          const SizedBox(height: 24),

          // Submit button
          FilledButton.icon(
            onPressed: _submitting ? null : _submitCheckin,
            icon: _submitting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.check_circle_outline),
            label: Text(_submitting ? 'Submitting…' : 'Mark Attendance'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
          const SizedBox(height: 24),

          // Result card
          if (_resultStatus != null) _buildResultCard(theme, colorScheme),
        ],
      ),
    );
  }

  Widget _buildMapSection(ThemeData theme, ColorScheme colorScheme) {
    return Container(
      height: 200,
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Geofence circle representation
          Container(
            width: 160,
            height: 160,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: colorScheme.primary.withOpacity(0.1),
              border: Border.all(
                color: colorScheme.primary.withOpacity(0.5),
                width: 2,
              ),
            ),
          ),
          // Office marker
          Icon(Icons.business, size: 28, color: colorScheme.primary),
          // User marker
          if (_latitude != null)
            Positioned(
              top: 70,
              left: 120,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: colorScheme.primary,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.person, size: 16, color: Colors.white),
              ),
            ),
          // Radius label
          Positioned(
            bottom: 12,
            right: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.black87,
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text(
                '200m radius',
                style: TextStyle(color: Colors.white, fontSize: 11),
              ),
            ),
          ),
          if (_locating)
            const CircularProgressIndicator(),
        ],
      ),
    );
  }

  Widget _buildLocationCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(
              _latitude != null ? Icons.location_on : Icons.location_searching,
              color: _latitude != null ? theme.colorScheme.primary : theme.colorScheme.outline,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _latitude != null ? 'Location acquired' : 'Fetching location…',
                    style: theme.textTheme.titleSmall,
                  ),
                  if (_latitude != null)
                    Text(
                      '${_latitude!.toStringAsFixed(5)}, ${_longitude!.toStringAsFixed(5)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                ],
              ),
            ),
            if (_locating)
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSelfieSection(ThemeData theme, ColorScheme colorScheme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: _selfieTaken
                    ? colorScheme.primary.withOpacity(0.1)
                    : colorScheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                _selfieTaken ? Icons.check_circle : Icons.camera_alt,
                color: _selfieTaken ? colorScheme.primary : colorScheme.outline,
                size: 28,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _selfieTaken ? 'Selfie captured' : 'Selfie required',
                    style: theme.textTheme.titleSmall,
                  ),
                  Text(
                    _selfieTaken
                        ? _selfieKey ?? ''
                        : 'Take a photo for attendance verification',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.outline,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            FilledButton.tonal(
              onPressed: _takeSelfie,
              child: Text(_selfieTaken ? 'Retake' : 'Capture'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildResultCard(ThemeData theme, ColorScheme colorScheme) {
    final isInside = _resultStatus == 'within_geofence';
    final resultColor = isInside ? colorScheme.primary : colorScheme.tertiary;

    return Card(
      color: resultColor.withOpacity(0.05),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: resultColor.withOpacity(0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Icon(
              isInside ? Icons.check_circle : Icons.warning_amber_rounded,
              color: resultColor,
              size: 48,
            ),
            const SizedBox(height: 12),
            Text(
              isInside ? 'Check-In Successful' : 'Outside Geofence',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
                color: resultColor,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Distance from office: ${_distanceMeters?.toStringAsFixed(0) ?? '—'}m',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: resultColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                _resultStatus!.replaceAll('_', ' ').toUpperCase(),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: resultColor,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
