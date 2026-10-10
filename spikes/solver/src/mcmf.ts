/**
 * mcmf.ts — an exact integer min-cost max-flow using the successive-shortest-path
 * method with JOHNSON POTENTIALS and a Dijkstra inner loop (binary heap). This is
 * the efficient standard for the assignment problem: an initial Bellman-Ford/SPFA
 * pass establishes feasible potentials for the (possibly negative) edge costs,
 * after which every augmentation is a Dijkstra on reduced, non-negative costs.
 *
 * Determinism: the heap breaks distance ties by node index, edges are explored in
 * insertion order, and all arithmetic is on JS safe integers, so the same graph
 * yields the same flow on arm64 and x64.
 */

interface Edge {
  to: number;
  cap: number;
  cost: number;
  flow: number;
  rev: number; // index of the reverse edge in graph[to]
}

/** A tiny deterministic binary min-heap of (distance, node), ties by node. */
class Heap {
  private a: Array<[number, number]> = [];
  get size(): number {
    return this.a.length;
  }
  push(dist: number, node: number): void {
    const a = this.a;
    a.push([dist, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i]!, a[p]!)) {
        [a[i], a[p]] = [a[p]!, a[i]!];
        i = p;
      } else break;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
function less(x: [number, number], y: [number, number]): boolean {
  return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
}

export class MinCostMaxFlow {
  private readonly graph: Edge[][];
  private readonly n: number;

  constructor(n: number) {
    this.n = n;
    this.graph = Array.from({ length: n }, () => []);
  }

  /** Add a directed edge u→v with capacity and (possibly negative) cost. */
  addEdge(u: number, v: number, cap: number, cost: number): void {
    this.graph[u]!.push({ to: v, cap, cost, flow: 0, rev: this.graph[v]!.length });
    this.graph[v]!.push({ to: u, cap: 0, cost: -cost, flow: 0, rev: this.graph[u]!.length - 1 });
  }

  /** Run SSP from s to t. Returns { flow, cost }. */
  run(s: number, t: number): { flow: number; cost: number } {
    const INF = Number.MAX_SAFE_INTEGER;
    const n = this.n;

    // Phase 1: Bellman-Ford/SPFA to get initial potentials h[] that make reduced
    // costs non-negative on every edge with residual capacity.
    const h = new Array<number>(n).fill(INF);
    h[s] = 0;
    {
      const inQueue = new Array<boolean>(n).fill(false);
      const queue: number[] = [s];
      inQueue[s] = true;
      while (queue.length > 0) {
        const u = queue.shift()!;
        inQueue[u] = false;
        const du = h[u]!;
        const edges = this.graph[u]!;
        for (let i = 0; i < edges.length; i++) {
          const e = edges[i]!;
          if (e.cap - e.flow > 0 && du + e.cost < h[e.to]!) {
            h[e.to] = du + e.cost;
            if (!inQueue[e.to]) {
              inQueue[e.to] = true;
              queue.push(e.to);
            }
          }
        }
      }
      // Nodes unreachable from s keep INF; normalise so arithmetic is safe.
      for (let i = 0; i < n; i++) if (h[i] === INF) h[i] = 0;
    }

    let totalFlow = 0;
    let totalCost = 0;

    const dist = new Array<number>(n);
    const prevNode = new Array<number>(n);
    const prevEdge = new Array<number>(n);

    for (;;) {
      dist.fill(INF);
      prevNode.fill(-1);
      prevEdge.fill(-1);
      dist[s] = 0;
      const heap = new Heap();
      heap.push(0, s);
      while (heap.size > 0) {
        const [d, u] = heap.pop();
        if (d > dist[u]!) continue;
        const edges = this.graph[u]!;
        for (let i = 0; i < edges.length; i++) {
          const e = edges[i]!;
          if (e.cap - e.flow <= 0) continue;
          const reduced = e.cost + h[u]! - h[e.to]!;
          const nd = d + reduced;
          if (nd < dist[e.to]!) {
            dist[e.to] = nd;
            prevNode[e.to] = u;
            prevEdge[e.to] = i;
            heap.push(nd, e.to);
          }
        }
      }

      if (dist[t] === INF) break; // no augmenting path.

      // Update potentials.
      for (let i = 0; i < n; i++) {
        if (dist[i]! < INF) h[i] = h[i]! + dist[i]!;
      }

      // Bottleneck (always 1 for unit-capacity assignment; general for safety).
      let push = INF;
      for (let v = t; v !== s; v = prevNode[v]!) {
        const e = this.graph[prevNode[v]!]![prevEdge[v]!]!;
        push = Math.min(push, e.cap - e.flow);
      }
      let pathCost = 0;
      for (let v = t; v !== s; v = prevNode[v]!) {
        const e = this.graph[prevNode[v]!]![prevEdge[v]!]!;
        e.flow += push;
        this.graph[e.to]![e.rev]!.flow -= push;
        pathCost += e.cost;
      }
      totalFlow += push;
      totalCost += push * pathCost;
    }

    return { flow: totalFlow, cost: totalCost };
  }

  /** After run(), the forward edges that carry flow. */
  flowEdges(): Array<{ u: number; v: number; flow: number }> {
    const out: Array<{ u: number; v: number; flow: number }> = [];
    for (let u = 0; u < this.n; u++) {
      for (const e of this.graph[u]!) {
        if (e.cap > 0 && e.flow > 0) out.push({ u, v: e.to, flow: e.flow });
      }
    }
    return out;
  }
}
