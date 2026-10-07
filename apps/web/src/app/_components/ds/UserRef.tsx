/**
 * UserRef — render a reference to a user/actor by id (GAP-CHANGE-DETAIL-03).
 *
 * The change-detail page previously printed `id.slice(0, 8)` for the requester,
 * approver and every audit actor, so a CAB reviewer or auditor could not tell
 * who raised or approved a change — and maker-checker evidence (approver ≠
 * requester) was unreadable.
 *
 * The admin-service change payload carries only ids today (no display-name
 * lookup exists), so this component does NOT invent a name: it shows `name`
 * when the caller has one, otherwise a short id. In both cases the full id is
 * available in the title tooltip for copy/paste, so the on-screen value is
 * readable without losing the exact identifier.
 */

export interface UserRefProps {
  /** The user/actor id. Empty/absent renders a muted em dash. */
  id: string | null | undefined;
  /** Human display name, when the caller has resolved one. */
  name?: string | null;
  /** Characters of the id to show when there is no name. */
  shortLength?: number;
}

export function UserRef({ id, name, shortLength = 8 }: UserRefProps) {
  const trimmedId = (id ?? "").trim();
  if (!trimmedId && !name) return <span style={{ color: "var(--muted, #667085)" }}>—</span>;

  if (name && name.trim()) {
    return (
      <span title={trimmedId || undefined}>
        {name.trim()}
        {trimmedId ? (
          <span style={{ color: "var(--muted, #667085)", fontSize: "0.85em", marginInlineStart: 6 }}>
            {trimmedId.slice(0, shortLength)}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span title={trimmedId} style={{ fontFamily: "var(--mono, ui-monospace, monospace)" }}>
      {trimmedId.slice(0, shortLength)}
    </span>
  );
}
