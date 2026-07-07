/**
 * telephony-service DB connection.
 * Connects with the telephony_svc role to the civitas_telephony database ONLY (L1).
 * Drizzle is bound to this service's module schemas + the outbox schema.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as callsModule } from "../modules/calls/schema.js";
import { schema as queuesModule } from "../modules/queues/schema.js";
import { schema as agentsModule } from "../modules/agents/schema.js";
import { schema as didModule } from "../modules/did/schema.js";
import { schema as ivrModule } from "../modules/ivr/schema.js";
import { schema as recordingsModule } from "../modules/recordings/schema.js";
import { schema as transcriptionModule } from "../modules/transcription/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://telephony_svc:***@host/civitas_telephony)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: { ...callsModule, ...queuesModule, ...agentsModule, ...didModule, ...ivrModule, ...recordingsModule, ...transcriptionModule, ...outboxSchema },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
