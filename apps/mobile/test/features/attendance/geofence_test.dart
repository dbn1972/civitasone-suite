import 'package:flutter_test/flutter_test.dart';
import 'package:civitasone_mobile/features/attendance/models.dart';

void main() {
  group('GpsPosition.distanceTo (Haversine)', () {
    test('same point returns zero distance', () {
      final p = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 10,
        timestamp: DateTime.now(),
      );
      expect(p.distanceTo(p), closeTo(0, 0.01));
    });

    test('known distance: Delhi to Noida ~25km', () {
      final delhi = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 10,
        timestamp: DateTime.now(),
      );
      final noida = GpsPosition(
        latitude: 28.5355,
        longitude: 77.3910,
        accuracy: 10,
        timestamp: DateTime.now(),
      );
      final distance = delhi.distanceTo(noida);
      // Approx 18-20 km
      expect(distance, greaterThan(15000));
      expect(distance, lessThan(25000));
    });

    test('short distance within office compound ~100m', () {
      final gate = GpsPosition(
        latitude: 28.61390,
        longitude: 77.20900,
        accuracy: 5,
        timestamp: DateTime.now(),
      );
      final building = GpsPosition(
        latitude: 28.61400,
        longitude: 77.20920,
        accuracy: 5,
        timestamp: DateTime.now(),
      );
      final distance = gate.distanceTo(building);
      expect(distance, greaterThan(10));
      expect(distance, lessThan(200));
    });
  });

  group('GeoSite.containsPosition', () {
    test('position within radius returns true', () {
      final site = GeoSite(
        id: 'site-1',
        tenantId: 't1',
        name: 'Office HQ',
        center: GpsPosition(
          latitude: 28.6139,
          longitude: 77.2090,
          accuracy: 5,
          timestamp: DateTime.now(),
        ),
        radiusMeters: 100,
      );
      final position = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2091,
        accuracy: 10,
        timestamp: DateTime.now(),
      );
      expect(site.containsPosition(position), isTrue);
    });

    test('position outside radius returns false', () {
      final site = GeoSite(
        id: 'site-1',
        tenantId: 't1',
        name: 'Office HQ',
        center: GpsPosition(
          latitude: 28.6139,
          longitude: 77.2090,
          accuracy: 5,
          timestamp: DateTime.now(),
        ),
        radiusMeters: 50,
      );
      // Position ~2km away
      final position = GpsPosition(
        latitude: 28.6300,
        longitude: 77.2200,
        accuracy: 10,
        timestamp: DateTime.now(),
      );
      expect(site.containsPosition(position), isFalse);
    });
  });

  group('GpsSpoofingDetector', () {
    late GpsSpoofingDetector detector;

    setUp(() {
      detector = GpsSpoofingDetector();
    });

    test('mock location flag detected', () {
      final pos = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 10,
        timestamp: DateTime.now(),
      );
      expect(
        detector.isSpoofed(current: pos, isMockLocationEnabled: true),
        isTrue,
      );
    });

    test('suspiciously perfect accuracy detected', () {
      final pos = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 1.0, // too perfect
        timestamp: DateTime.now(),
      );
      expect(detector.isSuspiciousAccuracy(pos), isTrue);
    });

    test('normal accuracy is not suspicious', () {
      final pos = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 12.0,
        timestamp: DateTime.now(),
      );
      expect(detector.isSuspiciousAccuracy(pos), isFalse);
    });

    test('impossible speed transition detected', () {
      final now = DateTime.now();
      final prev = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 10,
        timestamp: now,
      );
      // 100km away in 1 second — impossible
      final current = GpsPosition(
        latitude: 29.5,
        longitude: 77.2090,
        accuracy: 10,
        timestamp: now.add(const Duration(seconds: 1)),
      );
      expect(detector.isSuspiciousTransition(prev, current), isTrue);
    });

    test('normal walking transition is not suspicious', () {
      final now = DateTime.now();
      final prev = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 10,
        timestamp: now,
      );
      // ~10m away in 10 seconds — normal walking
      final current = GpsPosition(
        latitude: 28.61395,
        longitude: 77.20905,
        accuracy: 10,
        timestamp: now.add(const Duration(seconds: 10)),
      );
      expect(detector.isSuspiciousTransition(prev, current), isFalse);
    });

    test('combined check: normal position passes', () {
      final pos = GpsPosition(
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 12.0,
        timestamp: DateTime.now(),
      );
      expect(
        detector.isSpoofed(current: pos, isMockLocationEnabled: false),
        isFalse,
      );
    });
  });
}
