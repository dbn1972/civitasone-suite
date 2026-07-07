import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { rolesModuleSchema } from "../modules/roles/schema.js";
import { bindingsModuleSchema } from "../modules/bindings/schema.js";
import { abacModuleSchema } from "../modules/abac/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://policy_svc:***@host/civitas_policy)");

export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, { schema: { ...rolesModuleSchema, ...bindingsModuleSchema, ...abacModuleSchema, ...outboxSchema } });
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
