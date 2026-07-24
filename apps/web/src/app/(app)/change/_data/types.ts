/** change/release feature — shared view types (SVC-130). */

export type ChangeStatus =
  | "draft" | "submitted" | "approved" | "rejected"
  | "scheduled" | "in_progress" | "completed" | "rolled_back";

export type ChangeType = "standard" | "normal" | "emergency";
export type ChangeRisk = "low" | "medium" | "high";
export type PirOutcome = "success" | "rolled_back";

export interface ChangeRequest {
  id: string;
  title: string;
  type: ChangeType;
  risk: ChangeRisk;
  affectedServices: string[];
  description: string;
  rollbackPlan: string | null;
  status: ChangeStatus;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  releaseNotes: string | null;
  pirOutcome: PirOutcome | null;
  pirNotes: string | null;
  pirAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeAuditEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string;
  note: string | null;
  at: string;
}

export interface ChangeDetail {
  data: ChangeRequest;
  audit: ChangeAuditEntry[];
}

export interface ChangeFreeze {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}
