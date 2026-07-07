"use client";

import { useCallback, type ChangeEvent } from "react";
import type { Node } from "reactflow";

interface Props {
  selectedNode: Node | null;
  onLabelChange: (nodeId: string, label: string) => void;
  onPropertyChange: (nodeId: string, key: string, value: string) => void;
}

export function PropertyPanel({ selectedNode, onLabelChange, onPropertyChange }: Props) {
  const handleLabelChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (!selectedNode) return;
      onLabelChange(selectedNode.id, e.target.value);
    },
    [selectedNode, onLabelChange],
  );

  const handlePropertyChange = useCallback(
    (key: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!selectedNode) return;
      onPropertyChange(selectedNode.id, key, e.target.value);
    },
    [selectedNode, onPropertyChange],
  );

  if (!selectedNode) {
    return (
      <div
        className="rounded-xl border border-slate-200 bg-white p-4 flex-1"
        aria-label="Property panel"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Properties
        </h2>
        <p className="text-sm text-slate-400">
          Select an element on the canvas to view and edit its properties.
        </p>
      </div>
    );
  }

  const nodeType = selectedNode.type ?? "unknown";
  const data = selectedNode.data as Record<string, string | undefined>;

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-4 flex-1 overflow-y-auto"
      aria-label={`Properties for ${data.label || selectedNode.id}`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
        Properties
      </h2>

      <div className="grid gap-3">
        {/* ID (read-only) */}
        <div>
          <label htmlFor="prop-id" className="block text-xs font-medium text-slate-500 mb-1">
            ID
          </label>
          <input
            id="prop-id"
            type="text"
            value={selectedNode.id}
            readOnly
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500 font-mono"
            aria-readonly="true"
          />
        </div>

        {/* Type (read-only) */}
        <div>
          <label htmlFor="prop-type" className="block text-xs font-medium text-slate-500 mb-1">
            Type
          </label>
          <input
            id="prop-type"
            type="text"
            value={formatNodeType(nodeType)}
            readOnly
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500"
            aria-readonly="true"
          />
        </div>

        {/* Label (editable) */}
        <div>
          <label htmlFor="prop-label" className="block text-xs font-medium text-slate-700 mb-1">
            Label
          </label>
          <input
            id="prop-label"
            type="text"
            value={data.label ?? ""}
            onChange={handleLabelChange}
            maxLength={200}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Description (task, subprocess) */}
        {(nodeType === "task" || nodeType === "subProcess") && (
          <div>
            <label htmlFor="prop-description" className="block text-xs font-medium text-slate-700 mb-1">
              Description
            </label>
            <textarea
              id="prop-description"
              value={data.description ?? ""}
              onChange={handlePropertyChange("description")}
              maxLength={2000}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        {/* Assignee (task only) */}
        {nodeType === "task" && (
          <div>
            <label htmlFor="prop-assignee" className="block text-xs font-medium text-slate-700 mb-1">
              Assignee Role
            </label>
            <input
              id="prop-assignee"
              type="text"
              value={data.assignee ?? ""}
              onChange={handlePropertyChange("assignee")}
              maxLength={100}
              placeholder="e.g. finance_officer"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        {/* Condition (gateway only) */}
        {(nodeType === "exclusiveGateway" || nodeType === "parallelGateway") && (
          <div>
            <label htmlFor="prop-condition" className="block text-xs font-medium text-slate-700 mb-1">
              Condition Expression
            </label>
            <input
              id="prop-condition"
              type="text"
              value={data.condition ?? ""}
              onChange={handlePropertyChange("condition")}
              maxLength={512}
              placeholder="e.g. amount > 100000"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        {/* Position (read-only) */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Position
          </label>
          <div className="flex gap-2">
            <span className="rounded-md bg-slate-50 border border-slate-200 px-2 py-1 text-xs text-slate-500 font-mono">
              x: {Math.round(selectedNode.position.x)}
            </span>
            <span className="rounded-md bg-slate-50 border border-slate-200 px-2 py-1 text-xs text-slate-500 font-mono">
              y: {Math.round(selectedNode.position.y)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatNodeType(type: string): string {
  return type
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
