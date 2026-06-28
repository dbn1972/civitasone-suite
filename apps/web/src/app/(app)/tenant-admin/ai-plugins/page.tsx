import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Plugin = {
  id: string;
  name: string;
  description: string;
  category: string;
  model: string;
  enabled: boolean;
  mode: string;
  confidenceThreshold: number;
  predictionCount30d: number;
  avgConfidence: number | null;
  avgLatencyMs: number | null;
  accuracy: number | null;
  lastPredictionAt: string | null;
  requiresTraining: boolean;
  dataSource: string;
} & Record<string, unknown>;

type Summary = {
  totalPlugins: number;
  activePlugins: number;
  predictionsToday: number;
  predictions30d: number;
  avgConfidence7d: number | null;
} & Record<string, unknown>;

async function getPlugins(): Promise<Plugin[]> {
  const r = await fetchJson<unknown, Plugin[]>("/api/v1/hrms/ai/plugins", [], {
    telemetryKey: "admin.ai-plugins",
    mapResponse: (p) => (p as { data?: Plugin[] })?.data ?? null,
  });
  return r.data;
}

async function getSummary(): Promise<Summary> {
  const r = await fetchJson<unknown, Summary>("/api/v1/hrms/ai/plugins/summary", { totalPlugins: 0, activePlugins: 0, predictionsToday: 0, predictions30d: 0, avgConfidence7d: null }, {
    telemetryKey: "admin.ai-plugins.summary",
    mapResponse: (p) => (p as { data?: Summary })?.data ?? null,
  });
  return r.data;
}

const CATEGORY_ICONS: Record<string, string> = {
  computer_vision: "👁️",
  nlp: "💬",
  prediction: "📈",
  recommendation: "🎯",
  forecasting: "📊",
  anomaly: "🚨",
  recruitment: "📋",
  classification: "🏷️",
  scoring: "⭐",
};

const MODE_BADGE: Record<string, { label: string; color: string }> = {
  active: { label: "ACTIVE", color: "bg-green-100 text-green-700" },
  shadow: { label: "SHADOW", color: "bg-amber-100 text-amber-700" },
  disabled: { label: "OFF", color: "bg-gray-100 text-gray-500" },
};

export default async function AiPluginsPage() {
  const [plugins, summary] = await Promise.all([getPlugins(), getSummary()]);

  const active = plugins.filter((p) => p.enabled);
  const categories = [...new Set(plugins.map((p) => p.category))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI/ML Plugins"
        subtitle="Enable, configure, and monitor machine learning models"
      />

      <StatGrid>
        <StatCard icon="🤖" iconBg="#e6f0ff" label="Total Models" value={summary.totalPlugins} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={summary.activePlugins} />
        <StatCard icon="📈" iconBg="#fffbe6" label="Predictions Today" value={summary.predictionsToday} />
        <StatCard icon="📊" iconBg="#f5f5f5" label="Last 30 Days" value={summary.predictions30d} />
        <StatCard icon="🎯" iconBg="#fef2f2" label="Avg Confidence" value={summary.avgConfidence7d ? `${summary.avgConfidence7d}%` : "—"} />
      </StatGrid>

      {/* Plugin grid by category */}
      {categories.map((cat) => (
        <div key={cat} className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>{CATEGORY_ICONS[cat] ?? "🔮"}</span>
            {cat.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plugins.filter((p) => p.category === cat).map((plugin) => {
              const mode = MODE_BADGE[plugin.mode] ?? MODE_BADGE.disabled;
              return (
                <div key={plugin.id} className="border rounded-xl p-5 space-y-3 hover:shadow-md transition-shadow">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-sm">{plugin.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{plugin.model}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${mode.color}`}>
                      {mode.label}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-600 leading-relaxed">{plugin.description}</p>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span title="Predictions last 30 days">📈 {plugin.predictionCount30d}</span>
                    {plugin.avgConfidence !== null && (
                      <span title="Avg confidence">🎯 {plugin.avgConfidence}%</span>
                    )}
                    {plugin.accuracy !== null && (
                      <span title="Accuracy">✅ {plugin.accuracy}%</span>
                    )}
                    {plugin.avgLatencyMs !== null && (
                      <span title="Avg latency">⚡ {plugin.avgLatencyMs}ms</span>
                    )}
                  </div>

                  {/* Confidence threshold bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>Confidence threshold</span>
                      <span>{plugin.confidenceThreshold}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${plugin.confidenceThreshold}%` }}
                      />
                    </div>
                  </div>

                  {/* Data source */}
                  <div className="text-[10px] text-gray-400 flex items-center gap-1">
                    <span>📦</span>
                    <span>{plugin.dataSource}</span>
                  </div>

                  {/* Training requirement */}
                  {plugin.requiresTraining && !plugin.enabled && (
                    <div className="text-[10px] bg-amber-50 text-amber-700 px-2 py-1 rounded">
                      ⚠️ Requires training data before enabling
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
