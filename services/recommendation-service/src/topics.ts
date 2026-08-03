/** Topic + event names owned by recommendation-service. {service}.{entity}.{action} */
export const COMMANDS = {
  nbaCreate: "recommendation.nba.create",
  nbaAccept: "recommendation.nba.accept",
  nbaReject: "recommendation.nba.reject",
  /** Legacy alias kept for any in-flight compute commands. */
  nbaCompute: "recommendation.nba.compute",

  matrixCreate: "recommendation.matrix.create",
  matrixUpdate: "recommendation.matrix.update",
  matrixDelete: "recommendation.matrix.delete",

  healthRecompute: "recommendation.health.recompute",

  feedbackRecord: "recommendation.feedback.record",

  collateralAttach: "recommendation.collateral.attach",
  collateralDetach: "recommendation.collateral.detach",

  intelligenceCompute: "recommendation.intelligence.compute",

  predictiveUpsert: "recommendation.predictive.upsert",

  exposureAssign: "recommendation.exposure.assign",
  attributionRecord: "recommendation.attribution.record",

  triggerRuleCreate: "recommendation.trigger-rule.create",
  triggerRuleUpdate: "recommendation.trigger-rule.update",
  triggerRuleDeactivate: "recommendation.trigger-rule.deactivate",
} as const;

export const EVENTS = {
  recommendationServed: "recommendation.nba.served",
  recommendationAccepted: "recommendation.nba.accepted",
  recommendationRejected: "recommendation.nba.rejected",
  healthScoreUpdated: "recommendation.health.updated",
  matrixEntryCreated: "recommendation.matrix.created",
  matrixEntryUpdated: "recommendation.matrix.updated",
  matrixEntryDeleted: "recommendation.matrix.deleted",
  feedbackRecorded: "recommendation.feedback.recorded",
  predictiveScoreUpserted: "recommendation.predictive.upserted",
  collateralAttached: "recommendation.collateral.attached",
  collateralDetached: "recommendation.collateral.detached",
  intelligenceComputed: "recommendation.intelligence.computed",
  nbaGenerated: "recommendation.nba.generated",
  triggerRuleCreated: "recommendation.trigger-rule.created",
  triggerRuleUpdated: "recommendation.trigger-rule.updated",
  triggerRuleDeactivated: "recommendation.trigger-rule.deactivated",
  cohortAssigned: "recommendation.cohort.assigned",
  outcomeAttributed: "recommendation.outcome.attributed",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "recommendation";
export const RESOURCE = "recommendation";
