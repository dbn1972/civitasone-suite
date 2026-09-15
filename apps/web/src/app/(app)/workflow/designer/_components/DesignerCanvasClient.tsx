"use client";

import dynamic from "next/dynamic";

// PERF-009: DesignerCanvas pulls in reactflow (a large graph-editor library)
// plus 5 node components -- the single largest route bundle in the app
// (198 kB First Load JS, measured). next/dynamic's ssr:false is only allowed
// from a Client Component (page.tsx is a Server Component), so this tiny
// wrapper exists purely to host that boundary -- same pattern already proven
// safe for this exact component by the sibling ApprovalChainBuilder usage
// (apps/web/src/app/(app)/designer/_components/ApprovalChainBuilder.tsx).
export const DesignerCanvas = dynamic(
  () => import("./DesignerCanvas").then((m) => m.DesignerCanvas),
  { ssr: false, loading: () => <p style={{ color: "var(--mut)" }}>Loading visual editor…</p> },
);
