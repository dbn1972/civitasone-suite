import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as locationsModule } from "../modules/locations/schema.js";
import { schema as hierarchyModule } from "../modules/hierarchy/schema.js";
import { schema as jurisdictionModule } from "../modules/jurisdiction/schema.js";
import { schema as geofenceModule } from "../modules/geofence/schema.js";
import { schema as pincodeModule } from "../modules/pincode/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://location_svc:***@host/civitas_location)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: {
    ...locationsModule,
    ...hierarchyModule,
    ...jurisdictionModule,
    ...geofenceModule,
    ...pincodeModule,
    ...outboxSchema,
  },
});

export type Db = typeof db;
