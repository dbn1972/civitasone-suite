import { withRawTenantGuc } from "@civitasone/db";
import { sqlClientFor } from "../../shared/db.js";

export type EOfficeNotification = {
  id: string;
  kind: "file_overdue" | "dfa_pending_approval" | "dfa_awaiting_dispatch" | "module_decision";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  at: string;
  link: string;
};

/**
 * Unified eOffice notification stream, composed from estab-service's own tables
 * (no cross-service SQL). Surfaces overdue files, DFAs awaiting approval/dispatch,
 * and recent module decisions.
 */
export async function getNotifications(tenantId: string, limit: number): Promise<EOfficeNotification[]> {
  const items: EOfficeNotification[] = [];
  // Tier-routed client: pool tenants → shared DB, silo tenants → their own DB.
  const sqlClient = await sqlClientFor(tenantId);

  // files.estab_files / files.estab_dfa / files.module_decision_log all have
  // RLS ENABLEd AND FORCEd. This module has no Drizzle schema for these
  // composite reads, so there is no db.transaction() — the only place
  // wrapWithTenantGuc sets app.tenant_id — in the call path. Without this,
  // the connecting role (estab_svc, not a superuser) gets zero rows back on
  // every call, silently: RLS fails CLOSED, and this notification stream
  // would be permanently empty for every tenant. See @civitasone/db's
  // withRawTenantGuc for the shared fix.
  const { overdue, pendingDfa, awaitingDispatch, decisions } = await withRawTenantGuc(
    sqlClient,
    tenantId,
    async (tx) => {
      // Overdue active files (pendency SLA breached).
      const overdue = await tx`
        SELECT id, file_no, subject, due_by
        FROM files.estab_files
        WHERE tenant_id = ${tenantId} AND status = 'active' AND due_by IS NOT NULL AND due_by < NOW()
        ORDER BY due_by ASC
        LIMIT ${limit}
      `;

      // DFAs awaiting approval.
      const pendingDfa = await tx`
        SELECT id, dfa_no, subject, updated_at
        FROM files.estab_dfa
        WHERE tenant_id = ${tenantId} AND status = 'pending_approval'
        ORDER BY updated_at ASC
        LIMIT ${limit}
      `;

      // DFAs approved/signed but not yet dispatched.
      const awaitingDispatch = await tx`
        SELECT id, dfa_no, subject, updated_at
        FROM files.estab_dfa
        WHERE tenant_id = ${tenantId} AND status IN ('approved', 'signed')
        ORDER BY updated_at ASC
        LIMIT ${limit}
      `;

      // Recent module decisions emitted back to source modules.
      const decisions = await tx`
        SELECT id, file_id, source_ref_type, decision, decided_at
        FROM files.module_decision_log
        WHERE tenant_id = ${tenantId}
        ORDER BY decided_at DESC
        LIMIT ${limit}
      `;

      return { overdue, pendingDfa, awaitingDispatch, decisions };
    },
  );

  for (const r of overdue as unknown as Array<{ id: string; file_no: string; subject: string; due_by: string }>) {
    items.push({
      id: `overdue:${r.id}`, kind: "file_overdue", severity: "critical",
      title: `Overdue: ${r.file_no}`, detail: r.subject,
      at: new Date(r.due_by).toISOString(), link: `/estab/files/${r.id}`,
    });
  }

  for (const r of pendingDfa as unknown as Array<{ id: string; dfa_no: string; subject: string; updated_at: string }>) {
    items.push({
      id: `dfa_pa:${r.id}`, kind: "dfa_pending_approval", severity: "warning",
      title: `DFA awaiting approval: ${r.dfa_no}`, detail: r.subject,
      at: new Date(r.updated_at).toISOString(), link: `/estab/dfa/${r.id}`,
    });
  }

  for (const r of awaitingDispatch as unknown as Array<{ id: string; dfa_no: string; subject: string; updated_at: string }>) {
    items.push({
      id: `dfa_disp:${r.id}`, kind: "dfa_awaiting_dispatch", severity: "info",
      title: `Ready to dispatch: ${r.dfa_no}`, detail: r.subject,
      at: new Date(r.updated_at).toISOString(), link: `/estab/dfa/${r.id}`,
    });
  }

  for (const r of decisions as unknown as Array<{ id: string; file_id: string; source_ref_type: string; decision: string; decided_at: string }>) {
    items.push({
      id: `decision:${r.id}`, kind: "module_decision",
      severity: r.decision === "rejected" ? "warning" : "info",
      title: `${r.source_ref_type} ${r.decision}`,
      detail: `Decision flowed back to the originating module`,
      at: new Date(r.decided_at).toISOString(), link: `/estab/files/${r.file_id}`,
    });
  }

  // Newest first, capped.
  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}
