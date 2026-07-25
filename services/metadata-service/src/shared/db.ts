import { createTenantDb } from "@civitasone/db";
import { entityDefinitions } from "../modules/entities/schema.js";

const SCHEMA = { entityDefinitions };
const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });
export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
