import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";
import { querySpecSchema } from "../registry/spec.js";
import { METRIC_KEYS } from "../registry/registry.js";

export const saveMetricBody = z
  .object({
    name: z.string().min(1).max(200),
    /** must be a whitelisted base metric; the spec is also registry-validated */
    metricKey: z.enum(METRIC_KEYS),
    spec: querySpecSchema,
  })
  .strict()
  // the spec's own metric must match the declared metricKey (no smuggling).
  .refine((b) => b.spec.metric === b.metricKey, {
    message: "spec.metric must equal metricKey",
    path: ["spec", "metric"],
  });
export type SaveMetricBody = z.infer<typeof saveMetricBody>;

export const savedMetricViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  metricKey: z.string(),
  spec: z.record(z.unknown()),
  version: z.number().int(),
});
export const savedMetricsListSchema = paginatedSchema(savedMetricViewSchema);
