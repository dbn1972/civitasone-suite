"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OrgChartNode } from "@civitasone/types";

function OrgNode({ node, depth }: { node: OrgChartNode; depth: number }) {
  return (
    <div className={`flex flex-col items-center ${depth > 0 ? "mt-6" : ""}`}>
      <div className="relative rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm text-center min-w-[160px] max-w-[200px]">
        {depth > 0 && (
          <div className="absolute -top-6 left-1/2 w-px h-6 bg-slate-300 -translate-x-1/2" />
        )}
        <p className="font-medium text-slate-900 text-sm">{node.name}</p>
        <p className="text-xs text-indigo-600 mt-0.5">{node.designation}</p>
        <p className="text-xs text-slate-500 mt-0.5">{node.department}</p>
      </div>

      {node.children && node.children.length > 0 && (
        <div className="relative mt-6 flex gap-6">
          {node.children.length > 1 && (
            <div
              className="absolute top-0 left-0 right-0 h-px bg-slate-300"
              style={{
                left: "calc(50% / " + node.children.length + ")",
                right: "calc(50% / " + node.children.length + ")",
                top: "0px",
              }}
            />
          )}
          {node.children.map((child) => (
            <OrgNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrgChartPage() {
  const [nodes, setNodes] = useState<OrgChartNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/v1/hrms/org-chart", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        const list = Array.isArray(data)
          ? data
          : Array.isArray((data as { data?: unknown }).data)
            ? (data as { data: OrgChartNode[] }).data
            : [];
        setNodes(list as OrgChartNode[]);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-full space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Org Chart</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Organisation Chart</h1>
          <p className="mt-1 text-sm text-slate-600">Reporting hierarchy across departments.</p>
        </header>

        {loading && (
          <div className="animate-pulse space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex justify-center gap-12">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-6">
                  <div className="h-16 w-40 rounded-xl bg-slate-200" />
                  <div className="flex gap-6">
                    {Array.from({ length: 2 }).map((_, j) => (
                      <div key={j} className="h-16 w-36 rounded-xl bg-slate-200" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 py-10 text-center text-red-600">
            Failed to load org chart data.
          </div>
        )}

        {!loading && !error && nodes.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">
            No organisation chart data available.
          </div>
        )}

        {!loading && !error && nodes.length > 0 && (
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex gap-12 justify-center">
              {nodes.map((root) => (
                <OrgNode key={root.id} node={root} depth={0} />
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
