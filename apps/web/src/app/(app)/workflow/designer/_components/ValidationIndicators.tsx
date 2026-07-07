"use client";

import type { Node } from "reactflow";
import type { DesignerViolation } from "../_data/designerTypes";

interface Props {
  violations: DesignerViolation[];
  nodes: Node[];
}

export function ValidationIndicators({ violations, nodes }: Props) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  if (violations.length === 0) {
    return (
      <div
        className="rounded-xl border border-slate-200 bg-white p-4"
        aria-label="Validation results"
        role="status"
        aria-live="polite"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Validation
        </h2>
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-green-100 text-green-600 text-xs" aria-hidden="true">
            ✓
          </span>
          <span className="text-sm text-green-700">
            No issues found
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Click &quot;Validate&quot; to check the graph for errors.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-red-200 bg-white p-4 max-h-60 overflow-y-auto"
      aria-label="Validation errors"
      role="alert"
      aria-live="assertive"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-2">
        Validation ({violations.length} {violations.length === 1 ? "issue" : "issues"})
      </h2>
      <ul className="list-none m-0 p-0 grid gap-2" role="list">
        {violations.map((v, idx) => {
          const node = nodeMap.get(v.elementId);
          const elementLabel = node?.data?.label ?? v.elementId;
          return (
            <li
              key={`${v.elementId}-${v.type}-${idx}`}
              className="flex items-start gap-2 text-xs"
            >
              <span
                className="w-4 h-4 flex items-center justify-center rounded-full bg-red-100 text-red-600 text-[10px] shrink-0 mt-0.5"
                aria-hidden="true"
              >
                !
              </span>
              <div className="min-w-0">
                <div className="font-medium text-slate-700 truncate">
                  {v.elementId === "__canvas" ? "Canvas" : elementLabel}
                </div>
                <div className="text-slate-500">{v.message}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
