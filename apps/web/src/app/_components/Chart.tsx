"use client";

import React from "react";

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

interface ChartProps {
  type: "bar" | "line" | "pie" | "donut";
  data: ChartDataPoint[];
  title?: string;
  height?: number;
}

const DEFAULT_COLORS = [
  "#4f46e5", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
];

function getColor(index: number, override?: string) {
  return override ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function BarChart({ data, height }: { data: ChartDataPoint[]; height: number }) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.max(20, Math.min(60, (600 - data.length * 8) / data.length));
  const chartWidth = data.length * (barWidth + 8) + 40;
  const chartHeight = height - 40;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${chartWidth} ${height}`} preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const barHeight = (d.value / maxVal) * (chartHeight - 20);
        const x = 20 + i * (barWidth + 8);
        const y = chartHeight - barHeight;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={getColor(i, d.color)}
              rx={4}
            />
            <title>{`${d.label}: ${d.value}`}</title>
            <text
              x={x + barWidth / 2}
              y={chartHeight + 14}
              textAnchor="middle"
              fontSize={10}
              fill="#64748b"
            >
              {d.label.length > 8 ? d.label.slice(0, 7) + "…" : d.label}
            </text>
            <text
              x={x + barWidth / 2}
              y={y - 4}
              textAnchor="middle"
              fontSize={9}
              fill="#334155"
              fontWeight={600}
            >
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ data, height }: { data: ChartDataPoint[]; height: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = height / 2;
  const cy = height / 2;
  const outerR = height / 2 - 10;
  const innerR = outerR * 0.6;
  let startAngle = -90;

  const slices = data.map((d, i) => {
    const angle = (d.value / total) * 360;
    const endAngle = startAngle + angle;
    const largeArc = angle > 180 ? 1 : 0;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + outerR * Math.cos(startRad);
    const y1 = cy + outerR * Math.sin(startRad);
    const x2 = cx + outerR * Math.cos(endRad);
    const y2 = cy + outerR * Math.sin(endRad);
    const x3 = cx + innerR * Math.cos(endRad);
    const y3 = cy + innerR * Math.sin(endRad);
    const x4 = cx + innerR * Math.cos(startRad);
    const y4 = cy + innerR * Math.sin(startRad);

    const path = [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
      "Z",
    ].join(" ");

    startAngle = endAngle;
    return (
      <path key={i} d={path} fill={getColor(i, d.color)}>
        <title>{`${d.label}: ${d.value} (${((d.value / total) * 100).toFixed(1)}%)`}</title>
      </path>
    );
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={height} height={height} viewBox={`0 0 ${height} ${height}`}>
        {slices}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={16} fontWeight={700} fill="#1e293b">
          {total}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={10} fill="#64748b">
          Total
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: getColor(i, d.color),
                display: "inline-block",
              }}
            />
            <span style={{ color: "#334155" }}>{d.label}</span>
            <span style={{ color: "#94a3b8", marginLeft: 4 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data, height }: { data: ChartDataPoint[]; height: number }) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const chartWidth = Math.max(400, data.length * 60);
  const chartHeight = height - 40;
  const points = data.map((d, i) => ({
    x: 30 + (i / Math.max(data.length - 1, 1)) * (chartWidth - 60),
    y: 10 + (1 - d.value / maxVal) * (chartHeight - 20),
  }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${chartWidth} ${height}`} preserveAspectRatio="xMidYMid meet">
      <path d={pathD} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill="#4f46e5" />
          <title>{`${data[i].label}: ${data[i].value}`}</title>
          <text x={p.x} y={chartHeight + 14} textAnchor="middle" fontSize={10} fill="#64748b">
            {data[i].label.length > 6 ? data[i].label.slice(0, 5) + "…" : data[i].label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PieChart({ data, height }: { data: ChartDataPoint[]; height: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = height / 2;
  const cy = height / 2;
  const r = height / 2 - 10;
  let startAngle = -90;

  const slices = data.map((d, i) => {
    const angle = (d.value / total) * 360;
    const endAngle = startAngle + angle;
    const largeArc = angle > 180 ? 1 : 0;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    startAngle = endAngle;
    return (
      <path key={i} d={path} fill={getColor(i, d.color)}>
        <title>{`${d.label}: ${d.value} (${((d.value / total) * 100).toFixed(1)}%)`}</title>
      </path>
    );
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={height} height={height} viewBox={`0 0 ${height} ${height}`}>
        {slices}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 2, background: getColor(i, d.color), display: "inline-block" }}
            />
            <span style={{ color: "#334155" }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Chart({ type, data, title, height = 200 }: ChartProps) {
  return (
    <div style={{ width: "100%" }}>
      {title && (
        <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 600, color: "#1e293b" }}>
          {title}
        </h4>
      )}
      {type === "bar" && <BarChart data={data} height={height} />}
      {type === "line" && <LineChart data={data} height={height} />}
      {type === "donut" && <DonutChart data={data} height={height} />}
      {type === "pie" && <PieChart data={data} height={height} />}
    </div>
  );
}
