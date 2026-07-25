/**
 * CAP-026 — Parallel / conditional / quorum approvals (pure domain).
 *
 * Two independent, side-effect-free primitives:
 *  - tallyQuorum: committee/board decision over a fixed membership under one of
 *    three rules (majority / unanimous / threshold), returning an EARLY decision
 *    the moment the outcome is mathematically settled (so a board need not wait
 *    for stragglers once approval is unreachable or already secured).
 *  - consolidateParallel: fold the outcomes of parallel workflow branches into
 *    a single result under an all-must or any policy.
 */

export type QuorumRule = "majority" | "unanimous" | "threshold";
export type VoteChoice = "approve" | "reject" | "abstain";
export type Outcome = "approve" | "reject";

export interface QuorumInput {
  rule: QuorumRule;
  /** Total eligible members of the committee. */
  totalMembers: number;
  /** Approvals required — only for rule='threshold'. */
  threshold?: number | null;
  votes: VoteChoice[];
}

export interface QuorumTally {
  approvals: number;
  rejections: number;
  abstentions: number;
  /** Non-null votes cast (approve|reject|abstain). */
  cast: number;
  /** Members who have not yet voted. */
  pending: number;
  decided: boolean;
  outcome: Outcome | null;
  rationale: string;
}

/**
 * Tally a committee decision. A decision is returned as soon as it is settled:
 *  - majority: approve once approvals exceed half the membership; reject once
 *    approval is unreachable (approvals + still-pending can no longer exceed
 *    half) or rejections already exceed half.
 *  - unanimous: approve only when EVERY member voted approve; reject the instant
 *    any member rejects, or once all have voted and unanimity was not reached
 *    (an abstention breaks unanimity).
 *  - threshold(N): approve once approvals reach N; reject once N is unreachable.
 */
export function tallyQuorum(input: QuorumInput): QuorumTally {
  const total = Math.max(0, Math.trunc(input.totalMembers));
  let approvals = 0;
  let rejections = 0;
  let abstentions = 0;
  for (const v of input.votes) {
    if (v === "approve") approvals++;
    else if (v === "reject") rejections++;
    else abstentions++;
  }
  const cast = approvals + rejections + abstentions;
  const pending = Math.max(0, total - cast);
  const base: Omit<QuorumTally, "decided" | "outcome" | "rationale"> = {
    approvals,
    rejections,
    abstentions,
    cast,
    pending,
  };

  const settle = (outcome: Outcome | null, rationale: string): QuorumTally => ({
    ...base,
    decided: outcome !== null,
    outcome,
    rationale,
  });

  if (total <= 0) return settle(null, "no eligible members");

  switch (input.rule) {
    case "majority": {
      const half = total / 2;
      if (approvals > half) return settle("approve", `majority reached (${approvals}/${total})`);
      if (rejections > half) return settle("reject", `majority rejected (${rejections}/${total})`);
      // approval unreachable even if every pending member approves
      if (approvals + pending <= half) {
        return settle("reject", `approval unreachable (max ${approvals + pending}/${total})`);
      }
      return settle(null, `pending (${approvals} approve / ${rejections} reject / ${pending} awaited)`);
    }
    case "unanimous": {
      if (rejections > 0) return settle("reject", "unanimity broken by a rejection");
      if (approvals === total) return settle("approve", `unanimous (${approvals}/${total})`);
      if (pending === 0) return settle("reject", "all voted but not unanimous (abstention present)");
      return settle(null, `pending unanimity (${approvals}/${total}, ${pending} awaited)`);
    }
    case "threshold": {
      const need = Math.max(1, Math.trunc(input.threshold ?? 0));
      if (approvals >= need) return settle("approve", `threshold met (${approvals}/${need})`);
      if (approvals + pending < need) {
        return settle("reject", `threshold unreachable (max ${approvals + pending}/${need})`);
      }
      return settle(null, `pending threshold (${approvals}/${need}, ${pending} awaited)`);
    }
  }
}

export type BranchOutcome = "approve" | "reject" | "pending";
export type ParallelMode = "all" | "any";

export interface ParallelResult {
  outcome: BranchOutcome;
  approvals: number;
  rejections: number;
  pending: number;
  rationale: string;
}

/**
 * Consolidate parallel branch outcomes.
 *  - all (all-must): approve only when every branch approved; reject the instant
 *    any branch rejected; otherwise pending.
 *  - any (any-one): approve the instant any branch approved; reject only when
 *    every branch rejected; otherwise pending.
 */
export function consolidateParallel(mode: ParallelMode, branches: BranchOutcome[]): ParallelResult {
  const approvals = branches.filter((b) => b === "approve").length;
  const rejections = branches.filter((b) => b === "reject").length;
  const pending = branches.filter((b) => b === "pending").length;
  const n = branches.length;
  const base = { approvals, rejections, pending };

  if (n === 0) return { ...base, outcome: "pending", rationale: "no branches" };

  if (mode === "all") {
    if (rejections > 0) return { ...base, outcome: "reject", rationale: "a required branch rejected" };
    if (approvals === n) return { ...base, outcome: "approve", rationale: "all branches approved" };
    return { ...base, outcome: "pending", rationale: `${approvals}/${n} branches approved` };
  }
  // any
  if (approvals > 0) return { ...base, outcome: "approve", rationale: "a branch approved" };
  if (rejections === n) return { ...base, outcome: "reject", rationale: "all branches rejected" };
  return { ...base, outcome: "pending", rationale: `awaiting a branch approval (${rejections}/${n} rejected)` };
}
