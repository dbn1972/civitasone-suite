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
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "recommendation";
export const RESOURCE = "recommendation";
