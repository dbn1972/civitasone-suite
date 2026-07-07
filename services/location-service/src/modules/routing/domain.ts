/**
 * Routing domain logic — pure functions for waypoint validation
 * and distance/time computation helpers.
 *
 * No I/O — all external provider calls happen in the adapter.
 */

export interface Waypoint {
  lat: number;
  lng: number;
}

export interface RoutingResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
}

/**
 * Validates that a waypoint array has between 2 and 25 entries
 * and each coordinate is within valid ranges.
 */
export function validateWaypoints(waypoints: Waypoint[]): string | null {
  if (waypoints.length < 2) {
    return "At least 2 waypoints are required";
  }
  if (waypoints.length > 25) {
    return "Maximum 25 waypoints allowed";
  }

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]!;
    if (wp.lat < -90 || wp.lat > 90) {
      return `Waypoint ${i}: latitude must be between -90 and 90`;
    }
    if (wp.lng < -180 || wp.lng > 180) {
      return `Waypoint ${i}: longitude must be between -180 and 180`;
    }
  }

  return null;
}

/**
 * Computes the Haversine distance between two points in meters.
 * Used as a fallback when the routing provider is unavailable.
 */
export function haversineDistanceMeters(a: Waypoint, b: Waypoint): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Computes total straight-line distance across all waypoints in sequence.
 * Returns distance in meters.
 */
export function totalStraightLineDistance(waypoints: Waypoint[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineDistanceMeters(waypoints[i - 1]!, waypoints[i]!);
  }
  return Math.round(total);
}
