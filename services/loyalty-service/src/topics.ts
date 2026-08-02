/** Topic + event names owned by loyalty-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createProgram: "loyalty.program.create",
  updateProgram: "loyalty.program.update",
  transitionProgram: "loyalty.program.transition",
  archiveProgram: "loyalty.program.archive",
  enrolMember: "loyalty.member.enrol",
  updateEnrolmentStatus: "loyalty.enrolment.update_status",
  accruePoints: "loyalty.points.accrue",
  redeemPoints: "loyalty.points.redeem",
  voidRedemption: "loyalty.redemption.void",
  evaluateTier: "loyalty.tier.evaluate",
} as const;

export const EVENTS = {
  /** Emitted when a member is enrolled into a loyalty programme. */
  memberEnrolled: "loyalty.member.enrolled",
  /** Emitted when points are accrued to a member's balance. */
  pointsAccrued: "loyalty.points.accrued",
  /** Emitted when a member redeems points. */
  pointsRedeemed: "loyalty.points.redeemed",
  /** Emitted when a redemption is voided. */
  redemptionVoided: "loyalty.redemption.voided",
  /** Emitted when a member's tier changes (upgrade or downgrade). */
  tierChanged: "loyalty.tier.changed",
  /** Emitted when a loyalty programme is created. */
  programCreated: "loyalty.program.created",
  /** Emitted when a loyalty programme is updated. */
  programUpdated: "loyalty.program.updated",
  /** Emitted when a loyalty programme status transitions. */
  programTransitioned: "loyalty.program.transitioned",
  /** Emitted when a loyalty programme is archived. */
  programArchived: "loyalty.program.archived",
  /** Emitted when an enrolment status changes. */
  enrolmentStatusChanged: "loyalty.enrolment.status_changed",
} as const;

/** Inbound events consumed from other services. */
export const INBOUND = {} as const;

/** Audit sink consumed by audit-service. */
export const AUDIT_TOPIC = "audit.event.record";

export const SERVICE = "loyalty";
