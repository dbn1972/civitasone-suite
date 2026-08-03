/**
 * recommendation-service consumer / outbox relay entrypoint.
 * Processes commands from SQS/RabbitMQ and relays outbox events.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { tenantScoped } from "./shared/tenant-queue.js";
import { COMMANDS, SERVICE } from "./topics.js";
import {
  handleAttachCollateral,
  handleDetachCollateral,
  type AttachCollateralPayload,
  type DetachCollateralPayload,
} from "./modules/collateral/consumer.js";
import {
  handleComputeIntelligence,
  type ComputeIntelligencePayload,
} from "./modules/intelligence/consumer.js";
import {
  handleRecordAttribution,
  handleAssignExposure,
  type RecordAttributionPayload,
  type AssignExposurePayload,
} from "./modules/measurement/consumer.js";
import {
  handleNbaCreate,
  handleNbaAccept,
  handleNbaReject,
  type NbaCreatePayload,
  type NbaAcceptPayload,
  type NbaRejectPayload,
} from "./modules/nba/consumer.js";
import {
  handleMatrixCreate,
  handleMatrixUpdate,
  handleMatrixDelete,
  type MatrixCreatePayload,
  type MatrixUpdatePayload,
  type MatrixDeletePayload,
} from "./modules/matrix/consumer.js";
import {
  handleHealthRecompute,
  type HealthRecomputePayload,
} from "./modules/health/consumer.js";
import {
  handleFeedbackRecord,
  type FeedbackRecordPayload,
} from "./modules/feedback/consumer.js";
import {
  handlePredictiveUpsert,
  type PredictiveUpsertPayload,
} from "./modules/predictive/consumer.js";
import {
  handleTriggerCreate,
  handleTriggerUpdate,
  handleTriggerDeactivate,
  type TriggerCreatePayload,
  type TriggerUpdatePayload,
  type TriggerDeactivatePayload,
} from "./modules/triggers/consumer.js";

const log = pino({ name: "recommendation-worker" });
const q = tenantScoped(queue);

const relay = startRelay(db, queue, 1000, SERVICE);

q.subscribe<NbaCreatePayload>(COMMANDS.nbaCreate, handleNbaCreate);
q.subscribe<NbaAcceptPayload>(COMMANDS.nbaAccept, handleNbaAccept);
q.subscribe<NbaRejectPayload>(COMMANDS.nbaReject, handleNbaReject);
q.subscribe<MatrixCreatePayload>(COMMANDS.matrixCreate, handleMatrixCreate);
q.subscribe<MatrixUpdatePayload>(COMMANDS.matrixUpdate, handleMatrixUpdate);
q.subscribe<MatrixDeletePayload>(COMMANDS.matrixDelete, handleMatrixDelete);
q.subscribe<HealthRecomputePayload>(COMMANDS.healthRecompute, handleHealthRecompute);
q.subscribe<FeedbackRecordPayload>(COMMANDS.feedbackRecord, handleFeedbackRecord);
q.subscribe<AttachCollateralPayload>(COMMANDS.collateralAttach, handleAttachCollateral);
q.subscribe<DetachCollateralPayload>(COMMANDS.collateralDetach, handleDetachCollateral);
q.subscribe<ComputeIntelligencePayload>(COMMANDS.intelligenceCompute, handleComputeIntelligence);
q.subscribe<PredictiveUpsertPayload>(COMMANDS.predictiveUpsert, handlePredictiveUpsert);
q.subscribe<AssignExposurePayload>(COMMANDS.exposureAssign, handleAssignExposure);
q.subscribe<RecordAttributionPayload>(COMMANDS.attributionRecord, handleRecordAttribution);
q.subscribe<TriggerCreatePayload>(COMMANDS.triggerRuleCreate, handleTriggerCreate);
q.subscribe<TriggerUpdatePayload>(COMMANDS.triggerRuleUpdate, handleTriggerUpdate);
q.subscribe<TriggerDeactivatePayload>(COMMANDS.triggerRuleDeactivate, handleTriggerDeactivate);

void queue.start().catch((err: unknown) => {
  log.error({ err }, "queue consumer failed to start");
  process.exit(1);
});

log.info("recommendation-service worker: outbox relay + command consumers running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
