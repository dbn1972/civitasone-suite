/**
 * ZenPolicyEvaluator — a GoRules ZEN (@gorules/zen-engine, pinned 2.1.4, MIT)
 * implementation of PolicyEvaluatorPort, for the ST-M01-14 spike (D-ST-07).
 *
 * This file lives under spikes/ and is NOT imported by any production service.
 * It gathers the data D-ST-07 needs; the adoption decision stays the owner's.
 *
 * How it satisfies the port contract:
 *   - loadPack: compiles the JDM graph once via engine.createDecision and
 *     content-addresses the pack (sha256 over the canonicalised graph).
 *   - evaluate: runs decision.evaluate(input, { trace: true }), then rewrites
 *     ZEN's node trace into a citation-bearing PolicyTraceEntry[] by resolving
 *     each fired rule's `_id` against the pack's citation manifest (spec §6).
 *   - decisionHash: sha256 over the canonicalised (output + citation trace),
 *     deliberately excluding ZEN's wall-clock `performance` strings, so the
 *     hash is stable across runs on identical (packHash, input).
 */

import { createHash } from "node:crypto";
import { ZenEngine, type ZenDecision } from "@gorules/zen-engine";
import type {
  PolicyCitation,
  PolicyDecision,
  PolicyEvaluatorPort,
  PolicyPackInfo,
  PolicyTraceEntry,
  RulePackDefinition,
} from "./PolicyEvaluatorPort.js";

/** Deterministic JSON: object keys sorted recursively, so hashes are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

interface LoadedPack {
  readonly def: RulePackDefinition;
  readonly info: PolicyPackInfo;
  readonly decision: ZenDecision;
}

/** The raw ZEN per-node trace shape (subset of ZenEngineTrace we rely on). */
interface ZenNodeTrace {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  order: number;
  traceData?: { rule?: { _id?: string }; index?: number } | null;
}

export class ZenPolicyEvaluator implements PolicyEvaluatorPort {
  private readonly engine: ZenEngine;
  private readonly packs = new Map<string, LoadedPack>();

  constructor() {
    this.engine = new ZenEngine();
  }

  async loadPack(pack: RulePackDefinition): Promise<PolicyPackInfo> {
    const packHash = sha256(canonicalJson(pack.graph));
    const decision = this.engine.createDecision(
      pack.graph as Parameters<ZenEngine["createDecision"]>[0],
    );
    const info: PolicyPackInfo = {
      packId: pack.packId,
      version: pack.version,
      packHash,
      synthetic: pack.synthetic,
    };
    this.packs.set(pack.packId, { def: pack, info, decision });
    return info;
  }

  listPacks(): PolicyPackInfo[] {
    return [...this.packs.values()].map((p) => p.info);
  }

  async evaluate<TOutput = Record<string, unknown>>(
    packId: string,
    input: Record<string, unknown>,
  ): Promise<PolicyDecision<TOutput>> {
    const pack = this.packs.get(packId);
    if (!pack) throw new Error(`policy pack not loaded: ${packId}`);

    const res = await pack.decision.evaluate(input, { trace: true });
    const rawTrace = (res.trace ?? {}) as Record<string, ZenNodeTrace>;

    const trace: PolicyTraceEntry[] = Object.values(rawTrace)
      .sort((a, b) => a.order - b.order)
      .map((node) => {
        const ruleId = node.traceData?.rule?._id;
        const citation: PolicyCitation | undefined = ruleId
          ? pack.def.citations[ruleId]
          : undefined;
        return {
          nodeId: node.id,
          nodeName: node.name,
          order: node.order,
          ...(ruleId ? { ruleId } : {}),
          ...(citation ? { citation } : {}),
          input: node.input,
          output: node.output,
        } satisfies PolicyTraceEntry;
      });

    // decisionHash excludes wall-clock performance fields by construction:
    // we only hash the citation-bearing trace (ids, citations, io) + output.
    const decisionHash = sha256(
      canonicalJson({ output: res.result, trace }),
    );

    return {
      packId: pack.info.packId,
      packHash: pack.info.packHash,
      output: res.result as TOutput,
      trace,
      decisionHash,
    };
  }

  dispose(): void {
    this.engine.dispose();
    this.packs.clear();
  }
}
