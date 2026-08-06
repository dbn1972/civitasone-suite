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
import { registerMergeConsumers } from "./modules/contacts/merge-consumer.js";
import { registerTransferConsumer } from "./modules/contacts/transfer-consumer.js";
import { registerClassificationConsumer } from "./modules/contacts/classification-consumer.js";
import { registerDealConsumers } from "./modules/deals/consumer.js";
import { registerDealCloseConsumer } from "./modules/deals/close-consumer.js";
import { registerQuotationConsumers } from "./modules/deals/quotation-consumer.js";
import { registerActivityConsumers } from "./modules/activities/consumer.js";
import { registerNotificationDeliveryConsumer } from "./modules/activities/notification-delivery-consumer.js";
import { registerLeadScoringConsumers } from "./modules/leads/consumer.js";
import { registerInboundCaptureConsumer } from "./modules/leads/inbound-consumer.js";
import { registerLifecycleConsumer } from "./modules/leads/lifecycle-consumer.js";
import { registerLeadFieldRuleConsumers } from "./modules/leads/field-rules-consumer.js";
import { registerLeadCaptureFormConsumers } from "./modules/leads/capture-forms-consumer.js";
import { registerPublicLeadCaptureConsumer } from "./modules/leads/public-capture-consumer.js";
import { registerQualificationConsumer } from "./modules/leads/qualification-consumer.js";
import { registerPipelineConsumers } from "./modules/pipelines/consumer.js";
import { registerCustomFieldConsumers } from "./modules/custom-fields/consumer.js";
import { registerTeamConsumers } from "./modules/teams/consumer.js";
import { registerResidualF3Consumers } from "./modules/residual-f3/consumer.js";
import { registerOnboardingConsumers } from "./modules/onboarding/consumer.js";
import { registerSentimentConsumers } from "./modules/sentiment/consumer.js";
import { registerAssignmentConsumers } from "./modules/assignment/consumer.js";
import { registerCommunicationConsumers } from "./modules/communications/consumer.js";
import { registerSendConsumers } from "./modules/communications/send-consumer.js";
import { registerCampaignApprovalConsumers } from "./modules/communications/campaign-approval-consumer.js";
import { registerDeliveryStatusConsumers } from "./modules/communications/delivery-status-consumer.js";
import { registerContactCommunicationConsumer } from "./modules/communications/contact-activity-consumer.js";
import { registerAddressConsumers } from "./modules/addresses/consumer.js";
import { registerAccountRelationshipConsumers } from "./modules/accounts/relationships-consumer.js";
import { registerIntegrationConsumers } from "./modules/integrations/consumer.js";
import { registerStageLimitConsumers } from "./modules/deals/stage-limits-consumer.js";
import { registerProductConsumers } from "./modules/products/consumer.js";
import { registerPriceBookConsumers } from "./modules/price-books/consumer.js";
import { registerQuotationApprovalConsumers } from "./modules/deals/quotation-approval-consumer.js";
import { registerOrderConsumers } from "./modules/deals/orders-consumer.js";
import { registerDocumentConsumers } from "./modules/documents/consumer.js";
import { registerChecklistConsumers } from "./modules/checklists/consumer.js";
import { registerCommissionConsumers } from "./modules/commissions/consumer.js";
import { registerPaymentConsumers } from "./modules/subscriptions/payment-consumer.js";

export function registerAllConsumers(queue: Queue): void {
  registerContactConsumers(queue);
  registerContactRoleConsumers(queue);
  registerConversionConsumer(queue);
  registerMergeConsumers(queue);
  registerTransferConsumer(queue);
  registerClassificationConsumer(queue);
  registerDealConsumers(queue);
  registerDealCloseConsumer(queue);
  registerQuotationConsumers(queue);
  registerActivityConsumers(queue);
  registerNotificationDeliveryConsumer(queue);
  registerLeadScoringConsumers(queue);
  registerInboundCaptureConsumer(queue);
  registerLifecycleConsumer(queue);
  registerLeadFieldRuleConsumers(queue);
  // LM-002 — registry CRUD, and the one subscriber that applies a public submission.
  // Without the latter the public endpoint would answer 202 and write nothing.
  registerLeadCaptureFormConsumers(queue);
  registerPublicLeadCaptureConsumer(queue);
  registerQualificationConsumer(queue);
  registerPipelineConsumers(queue);
  registerCustomFieldConsumers(queue);
  registerTeamConsumers(queue);
  registerResidualF3Consumers(queue);
  registerOnboardingConsumers(queue);
  registerSentimentConsumers(queue);
  registerAssignmentConsumers(queue);
  // ── ACM: Activity/Follow-up + Account/Contact management ──
  registerCommunicationConsumers(queue);
  // CO-001: send/bulk-send consumers + delivery status feedback
  registerSendConsumers(queue);
  // Gap 2: campaign approval workflow consumers
  registerCampaignApprovalConsumers(queue);
  registerDeliveryStatusConsumers(queue);
  // BRD 9.4 - CRM<->Communication identifier mapping: project the hub's
  // notification.contact_activity.recorded event onto crm.contact_communications
  // so Customer-360 shows REAL communication/campaign counts instead of stubs.
  registerContactCommunicationConsumer(queue);
  registerAddressConsumers(queue);
  registerAccountRelationshipConsumers(queue);
  registerIntegrationConsumers(queue);
  // ── OP/QP: opportunity stage-limits, close policy, products, price books, quotation approvals, orders ──
  registerStageLimitConsumers(queue);
  registerProductConsumers(queue);
  registerPriceBookConsumers(queue);
  registerQuotationApprovalConsumers(queue);
  registerOrderConsumers(queue);
  // ── DM: Document & Attachment Management (BRD §7.12) ──
  registerDocumentConsumers(queue);
  // ── G7: checklist templates + instances (exporter readiness / insurance / B2B onboarding) ──
  registerChecklistConsumers(queue);
  // ── Generic CRM gaps ──
  // Gap 1: commission computation on deal closed
  registerCommissionConsumers(queue);
  // Gap 6: payment-due and balance-alert event consumers
  registerPaymentConsumers(queue);
}
