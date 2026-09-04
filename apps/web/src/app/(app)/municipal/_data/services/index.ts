import { shopService } from "./shop";
import { tradeService } from "./trade";
import { buildingService } from "./building";
import { fireService } from "./fire";
import { advertisementService } from "./advertisement";
import { vendorService } from "./vendor";
import { roadcutService } from "./roadcut";
import { eventService } from "./event";
import { refundService } from "./refund";
import { sewerageService } from "./sewerage";
import { swmService } from "./swm";
import { drainageService } from "./drainage";
import { parksService } from "./parks";
import { animalService } from "./animal";
import { crematoriumService } from "./crematorium";
import { parkingService } from "./parking";
import { marketService } from "./market";

export type { MunicipalServiceConfig } from "./types";
import type { MunicipalServiceConfig } from "./types";

/** 16 Sec5 services + shop reference (17 total). Order matches BRD §5 listing. */
export const MUNICIPAL_SERVICE_CATALOG: MunicipalServiceConfig[] = [
  shopService,
  tradeService,
  buildingService,
  fireService,
  advertisementService,
  vendorService,
  roadcutService,
  eventService,
  refundService,
  sewerageService,
  swmService,
  drainageService,
  parksService,
  animalService,
  crematoriumService,
  parkingService,
  marketService,
];

export const SEC5_SERVICE_COUNT = MUNICIPAL_SERVICE_CATALOG.filter((s) => s.sec5).length;

const byKey = new Map(MUNICIPAL_SERVICE_CATALOG.map((s) => [s.serviceKey, s]));

export function getMunicipalService(serviceKey: string): MunicipalServiceConfig | undefined {
  return byKey.get(serviceKey);
}

export function listSec5Services(): MunicipalServiceConfig[] {
  return MUNICIPAL_SERVICE_CATALOG.filter((s) => s.sec5);
}

export function detailPathFor(config: MunicipalServiceConfig, id: string): string {
  return `${config.listPath}/${encodeURIComponent(id)}`;
}

export function officerApplicationsHref(serviceKey: string): string {
  return `/municipal/${serviceKey}/applications`;
}

export function officerDetailHref(serviceKey: string, id: string): string {
  return `/municipal/${serviceKey}/applications/${encodeURIComponent(id)}`;
}

export function citizenServiceHref(citizenServiceKey: string): string {
  return `/citizen/services/${encodeURIComponent(citizenServiceKey)}`;
}

export function citizenApplyHref(citizenServiceKey: string): string {
  return `/citizen/services/${encodeURIComponent(citizenServiceKey)}/apply`;
}
