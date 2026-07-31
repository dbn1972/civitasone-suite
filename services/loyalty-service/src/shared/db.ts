import { createTenantDb } from "@civitasone/db";
import { schema as programsModule } from "../modules/programs/schema.js";
import { schema as enrolmentsModule } from "../modules/enrolments/schema.js";
import { schema as accrualsModule } from "../modules/accruals/schema.js";
import { schema as redemptionsModule } from "../modules/redemptions/schema.js";

const SCHEMA = {
  ...programsModule,
  ...enrolmentsModule,
  ...accrualsModule,
  ...redemptionsModule,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
