export type TrendRow = {
  period: string;
  demandMinor: string;
  collectionMinor: string;
  efficiencyBps: number;
} & Record<string, unknown>;

export type EfficiencyKpi = {
  totalDemandMinor: string;
  totalCollectionMinor: string;
  efficiencyBps: number;
  perPeriod: TrendRow[];
};

export type AgingBuckets = {
  bucket0_30: string;
  bucket31_60: string;
  bucket61_90: string;
  bucket90Plus: string;
};

export type AgingBucketRow = {
  bucket: string;
  outstandingMinor: string;
} & Record<string, unknown>;

export type DefaulterRow = {
  rank: number;
  assesseeId: string;
  outstandingMinor: string;
} & Record<string, unknown>;

export type ForecastProjection = {
  index: number;
  projectionMinor: string;
  lowerMinor: string;
  upperMinor: string;
} & Record<string, unknown>;

export type ForecastResult = {
  method: string;
  historyPeriods: number;
  horizon: number;
  madMinor: string;
  confidenceBps: number;
  projections: ForecastProjection[];
  granularity: string;
  param: number;
  series: string[];
  runId?: string;
};
