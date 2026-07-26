"use client";

import { type DragEvent } from "react";
import { PALETTE_ITEMS, type BpmnElementType } from "../_data/designerTypes";

export function BpmnPalette() {
  const onDragStart = (event: DragEvent<HTMLButtonElement>, type: BpmnElementType) => {
    event.dataTransfer.setData("application/bpmn-type", type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside
      className="w-56 shrink-0 rounded-xl border border-slate-200 bg-white p-3 overflow-y-auto"
      aria-label="BPMN element palette"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
        Elements
      </h2>
      <ul className="list-none m-0 p-0 grid gap-1.5" role="list">
        {PALETTE_ITEMS.map((item) => (
          <li key={item.type}>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-grab active:cursor-grabbing transition-colors"
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              aria-label={`Drag ${item.label} onto canvas`}
              title={item.description}
            >
              <span
                className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-100 text-sm shrink-0"
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-700 truncate">
                  {item.label}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {item.description}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-3 border-t border-slate-100">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Instructions
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Drag elements from this palette onto the canvas. Connect nodes by
          dragging from a source handle to a target handle.
        </p>
      </div>
    </aside>
  );
}
