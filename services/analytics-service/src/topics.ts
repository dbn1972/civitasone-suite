export const COMMANDS = {
  runQuery: "analytics.query.run",
} as const;
export const EVENTS = {
  queryRun: "analytics.query.run.completed",
  dashboardListed: "analytics.dashboard.listed",
} as const;
export const SERVICE = "analytics";
export const DASHBOARD_RESOURCE = "dashboard";
export const QUERY_RESOURCE = "query_run";
