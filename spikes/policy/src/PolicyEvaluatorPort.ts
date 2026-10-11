/**
 * PolicyEvaluatorPort — the technology-neutral port that SmartTransfer's future
 * Policy Studio (spec §6) and allocation engine (spec §7) will depend on.
 *
 * SPIKE SCOPE (ST-M01-14): this interface is defined here so the spike can prove
 * a concrete ZEN-backed implementation satisfies it. It is NOT yet imported by
 * any production service. The production home for this port, if D-ST-07 adopts
 * ZEN, is `services/smarttransfer-service` (ST-M01-12), not `spikes/`.
 *
 * Design intent (binding on any future production port, informed by D-ST-07):
 *   - Rule packs are versioned and content-addressed (a packHash), so a decision
 *     can be replayed byte-for-byte from stored evidence (spec §7.3, §16).
 *   - Every decision returns a trace with, per evaluated rule, its rule id and a
 *     policy citation (policy id / GO reference / clause), so an order can cite
 *     the authority it was decided under (spec §6 traceability block).
 *   - Evaluation is pure w.r.t. (packHash, input): identical inputs on an
 *     identical pack yield identical outputs AND identical traces. This is the
 *     determinism contract the allocation engine's replay relies on.
 */

/** A single rule's provenance, mirroring the spec §6 traceability block. */
export interface PolicyCitation {
  /** Stable rule identifier inside the pack (e.g. "MIN-TENURE-36"). */
  readonly ruleId: string;
  /** Owner-supplied policy id (D-ST-15). SYNTHETIC in this spike. */
  readonly policyId: string;
  /** Government Order / notification reference. SYNTHETIC in this spike. */
  readonly goReference: string;
  /** Issuing authority. SYNTHETIC in this spike. */
  readonly issuingAuthority: string;
  /** Clause / paragraph within the GO. SYNTHETIC in this spike. */
  readonly clause: string;
  /** ISO-8601 date the rule becomes effective. */
  readonly effectiveFrom: string;
}

/** One node's execution record within a decision trace. */
export interface PolicyTraceEntry {
  /** The decision/node id that executed. */
  readonly nodeId: string;
  /** Human-readable node name. */
  readonly nodeName: string;
  /** Deterministic execution order within the graph. */
  readonly order: number;
  /** The rule id that fired, when the node is a decision table. */
  readonly ruleId?: string;
  /** The citation for the fired rule, resolved from the pack manifest. */
  readonly citation?: PolicyCitation;
  /** The node's input projection (for replay / audit). */
  readonly input: unknown;
  /** The node's output projection. */
  readonly output: unknown;
}

/** The full, replayable result of evaluating one input against one pack. */
export interface PolicyDecision<TOutput = Record<string, unknown>> {
  /** The pack that produced this decision. */
  readonly packId: string;
  /** Content hash of the pack definition, for replay verification. */
  readonly packHash: string;
  /** The decision output. */
  readonly output: TOutput;
  /** Ordered trace with per-decision rule id and citation (spec §6). */
  readonly trace: PolicyTraceEntry[];
  /**
   * A stable hash over (output + the citation-bearing trace), used to assert the
   * determinism contract across runs. Excludes wall-clock performance fields.
   */
  readonly decisionHash: string;
}

/** Metadata describing a loaded, versioned rule pack. */
export interface PolicyPackInfo {
  readonly packId: string;
  readonly version: string;
  readonly packHash: string;
  /** Whether the pack is SYNTHETIC (true for every pack in this spike). */
  readonly synthetic: boolean;
}

/**
 * The port. A production adapter is expected to be stateless per evaluation and
 * safe to call concurrently once packs are loaded.
 */
export interface PolicyEvaluatorPort {
  /** Load (or replace) a versioned rule pack. Returns its content hash. */
  loadPack(pack: RulePackDefinition): Promise<PolicyPackInfo>;

  /** List the currently loaded packs. */
  listPacks(): PolicyPackInfo[];

  /** Evaluate one input against one loaded pack, with a full citation trace. */
  evaluate<TOutput = Record<string, unknown>>(
    packId: string,
    input: Record<string, unknown>,
  ): Promise<PolicyDecision<TOutput>>;

  /** Release any native resources held by the adapter. */
  dispose(): void;
}

/** A rule pack: a ZEN JDM graph plus the citation manifest keyed by rule id. */
export interface RulePackDefinition {
  readonly packId: string;
  readonly version: string;
  /** Marks the pack as not-real-policy. Every spike pack sets this true. */
  readonly synthetic: boolean;
  /** The ZEN JDM decision graph (contentType application/vnd.gorules.decision). */
  readonly graph: unknown;
  /** rule id -> citation. Resolves the §6 traceability block for the trace. */
  readonly citations: Record<string, PolicyCitation>;
}
