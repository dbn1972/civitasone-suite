/**
 * Determinism harness for D-ST-07 criteria (4) and (5):
 *   (4) identical outputs AND traces on identical inputs across 3 runs — hashed.
 *   (5) per-decision rule id and citation available in the trace.
 *
 * For each synthetic pack it evaluates a fixed synthetic sample 3 times, hashes
 * (a) the concatenation of per-record output hashes and (b) the concatenation of
 * per-record citation-trace hashes, and asserts all 3 runs agree. It also checks
 * that every decision's trace carries a ruleId and a resolved citation for the
 * decision-table node. Writes a JSON report to argv[2].
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ZenPolicyEvaluator, canonicalJson } from "./ZenPolicyEvaluator.js";
import type { PolicyDecision } from "./PolicyEvaluatorPort.js";
import { syntheticPacks } from "./rulepacks.js";
import { generateWorkforce, type SyntheticEmployee } from "./generate.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function toInput(emp: SyntheticEmployee): Record<string, unknown> {
  return {
    tenureMonths: emp.tenureMonths,
    hardshipPosting: emp.hardshipPosting,
    sensitivePost: emp.sensitivePost,
    monthsInPost: emp.monthsInPost,
    medicalGround: emp.medicalGround,
    spouseGround: emp.spouseGround,
    disability: emp.disability,
  };
}

export interface PackDeterminismResult {
  packId: string;
  packHash: string;
  sampleSize: number;
  outputHashPerRun: string[];
  traceHashPerRun: string[];
  outputsIdentical: boolean;
  tracesIdentical: boolean;
  everyDecisionHasRuleId: boolean;
  everyDecisionHasCitation: boolean;
  pass: boolean;
}

export interface DeterminismReport {
  runs: number;
  seed: number;
  node: string;
  arch: string;
  timestampUtc: string;
  packs: PackDeterminismResult[];
  allPass: boolean;
}

async function evaluateSample(
  packId: string,
  sample: SyntheticEmployee[],
): Promise<PolicyDecision[]> {
  const evaluator = new ZenPolicyEvaluator();
  for (const p of syntheticPacks) await evaluator.loadPack(p);
  const decisions: PolicyDecision[] = [];
  for (const emp of sample) {
    decisions.push(await evaluator.evaluate(packId, toInput(emp)));
  }
  evaluator.dispose();
  return decisions;
}

export async function runDeterminism(
  runs: number,
  seed: number,
  sampleSize: number,
): Promise<DeterminismReport> {
  const sample = generateWorkforce(sampleSize, seed);
  const packResults: PackDeterminismResult[] = [];

  for (const pack of syntheticPacks) {
    const outputHashPerRun: string[] = [];
    const traceHashPerRun: string[] = [];
    let everyDecisionHasRuleId = true;
    let everyDecisionHasCitation = true;
    let packHash = "";

    for (let r = 0; r < runs; r++) {
      const decisions = await evaluateSample(pack.packId, sample);
      packHash = decisions[0]?.packHash ?? "";
      // Hash the ORDERED outputs and the ORDERED citation traces separately.
      outputHashPerRun.push(
        sha256(decisions.map((d) => canonicalJson(d.output)).join("|")),
      );
      traceHashPerRun.push(
        sha256(
          decisions
            .map((d) =>
              canonicalJson(
                d.trace.map((t) => ({
                  nodeId: t.nodeId,
                  order: t.order,
                  ruleId: t.ruleId,
                  citation: t.citation,
                  output: t.output,
                })),
              ),
            )
            .join("|"),
        ),
      );
      // Criterion 5: the decision-table node must carry ruleId + citation.
      for (const d of decisions) {
        const dtEntry = d.trace.find((t) => t.ruleId !== undefined);
        if (!dtEntry?.ruleId) everyDecisionHasRuleId = false;
        if (!dtEntry?.citation) everyDecisionHasCitation = false;
      }
    }

    const outputsIdentical = outputHashPerRun.every((h) => h === outputHashPerRun[0]);
    const tracesIdentical = traceHashPerRun.every((h) => h === traceHashPerRun[0]);
    packResults.push({
      packId: pack.packId,
      packHash,
      sampleSize,
      outputHashPerRun,
      traceHashPerRun,
      outputsIdentical,
      tracesIdentical,
      everyDecisionHasRuleId,
      everyDecisionHasCitation,
      pass:
        outputsIdentical &&
        tracesIdentical &&
        everyDecisionHasRuleId &&
        everyDecisionHasCitation,
    });
  }

  return {
    runs,
    seed,
    node: process.version,
    arch: process.arch,
    timestampUtc: new Date().toISOString(),
    packs: packResults,
    allPass: packResults.every((p) => p.pass),
  };
}

async function main(): Promise<void> {
  const outPath = process.argv[2] ?? "bench-results/determinism.json";
  const runs = Number(process.argv[3] ?? 3);
  const seed = Number(process.argv[4] ?? 20261009);
  const sampleSize = Number(process.argv[5] ?? 2000);

  const report = await runDeterminism(runs, seed, sampleSize);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  if (!report.allPass) process.exit(2);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
