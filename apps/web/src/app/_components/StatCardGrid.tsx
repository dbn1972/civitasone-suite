import type { MetricCard } from "@civitasone/types";

interface StatCardGridProps {
  items: MetricCard[];
}

export function StatCardGrid({ items }: StatCardGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <article key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">{item.label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{item.value}</p>
          {item.note ? <p className="mt-1 text-sm text-slate-600">{item.note}</p> : null}
        </article>
      ))}
    </div>
  );
}
