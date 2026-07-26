import { createTenantDb } from "@civitasone/db";
import { schema as SCHEMA } from "../modules/entities/schema.js";

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });
export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
