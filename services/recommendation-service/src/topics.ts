/** Topic + event names owned by recommendation-service. {service}.{entity}.{action} */
export const COMMANDS = {
  /** Compute NBA (Next Best Action) recommendations for a profile. */
  nbaCompute: "recommendation.nba.compute",
  /** Update cross-sell matrix entries. */
  matrixUpdate: "recommendation.matrix.update",
  /** Recompute health score for an account. */
  healthRecompute: "recommendation.health.recompute",
  /** Record acceptance or rejection feedback for a recommendation. */
  feedbackRecord: "recommendation.feedback.record",
  /**
   * CR-AI-02 — attach sales collateral to a served recommendation.
   * Payload: { linkId, recommendationId, collateralType, collateralRef, title, ordinal }.
   * Fired by POST /v1/recommendations/:id/collateral (202); consumed by collateral/consumer.ts.
   */
  collateralAttach: "recommendation.collateral.attach",
  /**
   * F.6 — recompute key-account intelligence (white space, risk, opportunity score).
   * Payload: { accountId, whiteSpace, riskSignals }.
   * Fired by POST /v1/recommendations/accounts/:accountId/intelligence/compute (202);
   * consumed by intelligence/consumer.ts.
   */
  intelligenceCompute: "recommendation.intelligence.compute",
} as const;

export const EVENTS = {
  /** A set of recommendations was served to a profile. */
  recommendationServed: "recommendation.nba.served",
  /** A recommendation was accepted by a user. */
  recommendationAccepted: "recommendation.nba.accepted",
  /** A recommendation was rejected by a user. */
  recommendationRejected: "recommendation.nba.rejected",
  /** Account health score was recomputed. */
  healthScoreUpdated: "recommendation.health.updated",
  /** A cross-sell matrix rule was created. Payload: { matrixId, triggerProductId, recommendedProductId, segment, channel, priority }. */
  matrixEntryCreated: "recommendation.matrix.created",
  /** A cross-sell matrix rule was updated. Payload: { matrixId, patch }. */
  matrixEntryUpdated: "recommendation.matrix.updated",
  /** A cross-sell matrix rule was removed. Payload: { matrixId }. */
  matrixEntryDeleted: "recommendation.matrix.deleted",
  /** Feedback was recorded against a served recommendation. Payload: { feedbackId, recommendationId, action, hasReason }. */
  feedbackRecorded: "recommendation.feedback.recorded",
  /**
   * CR-AI-01 — a predictive model score was written or refreshed by ml-service.
   * Payload: { scoreId, subjectType, subjectId, modelType, score (string), modelVersion }.
   * score is a decimal STRING: numeric(12,4) must not round-trip through a float.
   */
  predictiveScoreUpserted: "recommendation.predictive.upserted",
  /** CR-AI-02 — collateral was linked to a recommendation. Payload: { linkId, recommendationId, collateralType }. */
  collateralAttached: "recommendation.collateral.attached",
  /** CR-AI-02 — a collateral link was removed. Payload: { linkId, recommendationId }. */
  collateralDetached: "recommendation.collateral.detached",
  /** F.6 — key-account intelligence was recomputed. Payload: { accountId, opportunityScore (string), riskCount }. */
  intelligenceComputed: "recommendation.intelligence.computed",
  /** F.6 — a ranked next-best-action set was generated. Payload: { profileId, actionIds, count }. */
  nbaGenerated: "recommendation.nba.generated",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "recommendation";
export const RESOURCE = "recommendation";
