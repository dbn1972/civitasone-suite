/**
 * routes/domain.ts — Route optimization scoring and status tracking.
 * Nearest-neighbour heuristic for route planning.
 */

export type RouteStatus = "draft" | "optimized" | "in_progress" | "completed";

export interface Waypoint {
  taskId: string;
  latitude: number;
  longitude: number;
  priority: number;
  /** Time window start (optional, ISO time). */
  windowStart?: string | undefined;
  /** Time window end (optional, ISO time). */
  windowEnd?: string | undefined;
}

export interface RouteScore {
  totalDistanceKm: number;
  estimatedDurationMinutes: number;
  priorityCoverage: number; // 0–1 ratio of high-priority tasks in first half
}

/**
 * Haversine distance between two points in km.
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate total route distance for a given ordering.
 */
export function calculateRouteDistance(waypoints: Waypoint[], order: number[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    const prev = waypoints[order[i - 1]!]!;
    const curr = waypoints[order[i]!]!;
    total += haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Optimize route ordering using nearest-neighbour heuristic with priority weighting.
 * Returns an optimized order of indices.
 */
export function optimizeRouteOrder(waypoints: Waypoint[]): number[] {
  if (waypoints.length <= 1) return waypoints.map((_, i) => i);
  if (waypoints.length === 2) return [0, 1];

  // Sort by priority first (higher priority = lower number), then use nearest-neighbour
  const prioritySorted = waypoints
    .map((w, i) => ({ idx: i, priority: w.priority }))
    .sort((a, b) => a.priority - b.priority);

  // Start from highest priority task
  const visited = new Set<number>();
  const order: number[] = [];
  let current = prioritySorted[0]!.idx;
  visited.add(current);
  order.push(current);

  while (order.length < waypoints.length) {
    let nearestIdx = -1;
    let nearestScore = Infinity;

    for (let i = 0; i < waypoints.length; i++) {
      if (visited.has(i)) continue;
      const w = waypoints[i]!;
      const curr = waypoints[current]!;
      const dist = haversineKm(curr.latitude, curr.longitude, w.latitude, w.longitude);
      // Score combines distance and priority (lower priority number = more urgent)
      const score = dist * (1 + w.priority * 0.1);
      if (score < nearestScore) {
        nearestScore = score;
        nearestIdx = i;
      }
    }

    if (nearestIdx >= 0) {
      visited.add(nearestIdx);
      order.push(nearestIdx);
      current = nearestIdx;
    }
  }

  return order;
}

/**
 * Score a route for quality metrics.
 */
export function scoreRoute(waypoints: Waypoint[], order: number[]): RouteScore {
  const totalDistanceKm = calculateRouteDistance(waypoints, order);
  // Estimate 30 km/h average speed in urban areas + 15 min per stop
  const estimatedDurationMinutes = Math.round((totalDistanceKm / 30) * 60 + order.length * 15);

  // Priority coverage: ratio of priority 1-2 tasks in first half of route
  const halfIdx = Math.ceil(order.length / 2);
  const firstHalf = order.slice(0, halfIdx);
  const highPriorityInFirstHalf = firstHalf.filter((i) => waypoints[i]!.priority <= 2).length;
  const totalHighPriority = waypoints.filter((w) => w.priority <= 2).length;
  const priorityCoverage = totalHighPriority > 0 ? highPriorityInFirstHalf / totalHighPriority : 1;

  return { totalDistanceKm, estimatedDurationMinutes, priorityCoverage: Math.round(priorityCoverage * 100) / 100 };
}

/**
 * Validate route status transition.
 */
export function validateRouteTransition(from: RouteStatus, to: RouteStatus): string | null {
  const allowed: Record<RouteStatus, RouteStatus[]> = {
    draft: ["optimized"],
    optimized: ["in_progress", "draft"],
    in_progress: ["completed"],
    completed: [],
  };
  if (!allowed[from]?.includes(to)) {
    return `invalid route transition: ${from} → ${to}`;
  }
  return null;
}
