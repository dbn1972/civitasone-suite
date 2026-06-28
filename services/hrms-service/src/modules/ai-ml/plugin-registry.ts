/**
 * AI/ML Plugin Registry — Enable/disable ML models, monitor predictions, observe accuracy.
 *
 * Admin UI at /tenant-admin/ai-plugins shows:
 * - All ML models available
 * - Toggle ON/OFF per model per tenant
 * - Prediction count, accuracy, latency stats
 * - Confidence threshold slider
 * - Last training date, data freshness
 * - Drift detection alerts
 *
 * Design: Each ML model registers as a "plugin" that can be:
 * - Enabled/disabled without code deploy
 * - Configured (threshold, frequency, mode: shadow/active)
 * - Monitored (predictions/day, accuracy, false positive rate)
 * - Rolled back (revert to previous model version)
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { sqlPool as sqlClient } from "../../shared/db.js";

// ─── All available ML plugins ─────────────────────────────────────────────────

const ML_PLUGINS = [
  {
    id: "face-verification",
    name: "Face Verification",
    description: "Verifies employee identity via selfie against enrolled face embedding",
    category: "computer_vision",
    model: "FaceNet (ONNX)",
    defaultThreshold: 70,
    requiresTraining: false,
    dataSource: "employee photos + selfies",
  },
  {
    id: "document-ocr",
    name: "Document OCR",
    description: "Extracts text and structured data from receipts, bills, certificates",
    category: "computer_vision",
    model: "Tesseract.js",
    defaultThreshold: 60,
    requiresTraining: false,
    dataSource: "uploaded documents",
  },
  {
    id: "nlu-chatbot",
    name: "AI HR Assistant (NLU)",
    description: "Understands natural language HR queries and responds with live data",
    category: "nlp",
    model: "Keyword NLU → DistilBERT",
    defaultThreshold: 50,
    requiresTraining: true,
    dataSource: "chat logs (500+ labeled examples needed)",
  },
  {
    id: "attrition-prediction",
    name: "Employee Attrition Risk",
    description: "Predicts which employees are at risk of leaving in next 6 months",
    category: "prediction",
    model: "XGBoost",
    defaultThreshold: 50,
    requiresTraining: true,
    dataSource: "employees + leave + APAR + promotions (6mo+ data)",
  },
  {
    id: "succession-planning",
    name: "Succession Recommendation",
    description: "Recommends suitable successors for key positions based on competency",
    category: "recommendation",
    model: "Ranking (weighted scoring)",
    defaultThreshold: 60,
    requiresTraining: true,
    dataSource: "employees + APAR + grade + department",
  },
  {
    id: "leave-prediction",
    name: "Leave Demand Forecast",
    description: "Predicts leave utilization for next month based on historical patterns",
    category: "forecasting",
    model: "Prophet / ARIMA",
    defaultThreshold: 0,
    requiresTraining: true,
    dataSource: "2+ years leave history",
  },
  {
    id: "payroll-anomaly",
    name: "Payroll Anomaly Detection",
    description: "Detects unusual salary components or payment amounts before disbursement",
    category: "anomaly",
    model: "Isolation Forest",
    defaultThreshold: 80,
    requiresTraining: true,
    dataSource: "3+ months payroll runs",
  },
  {
    id: "payment-fraud",
    name: "Payment Fraud Detection",
    description: "Flags suspicious payment patterns, duplicate bills, vendor collusion",
    category: "anomaly",
    model: "Isolation Forest",
    defaultThreshold: 85,
    requiresTraining: true,
    dataSource: "3+ months payment + vendor data",
  },
  {
    id: "attendance-anomaly",
    name: "Attendance Fraud Detection",
    description: "Detects proxy attendance, impossible geo patterns, timing anomalies",
    category: "anomaly",
    model: "Isolation Forest",
    defaultThreshold: 75,
    requiresTraining: true,
    dataSource: "3+ months geo check-in logs",
  },
  {
    id: "resume-screening",
    name: "AI Resume Screening",
    description: "Scores candidate resumes against job requirements for auto-shortlisting",
    category: "recruitment",
    model: "Sentence-Transformers",
    defaultThreshold: 60,
    requiresTraining: false,
    dataSource: "JD requirements + uploaded resumes",
  },
  {
    id: "budget-forecast",
    name: "Budget Utilization Forecast",
    description: "Predicts budget consumption trajectory to prevent year-end rush",
    category: "forecasting",
    model: "Prophet",
    defaultThreshold: 0,
    requiresTraining: true,
    dataSource: "1+ year budget + GL entries",
  },
  {
    id: "ticket-classification",
    name: "Helpdesk Auto-Classification",
    description: "Automatically categorizes support tickets for routing",
    category: "classification",
    model: "Naive Bayes / SVM",
    defaultThreshold: 70,
    requiresTraining: true,
    dataSource: "500+ labeled tickets",
  },
  {
    id: "vendor-risk",
    name: "Vendor Risk Score",
    description: "Assesses vendor reliability based on past performance, delays, quality",
    category: "scoring",
    model: "XGBoost",
    defaultThreshold: 50,
    requiresTraining: true,
    dataSource: "6+ months PO + GRN + payment data",
  },
  {
    id: "sla-breach-prediction",
    name: "SLA Breach Prediction",
    description: "Predicts which tickets will breach SLA before it happens",
    category: "prediction",
    model: "Logistic Regression",
    defaultThreshold: 60,
    requiresTraining: true,
    dataSource: "3+ months ticket history",
  },
];

const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["active", "shadow", "disabled"]).optional(),
  confidenceThreshold: z.number().min(0).max(100).optional(),
  notifyOnPrediction: z.boolean().optional(),
  autoAction: z.boolean().optional(), // auto-act on prediction (e.g., auto-shortlist)
  maxPredictionsPerDay: z.number().int().min(0).max(100000).optional(),
});

export async function aiPluginRegistryRoutes(app: FastifyInstance): Promise<void> {

  /** GET /v1/hrms/ai/plugins — list all AI plugins with status for this tenant */
  app.get("/v1/hrms/ai/plugins", async (req, reply) => {
    const ctx = resolveContext(req);

    // Get tenant-specific configs
    const configs = await sqlClient.query(
      `SELECT plugin_id, enabled, mode, confidence_threshold, notify_on_prediction,
              auto_action, max_predictions_per_day, updated_at
       FROM hrms.ai_plugin_configs WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const configMap = new Map(configs.rows.map((r: any) => [r.plugin_id, r]));

    // Get prediction stats (last 30 days)
    const stats = await sqlClient.query(
      `SELECT plugin_id,
              COUNT(*)::int AS prediction_count,
              ROUND(AVG(confidence)::numeric, 1) AS avg_confidence,
              ROUND(AVG(latency_ms)::numeric, 0) AS avg_latency_ms,
              COUNT(CASE WHEN outcome = 'correct' THEN 1 END)::int AS correct,
              COUNT(CASE WHEN outcome = 'incorrect' THEN 1 END)::int AS incorrect,
              MAX(created_at) AS last_prediction_at
       FROM hrms.ai_prediction_log
       WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY plugin_id`,
      [ctx.tenantId],
    );
    const statsMap = new Map(stats.rows.map((r: any) => [r.plugin_id, r]));

    const plugins = ML_PLUGINS.map((p) => {
      const config = configMap.get(p.id) as any;
      const stat = statsMap.get(p.id) as any;
      const accuracy = stat && (stat.correct + stat.incorrect) > 0
        ? Math.round((stat.correct / (stat.correct + stat.incorrect)) * 100)
        : null;

      return {
        ...p,
        // Tenant config
        enabled: config?.enabled ?? false,
        mode: config?.mode ?? "disabled",
        confidenceThreshold: config?.confidence_threshold ?? p.defaultThreshold,
        notifyOnPrediction: config?.notify_on_prediction ?? false,
        autoAction: config?.auto_action ?? false,
        maxPredictionsPerDay: config?.max_predictions_per_day ?? 1000,
        lastConfigUpdate: config?.updated_at ?? null,
        // Stats
        predictionCount30d: stat?.prediction_count ?? 0,
        avgConfidence: stat?.avg_confidence ?? null,
        avgLatencyMs: stat?.avg_latency_ms ?? null,
        accuracy,
        lastPredictionAt: stat?.last_prediction_at ?? null,
      };
    });

    return reply.send({ data: plugins });
  });

  /** PATCH /v1/hrms/ai/plugins/:pluginId — update plugin config (enable/disable/threshold) */
  app.patch("/v1/hrms/ai/plugins/:pluginId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { pluginId } = req.params as { pluginId: string };
    const body = configUpdateSchema.parse(req.body);

    // Validate plugin exists
    const plugin = ML_PLUGINS.find((p) => p.id === pluginId);
    if (!plugin) throw new HttpError(404, "NOT_FOUND", `Unknown AI plugin: ${pluginId}`);

    await sqlClient.query(
      `INSERT INTO hrms.ai_plugin_configs (id, tenant_id, plugin_id, enabled, mode,
        confidence_threshold, notify_on_prediction, auto_action, max_predictions_per_day, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET
        enabled = COALESCE($4, hrms.ai_plugin_configs.enabled),
        mode = COALESCE($5, hrms.ai_plugin_configs.mode),
        confidence_threshold = COALESCE($6, hrms.ai_plugin_configs.confidence_threshold),
        notify_on_prediction = COALESCE($7, hrms.ai_plugin_configs.notify_on_prediction),
        auto_action = COALESCE($8, hrms.ai_plugin_configs.auto_action),
        max_predictions_per_day = COALESCE($9, hrms.ai_plugin_configs.max_predictions_per_day),
        updated_at = NOW()`,
      [
        randomUUID(), ctx.tenantId, pluginId,
        body.enabled ?? null, body.mode ?? null,
        body.confidenceThreshold ?? null, body.notifyOnPrediction ?? null,
        body.autoAction ?? null, body.maxPredictionsPerDay ?? null,
      ],
    );

    return reply.send({ pluginId, status: "updated", config: body });
  });

  /** GET /v1/hrms/ai/plugins/:pluginId/stats — detailed stats for a plugin */
  app.get("/v1/hrms/ai/plugins/:pluginId/stats", async (req, reply) => {
    const ctx = resolveContext(req);
    const { pluginId } = req.params as { pluginId: string };

    // Daily prediction counts (last 30 days)
    const daily = await sqlClient.query(
      `SELECT DATE(created_at) AS date, COUNT(*)::int AS predictions,
              ROUND(AVG(confidence)::numeric, 1) AS avg_confidence
       FROM hrms.ai_prediction_log
       WHERE tenant_id = $1 AND plugin_id = $2 AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at) ORDER BY date`,
      [ctx.tenantId, pluginId],
    );

    // Confidence distribution
    const distribution = await sqlClient.query(
      `SELECT
        CASE
          WHEN confidence >= 90 THEN '90-100'
          WHEN confidence >= 70 THEN '70-89'
          WHEN confidence >= 50 THEN '50-69'
          ELSE '0-49'
        END AS bucket,
        COUNT(*)::int AS count
       FROM hrms.ai_prediction_log
       WHERE tenant_id = $1 AND plugin_id = $2 AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY bucket ORDER BY bucket DESC`,
      [ctx.tenantId, pluginId],
    );

    // Recent predictions (last 20)
    const recent = await sqlClient.query(
      `SELECT id, confidence, outcome, input_summary, output_summary, latency_ms, created_at
       FROM hrms.ai_prediction_log
       WHERE tenant_id = $1 AND plugin_id = $2
       ORDER BY created_at DESC LIMIT 20`,
      [ctx.tenantId, pluginId],
    );

    return reply.send({
      data: {
        pluginId,
        daily: daily.rows,
        confidenceDistribution: distribution.rows,
        recentPredictions: recent.rows,
      },
    });
  });

  /** POST /v1/hrms/ai/plugins/:pluginId/feedback — human feedback on a prediction */
  app.post("/v1/hrms/ai/plugins/:pluginId/feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    const { pluginId } = req.params as { pluginId: string };
    const body = z.object({
      predictionId: z.string().uuid(),
      outcome: z.enum(["correct", "incorrect", "unsure"]),
      notes: z.string().max(500).optional(),
    }).parse(req.body);

    await sqlClient.query(
      `UPDATE hrms.ai_prediction_log SET outcome = $1, feedback_notes = $2, feedback_by = $3, feedback_at = NOW()
       WHERE id = $4 AND tenant_id = $5 AND plugin_id = $6`,
      [body.outcome, body.notes ?? null, ctx.actorId, body.predictionId, ctx.tenantId, pluginId],
    );

    return reply.send({ status: "feedback_recorded" });
  });

  /** GET /v1/hrms/ai/plugins/summary — admin dashboard summary */
  app.get("/v1/hrms/ai/plugins/summary", async (req, reply) => {
    const ctx = resolveContext(req);

    const [totals] = await sqlClient.query(
      `SELECT
        (SELECT COUNT(*)::int FROM hrms.ai_plugin_configs WHERE tenant_id = $1 AND enabled = true) AS active_plugins,
        (SELECT COUNT(*)::int FROM hrms.ai_prediction_log WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '24 hours') AS predictions_today,
        (SELECT COUNT(*)::int FROM hrms.ai_prediction_log WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '30 days') AS predictions_30d,
        (SELECT ROUND(AVG(confidence)::numeric, 1) FROM hrms.ai_prediction_log WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days') AS avg_confidence_7d`,
      [ctx.tenantId],
    ).then(r => r.rows);

    return reply.send({
      data: {
        totalPlugins: ML_PLUGINS.length,
        activePlugins: totals?.active_plugins ?? 0,
        predictionsToday: totals?.predictions_today ?? 0,
        predictions30d: totals?.predictions_30d ?? 0,
        avgConfidence7d: totals?.avg_confidence_7d ?? null,
      },
    });
  });
}
