/**
 * The single place where every crm-service command consumer is wired to the bus.
 *
 * Registration used to live inline in worker.ts, which let a consumer be written
 * and never subscribed: the route still returned 202 Accepted but nothing ever
 * applied the write. Keeping one exported registrar means the worker and the
 * `consumer-registration` test wire the exact same set, so an unsubscribed
 * command topic fails CI instead of silently discarding a mutation.
 */
import type { Queue } from "@civitasone/queue";
import { registerContactConsumers } from "./modules/contacts/consumer.js";
import { registerContactRoleConsumers } from "./modules/contacts/roles-consumer.js";
import { registerConversionConsumer } from "./modules/contacts/conversion-consumer.js";
import { registerTransferConsumer } from "./modules/contacts/transfer-consumer.js";
import { registerDealConsumers } from "./modules/deals/consumer.js";
import { registerDealCloseConsumer } from "./modules/deals/close-consumer.js";
import { registerQuotationConsumers } from "./modules/deals/quotation-consumer.js";
import { registerActivityConsumers } from "./modules/activities/consumer.js";
import { registerNotificationDeliveryConsumer } from "./modules/activities/notification-delivery-consumer.js";
import { registerLeadScoringConsumers } from "./modules/leads/consumer.js";
import { registerInboundCaptureConsumer } from "./modules/leads/inbound-consumer.js";
import { registerLifecycleConsumer } from "./modules/leads/lifecycle-consumer.js";
import { registerLeadFieldRuleConsumers } from "./modules/leads/field-rules-consumer.js";
import { registerPipelineConsumers } from "./modules/pipelines/consumer.js";
import { registerCustomFieldConsumers } from "./modules/custom-fields/consumer.js";
import { registerTeamConsumers } from "./modules/teams/consumer.js";
import { registerResidualF3Consumers } from "./modules/residual-f3/consumer.js";
import { registerOnboardingConsumers } from "./modules/onboarding/consumer.js";
import { registerSentimentConsumers } from "./modules/sentiment/consumer.js";

export function registerAllConsumers(queue: Queue): void {
  registerContactConsumers(queue);
  registerContactRoleConsumers(queue);
  registerConversionConsumer(queue);
  registerTransferConsumer(queue);
  registerDealConsumers(queue);
  registerDealCloseConsumer(queue);
  registerQuotationConsumers(queue);
  registerActivityConsumers(queue);
  registerNotificationDeliveryConsumer(queue);
  registerLeadScoringConsumers(queue);
  registerInboundCaptureConsumer(queue);
  registerLifecycleConsumer(queue);
  registerLeadFieldRuleConsumers(queue);
  registerPipelineConsumers(queue);
  registerCustomFieldConsumers(queue);
  registerTeamConsumers(queue);
  registerResidualF3Consumers(queue);
  registerOnboardingConsumers(queue);
  registerSentimentConsumers(queue);
}
