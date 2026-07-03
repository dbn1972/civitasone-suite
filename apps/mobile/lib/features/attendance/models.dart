/// GPS Attendance data models.
///
/// Supports GPS check-in/out with selfie verification and geofencing.
/// All coordinates stored as doubles (latitude/longitude in degrees).

import 'dart:math' as math;

class GpsPosition {
  const GpsPosition({
    required this.latitude,
    required this.longitude,
    required this.accuracy,
    required this.timestamp,
  });

  final double latitude;
  final double longitude;

  /// Accuracy in meters.
  final double accuracy;
  final DateTime timestamp;

  /// Haversine distance in meters to another position.
  double distanceTo(GpsPosition other) {
    const earthRadius = 6371000.0; // meters
    final dLat = _toRadians(other.latitude - latitude);
    final dLng = _toRadians(other.longitude - longitude);
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_toRadians(latitude)) *
            math.cos(_toRadians(other.latitude)) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return earthRadius * c;
  }

  static double _toRadians(double degrees) => degrees * math.pi / 180;

  Map<String, dynamic> toJson() => {
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'timestamp': timestamp.toIso8601String(),
      };

  factory GpsPosition.fromJson(Map<String, dynamic> json) => GpsPosition(
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        accuracy: (json['accuracy'] as num).toDouble(),
        timestamp: DateTime.parse(json['timestamp'] as String),
      );
}

enum CheckInType { checkIn, checkOut }

class CheckInRecord {
  const CheckInRecord({
    required this.id,
    required this.tenantId,
    required this.employeeId,
    required this.type,
    required this.position,
    required this.createdAt,
    this.selfieUrl,
    this.siteId,
    this.notes,
  });

  final String id;
  final String tenantId;
  final String employeeId;
  final CheckInType type;
  final GpsPosition position;
  final DateTime createdAt;
  final String? selfieUrl;
  final String? siteId;
  final String? notes;

  /// Duration since check-in (useful for calculating shift hours).
  Duration get elapsed => DateTime.now().toUtc().difference(createdAt);

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'employeeId': employeeId,
        'type': type.name,
        'position': position.toJson(),
        'createdAt': createdAt.toIso8601String(),
        'selfieUrl': selfieUrl,
        'siteId': siteId,
        'notes': notes,
      };

  factory CheckInRecord.fromJson(Map<String, dynamic> json) => CheckInRecord(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        employeeId: json['employeeId'] as String,
        type: CheckInType.values.firstWhere(
          (t) => t.name == (json['type'] as String? ?? 'checkIn'),
          orElse: () => CheckInType.checkIn,
        ),
        position:
            GpsPosition.fromJson(json['position'] as Map<String, dynamic>),
        createdAt: DateTime.parse(json['createdAt'] as String),
        selfieUrl: json['selfieUrl'] as String?,
        siteId: json['siteId'] as String?,
        notes: json['notes'] as String?,
      );
}

class GeoSite {
  const GeoSite({
    required this.id,
    required this.tenantId,
    required this.name,
    required this.center,
    required this.radiusMeters,
  });

  final String id;
  final String tenantId;
  final String name;
  final GpsPosition center;

  /// Geofence radius in meters.
  final double radiusMeters;

  /// Whether a given position is within this site's geofence.
  bool containsPosition(GpsPosition position) {
    return center.distanceTo(position) <= radiusMeters;
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'name': name,
        'center': center.toJson(),
        'radiusMeters': radiusMeters,
      };

  factory GeoSite.fromJson(Map<String, dynamic> json) => GeoSite(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        name: json['name'] as String,
        center: GpsPosition.fromJson(json['center'] as Map<String, dynamic>),
        radiusMeters: (json['radiusMeters'] as num).toDouble(),
      );
}

/// Detects GPS spoofing by checking for impossible speed, accuracy anomalies,
/// and mock location flags.
class GpsSpoofingDetector {
  GpsSpoofingDetector();

  /// Max realistic speed in m/s (~120 km/h).
  static const double maxSpeedMs = 33.33;

  /// Min acceptable accuracy in meters.
  static const double minAccuracyThreshold = 5.0;

  /// Check if the transition between two positions is suspicious.
  bool isSuspiciousTransition(GpsPosition previous, GpsPosition current) {
    final distance = previous.distanceTo(current);
    final timeDelta =
        current.timestamp.difference(previous.timestamp).inMilliseconds / 1000;
    if (timeDelta <= 0) return true;
    final speed = distance / timeDelta;
    return speed > maxSpeedMs;
  }

  /// Check if accuracy is suspiciously perfect (likely mock).
  bool isSuspiciousAccuracy(GpsPosition position) {
    return position.accuracy < minAccuracyThreshold && position.accuracy > 0;
  }

  /// Combined spoofing check.
  bool isSpoofed({
    required GpsPosition current,
    GpsPosition? previous,
    bool isMockLocationEnabled = false,
  }) {
    if (isMockLocationEnabled) return true;
    if (isSuspiciousAccuracy(current)) return true;
    if (previous != null && isSuspiciousTransition(previous, current)) {
      return true;
    }
    return false;
  }
}
