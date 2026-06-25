"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "../../../../_components/ds";

type CommentRow = {
  id: string;
  createdAt: string;
  author: string;
  isInternal: boolean;
  content: string;
  authorLabel: string;
} & Record<string, unknown>;

const TABS = ["Messages", "Notes"] as const;

export function TicketConversation({ comments }: { comments: CommentRow[] }) {
  const [tab, setTab] = useState<string>("Messages");

  const filtered =
    tab === "Notes"
      ? comments.filter((c) => c.isInternal)
      : comments.filter((c) => !c.isInternal);

  return (
    <>
      <div className="card-h" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div role="group" aria-label="Switch between messages and internal notes">
          <Segmented options={[...TABS]} value={tab} onChange={setTab} />
        </div>
      </div>
      {comments.length === 0 ? (
        <div style={{ padding: "16px", color: "var(--ink2)" }}>No messages yet.</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="💬" title={`No ${tab.toLowerCase()}`} message={`No ${tab.toLowerCase()} on this ticket yet.`} />
      ) : (
        <DataTable<CommentRow>
          columns={[
            { key: "createdAt", label: "Time" },
            { key: "authorLabel", label: "From" },
            { key: "content", label: "Message" },
          ]}
          rows={filtered}
          pageSize={15}
        />
      )}
    </>
  );
}
