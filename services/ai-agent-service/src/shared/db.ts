import { createTenantDb } from "@civitasone/db";
import { schema as chatModule } from "../modules/chat/schema.js";
import { schema as copilotModule } from "../modules/copilot/schema.js";
import { schema as agentsModule } from "../modules/agents/schema.js";
import { schema as governanceModule } from "../modules/governance/schema.js";

const SCHEMA = {
  ...chatModule,
  ...copilotModule,
  ...agentsModule,
  ...governanceModule,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
