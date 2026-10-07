/**
 * Roles permitted to export ML Insights prediction data.
 *
 * Restrictive default (fail-closed): mirrors ml-service's EVALUATION_ROLES
 * (services/ml-service/src/modules/evaluations/routes.ts) so the UI export
 * control is only shown to callers the API would also serve. The server
 * remains the authority — this only hides a control that would otherwise
 * build a CSV of scored entity ids and model scores client-side.
 *
 * GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-07/08, -INVENTORY-07, -LEADS-06,
 * -PROJECTS-06, -SUBSCRIPTIONS-07, -TICKETS-06.
 */
export const ML_EXPORT_ROLES = ["ml_admin", "analytics_admin", "super_admin"];
