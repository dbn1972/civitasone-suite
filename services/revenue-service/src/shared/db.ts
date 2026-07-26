/**
 * revenue-service DB connection — TenantRouter adoption.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as rateEngineModule }  from "../modules/rate-engine/schema.js";
import { schema as assesseeModule }    from "../modules/assessee/schema.js";
import { schema as assessmentModule }  from "../modules/assessment/schema.js";
import { schema as billingModule }     from "../modules/billing/schema.js";
import { schema as collectionModule }  from "../modules/collection/schema.js";
import { schema as arrearsModule }     from "../modules/arrears/schema.js";
import { schema as bbpsModule }        from "../modules/bbps/schema.js";
import { schema as analyticsModule }   from "../modules/analytics/schema.js";
import { outboxSchema }                from "./outbox.js";

const SCHEMA = {
  ...rateEngineModule,
  ...assesseeModule,
  ...assessmentModule,
  ...billingModule,
  ...collectionModule,
  ...arrearsModule,
  ...bbpsModule,
  ...analyticsModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
