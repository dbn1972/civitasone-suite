import { z } from "zod";
import { DEP_TYPES, MAX_LAG_MS, MIN_LAG_MS, MAX_DEPS_PER_TASK } from "./domain.js";

export const createDependencyBody = z.object({
  fromTaskId: z.string().uuid(),
  toTaskId:   z.string().uuid(),
  depType:    z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
  lagMs:      z.coerce.bigint().default(0n).refine(
    (v) => v >= MIN_LAG_MS && v <= MAX_LAG_MS,
    { message: `lagMs must be between ${MIN_LAG_MS} and ${MAX_LAG_MS} (±365 days in ms)` },
  ),
});
export type CreateDependencyBody = z.infer<typeof createDependencyBody>;

export const projectIdParam = z.object({
  projectId: z.string().uuid(),
});

export const dependencyIdParam = z.object({
  projectId: z.string().uuid(),
  id:        z.string().uuid(),
});

export const listDepsQuery = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListDepsQuery = z.infer<typeof listDepsQuery>;
