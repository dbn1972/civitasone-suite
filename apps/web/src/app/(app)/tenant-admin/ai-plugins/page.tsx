import { PageHeader, StatGrid, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { combineResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { humanizeStatus } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PluginConfigControls } from "./PluginConfigControls";

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
  autoAction: boolean;
  dataSource: string;
} & Record<string, unknown>;

type Summary = {
  totalPlugins: number;
  activePlugins: number;
  predictionsToday: number;
  predictions30d: number;
  avgConfidence7d: number | null;
} & Record<string, unknown>;

// GAP-TENANT-ADMIN-AI-PLUGINS-04: coerce numeric strings from the API
// (postgres ROUND(numeric) reaches JS as a string) so `0` is a real number,
// not a truthy "0.0" string, and `!= null` checks behave.
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getPlugins(): Promise<LoaderResult<Plugin[]>> {
  return fetchJson<unknown, Plugin[]>("/api/v1/hrms/ai/plugins", [], {
    telemetryKey: "admin.ai-plugins",
    mapResponse: (p) => (p as { data?: Plugin[] })?.data ?? null,
  });
}

async function getSummary(): Promise<LoaderResult<Summary>> {
  return fetchJson<unknown, Summary>(
    "/api/v1/hrms/ai/plugins/summary",
    { totalPlugins: 0, activePlugins: 0, predictionsToday: 0, predictions30d: 0, avgConfidence7d: null },
    {
      telemetryKey: "admin.ai-plugins.summary",
      mapResponse: (p) => (p as { data?: Summary })?.data ?? null,
    },
  );
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
  disabled: { label: "OFF", color: "bg-gray-100 text-gray-600" },
};

