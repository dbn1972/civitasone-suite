"use client";
/**
 * LeadAssignmentControl — AS-001 (assign), AS-002 (transfer) and AS-004 (accept)
 * on the lead detail. Three governed actions, each confirmed in a ConfirmDialog
 * and worded honestly for async (202) vs sync (200) results:
 *   • Assign — hand to a specific owner, or run the configured rule chain.
 *   • Accept — the assignee accepts a pending lead.
 *   • Transfer — move ownership to another owner.
 * After any action we refresh so the assignment log/ageing panel reflects it.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, Segmented } from "../ds";
import { assignLead, acceptLead, transferOwnership } from "@/lib/crm/assignment";

type Pending = "assign" | "accept" | "transfer" | null;

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

const ASSIGN_MODES = ["Run rules", "Specific owner"] as const;

export function LeadAssignmentControl({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [assignMode, setAssignMode] = useState<string>(ASSIGN_MODES[0]);
  const [assignOwner, setAssignOwner] = useState("");
  const [transferOwner, setTransferOwner] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  const bySpecificOwner = assignMode === ASSIGN_MODES[1];

  function beginAssign() {
    setError("");
    setMessage("");
    if (bySpecificOwner && !assignOwner.trim()) {
      setError("Enter the owner id to assign this lead to.");
      return;
    }
    setPending("assign");
  }

  function beginTransfer() {
    setError("");
    setMessage("");
    if (!transferOwner.trim()) {
      setError("Enter the owner id to transfer this lead to.");
      return;
    }
    setPending("transfer");
  }

  async function run(reason?: string) {
    setBusy(true);
    setError("");
    try {
      let accepted = false;
      if (pending === "assign") {
        const r = await assignLead(leadId, bySpecificOwner ? { ownerId: assignOwner.trim() } : { runRules: true });
        accepted = r.accepted;
        setMessage(
          accepted
            ? "Assignment submitted — it may take a moment to take effect."
            : bySpecificOwner
              ? `Lead assigned to ${assignOwner.trim()}.`
              : "Lead assigned by the rule chain.",
        );
        setAssignOwner("");
      } else if (pending === "accept") {
        const r = await acceptLead(leadId);
        accepted = r.accepted;
        setMessage(accepted ? "Acceptance submitted — it may take a moment to take effect." : "Lead accepted.");
      } else if (pending === "transfer") {
        const r = await transferOwnership(leadId, transferOwner.trim(), (reason ?? "").trim());
        accepted = r.accepted;
        setMessage(
          accepted
            ? "Transfer submitted — it may take a moment to take effect."
            : `Ownership transferred to ${transferOwner.trim()}.`,
        );
        setTransferOwner("");
      }
      setPending(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the action.");
    } finally {
      setBusy(false);
    }
  }

  const dialog = {
    assign: {
      title: bySpecificOwner ? `Assign lead to ${assignOwner.trim()}?` : "Assign this lead by rules?",
      description: bySpecificOwner
        ? "The lead's owner will change and the assignment will be recorded in the audit log."
        : "The configured rule chain will pick an owner. The result is recorded in the audit log.",
      confirmLabel: "Assign lead",
    },
    accept: {
      title: "Accept this lead?",
      description: "You will be recorded as having accepted responsibility for this lead.",
      confirmLabel: "Accept lead",
    },
    transfer: {
      title: `Transfer ownership to ${transferOwner.trim()}?`,
      description: "The current owner will lose the lead. This is recorded in the audit log.",
      confirmLabel: "Transfer lead",
    },
  } as const;
  const active = pending ? dialog[pending] : null;

  return (
    <div className="card">
      <div className="card-h"><h3 id={headingId}>Assignment</h3></div>
      <div className="pad" style={{ display: "grid", gap: 18 }}>
        {/* AS-001 assign */}
        <section aria-label="Assign lead" style={{ display: "grid", gap: 10 }}>
          <div style={labelStyle}>Assign</div>
          <Segmented options={[...ASSIGN_MODES]} value={assignMode} onChange={setAssignMode} />
          {bySpecificOwner ? (
            <div>
              <label htmlFor={`${headingId}-owner`} style={labelStyle}>Owner id</label>
              <input
                id={`${headingId}-owner`}
                value={assignOwner}
                onChange={(e) => setAssignOwner(e.target.value)}
                placeholder="owner id"
                aria-required="true"
                style={inputStyle}
              />
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              Runs the configured assignment rules to pick the owner automatically.
            </p>
          )}
          <div>
            <button type="button" className="btn primary" onClick={beginAssign} style={{ minHeight: 44 }}>
              {bySpecificOwner ? "Assign to owner" : "Run assignment rules"}
            </button>
          </div>
        </section>

        {/* AS-004 accept */}
        <section aria-label="Accept lead" style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={labelStyle}>Accept</div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            Confirm you are taking on this lead so it stops counting as unaccepted.
          </p>
          <div>
            <button type="button" className="btn" onClick={() => { setError(""); setMessage(""); setPending("accept"); }} style={{ minHeight: 44 }}>
              Accept lead
            </button>
          </div>
        </section>

        {/* AS-002 transfer */}
        <section aria-label="Transfer ownership" style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={labelStyle}>Transfer ownership</div>
          <div>
            <label htmlFor={`${headingId}-transfer`} style={labelStyle}>Transfer to owner id</label>
            <input
              id={`${headingId}-transfer`}
              value={transferOwner}
              onChange={(e) => setTransferOwner(e.target.value)}
              placeholder="owner id"
              style={inputStyle}
            />
          </div>
          <div>
            <button type="button" className="btn" onClick={beginTransfer} style={{ minHeight: 44 }}>
              Transfer lead
            </button>
          </div>
        </section>

        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
      </div>

      <ConfirmDialog
        open={active !== null}
        title={active?.title ?? ""}
        description={active?.description}
        confirmLabel={active?.confirmLabel}
        requireReason={pending === "transfer"}
        reasonLabel="Reason for transfer"
        busy={busy}
        errorMessage={error || undefined}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void run(reason)}
      />
    </div>
  );
}
