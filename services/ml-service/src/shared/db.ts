import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";
import { schema as modelsSchema } from "../modules/models/schema.js";
import { schema as predictionsSchema } from "../modules/predictions/schema.js";
import { schema as featureStoreSchema } from "../modules/feature-store/schema.js";
import { schema as trainingSchema } from "../modules/training/schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://ml_svc:***@host/civitas_ml)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: {
    ...outboxSchema,
    ...modelsSchema,
    ...predictionsSchema,
    ...featureStoreSchema,
    ...trainingSchema,
  },
});
export type Db = typeof db;
