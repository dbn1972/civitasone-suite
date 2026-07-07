import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as stagesModule } from "../modules/stages/schema.js";
import { schema as provisioningModule } from "../modules/provisioning/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://install_svc:***@host/civitas_install)");

export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, { schema: { ...stagesModule, ...provisioningModule, ...outboxSchema } });
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