export default async function AiPluginsPage() {
  const [pluginsRes, summaryRes] = await Promise.all([getPlugins(), getSummary()]);
  const plugins = pluginsRes.data;
  const summary = summaryRes.data;

  // GAP-TENANT-ADMIN-AI-PLUGINS-02 (FAILMASK): both fetches used to drop
  // LoaderResult.source, so a failure rendered zeros + an empty grid,
  // identical to "no plugins" (the plugin list is a static server registry,
  // so an empty grid on a healthy tenant is impossible — empty always meant
  // failure). Combine the two results and show a retry state on error.
  const state = combineResourceState([pluginsRes, summaryRes], plugins, (d) => d.length === 0);
  const errored = state.status === "error";

  const roles = getSessionRoles();
  // GAP-TENANT-ADMIN-AI-PLUGINS-03: the config controls perform a tenant-admin
  // mutation (server-enforced), so only show them to those roles (UI hiding
  // backs up the server gate; it is not the gate itself).
  const canConfigure = roles.some((r) => ["tenant_admin", "platform_admin", "super_admin"].includes(r));

  const categories = [...new Set(plugins.map((p) => p.category))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI/ML Plugins"
        subtitle={canConfigure ? "Enable, configure, and monitor machine learning models" : "Monitor machine learning models"}
      />

      <DataSourceBadge source={errored ? "error" : "api"} />

      <StatGrid>
        <StatCard icon="🤖" iconBg="#e6f0ff" label="Total Models" value={errored ? "—" : summary.totalPlugins} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={errored ? "—" : summary.activePlugins} />
        {/* GAP-TENANT-ADMIN-AI-PLUGINS-06: this is a rolling 24h window, not a
            calendar day — label it accurately. */}
        <StatCard icon="📈" iconBg="#fffbe6" label="Predictions (24h)" value={errored ? "—" : summary.predictionsToday} />
        <StatCard icon="📊" iconBg="#f5f5f5" label="Last 30 Days" value={errored ? "—" : summary.predictions30d} />
        {/* GAP-TENANT-ADMIN-AI-PLUGINS-04: `!= null` so a real 0 renders "0%". */}
        <StatCard icon="🎯" iconBg="#fef2f2" label="Avg Confidence" value={errored || num(summary.avgConfidence7d) == null ? "—" : `${num(summary.avgConfidence7d)}%`} />
      </StatGrid>

      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "AI plugins" })} backHref="/tenant-admin" />
      ) : plugins.length === 0 ? (
        <EmptyState icon="🤖" title="No AI plugins available" message="AI/ML plugins will appear here once the registry is populated." />
      ) : (
        categories.map((cat) => (
          <div key={cat} className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span aria-hidden="true">{CATEGORY_ICONS[cat] ?? "🔮"}</span>
              {/* GAP-TENANT-ADMIN-AI-PLUGINS-04: humanize the whole category,
                  not just the first underscore. */}
              {humanizeStatus(cat)}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {plugins.filter((p) => p.category === cat).map((plugin) => {
                const mode = MODE_BADGE[plugin.mode] ?? MODE_BADGE.disabled;
                const avgConfidence = num(plugin.avgConfidence);
                const accuracy = num(plugin.accuracy);
                const avgLatencyMs = num(plugin.avgLatencyMs);
                return (
                  <div key={plugin.id} className="border rounded-xl p-5 space-y-3 hover:shadow-md transition-shadow">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-sm">{plugin.name}</h3>
                        <p className="text-xs text-gray-600 mt-0.5">{plugin.model}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${mode.color}`}>
                        {mode.label}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-gray-600 leading-relaxed">{plugin.description}</p>

                    {/* Stats row — GAP-TENANT-ADMIN-AI-PLUGINS-05: emoji marked
                        aria-hidden and the metric labelled for screen readers. */}
                    <div className="flex items-center gap-4 text-xs text-gray-600">
                      <span><span aria-hidden="true">📈</span> <span className="sr-only">Predictions last 30 days: </span>{plugin.predictionCount30d}</span>
                      {avgConfidence !== null && (
                        <span><span aria-hidden="true">🎯</span> <span className="sr-only">Average confidence: </span>{avgConfidence}%</span>
                      )}
                      {accuracy !== null && (
                        <span><span aria-hidden="true">✅</span> <span className="sr-only">Accuracy: </span>{accuracy}%</span>
                      )}
                      {avgLatencyMs !== null && (
                        <span><span aria-hidden="true">⚡</span> <span className="sr-only">Average latency: </span>{avgLatencyMs}ms</span>
                      )}
                    </div>

                    {/* Confidence threshold bar — GAP-TENANT-ADMIN-AI-PLUGINS-05:
                        role=meter + aria so it is readable, text bumped to text-xs. */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Confidence threshold</span>
                        <span>{plugin.confidenceThreshold}%</span>
                      </div>
                      <div
                        className="h-1.5 bg-gray-100 rounded-full overflow-hidden"
                        role="meter"
                        aria-label={`Confidence threshold for ${plugin.name}`}
                        aria-valuenow={plugin.confidenceThreshold}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${plugin.confidenceThreshold}%` }}
                        />
                      </div>
                    </div>

                    {/* Data source */}
                    <div className="text-xs text-gray-600 flex items-center gap-1">
                      <span aria-hidden="true">📦</span>
                      <span>{plugin.dataSource}</span>
                    </div>

                    {/* Training requirement */}
                    {plugin.requiresTraining && !plugin.enabled && (
                      <div className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded">
                        <span aria-hidden="true">⚠️</span> Requires training data before enabling
                      </div>
                    )}

                    {/* GAP-TENANT-ADMIN-AI-PLUGINS-01: real config controls,
                        shown only to tenant-admin roles (server-enforced too). */}
                    {canConfigure && (
                      <PluginConfigControls
                        pluginId={plugin.id}
                        pluginName={plugin.name}
                        enabled={plugin.enabled}
                        mode={plugin.mode}
                        confidenceThreshold={plugin.confidenceThreshold}
                        autoAction={plugin.autoAction}
                        requiresTraining={plugin.requiresTraining}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
