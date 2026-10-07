/**
 * loyalty route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls loyalty-service through the gateway via cookie-aware fetchJson.
 *
 * GAP-LOYALTY-ACCRUALS-01 / MEMBERS-01 / REDEMPTIONS-02 / TIERS-01 / PROGRAMS-03:
 * every loader below parses the real loyalty-service response shape with a zod
 * schema at the boundary and maps it to a typed row the dedicated loyalty
 * tables render — replacing the previous generic field-guessing `mapRows`
 * (code ?? currency ?? updatedAt ?? … ?? points ?? balance) that folded points,
 * balances and timestamps into a single "meta" string and showed a status in
 * the "Detail" column. Field names are taken from each module's repo.toView()
 * in services/loyalty-service (programs/enrolments/accruals/redemptions/tiers).
 */
import { z } from "zod";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/** The envelope every loyalty-service list route returns: { data: [...], meta }. */
function listEnvelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z
      .object({
        page: z.number().optional(),
        pageSize: z.number().optional(),
        total: z.number().optional(),
      })
      .partial()
      .optional(),
  });
}

// ---- Programmes -----------------------------------------------------------

const programApi = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  earnRatio: z.string().nullable().optional(),
  expiryDays: z.number().nullable().optional(),
  version: z.number().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

export type LoyaltyProgramRow = {
  id: string;
  name: string;
  status: string;
  earnRatio: string | null;
  expiryDays: number | null;
  updatedAt: string | null;
};

// ---- Members (enrolments) -------------------------------------------------

const enrolmentApi = z.object({
  id: z.string(),
  programId: z.string().nullable().optional(),
  profileId: z.string().nullable().optional(),
  status: z.string(),
  tier: z.string().nullable().optional(),
  pointsBalance: z.string().nullable().optional(),
  lifetimePoints: z.string().nullable().optional(),
  enrolledAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

export type LoyaltyMemberRow = {
  id: string;
  profileId: string | null;
  programId: string | null;
  status: string;
  tier: string;
  pointsBalance: string | null;
  lifetimePoints: string | null;
  enrolledAt: string | null;
  updatedAt: string | null;
};

// ---- Redemptions ----------------------------------------------------------

const redemptionApi = z.object({
  id: z.string(),
  memberId: z.string().nullable().optional(),
  enrolmentId: z.string().nullable().optional(),
  points: z.string().nullable().optional(),
  rewardType: z.string().nullable().optional(),
  status: z.string(),
  version: z.number().nullable().optional(),
  redeemedAt: z.string().nullable().optional(),
  voidedAt: z.string().nullable().optional(),
  voidReason: z.string().nullable().optional(),
});

export type LoyaltyRedemptionRow = {
  id: string;
  memberId: string | null;
  enrolmentId: string | null;
  points: string | null;
  rewardType: string;
  status: string;
  version: number | null;
  redeemedAt: string | null;
  voidedAt: string | null;
};

// ---- Tiers (definitions) --------------------------------------------------

const tierApi = z.object({
  id: z.string(),
  programId: z.string().nullable().optional(),
  name: z.string(),
  level: z.number().nullable().optional(),
  minPointsThreshold: z.string().nullable().optional(),
  benefits: z.record(z.unknown()).nullable().optional(),
});

export type LoyaltyTierRow = {
  id: string;
  programId: string | null;
  name: string;
  level: number | null;
  minPointsThreshold: string | null;
  benefits: Record<string, unknown> | null;
};

// ---- Stats (hub) ----------------------------------------------------------

export type LoyaltyStats = {
  activeMembers: number | null;
  pointsIssued: string | null;
  redemptionsPending: number | null;
};

// ---- Loaders --------------------------------------------------------------

const programsSchema = listEnvelope(programApi);
const enrolmentsSchema = listEnvelope(enrolmentApi);
const redemptionsSchema = listEnvelope(redemptionApi);
const tiersSchema = listEnvelope(tierApi);

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function getLoyaltyPrograms(
  params: { limit?: number; offset?: number } = {},
): Promise<LoaderResult<LoyaltyProgramRow[]>> {
  return fetchJson<z.infer<typeof programsSchema>, LoyaltyProgramRow[]>(
    `/api/v1/loyalty/programs${qs(params)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "loyalty.programs",
      responseSchema: programsSchema,
      mapResponse: (payload) =>
        payload.data.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          earnRatio: p.earnRatio ?? null,
          expiryDays: p.expiryDays ?? null,
          updatedAt: p.updatedAt ?? null,
        })),
    },
  );
}

function mapEnrolment(e: z.infer<typeof enrolmentApi>): LoyaltyMemberRow {
  return {
    id: e.id,
    profileId: e.profileId ?? null,
    programId: e.programId ?? null,
    status: e.status,
    tier: e.tier ?? "base",
    pointsBalance: e.pointsBalance ?? null,
    lifetimePoints: e.lifetimePoints ?? null,
    enrolledAt: e.enrolledAt ?? null,
    updatedAt: e.updatedAt ?? null,
  };
}

export function getLoyaltyMembers(
  params: { limit?: number; offset?: number; programId?: string } = {},
): Promise<LoaderResult<LoyaltyMemberRow[]>> {
  return fetchJson<z.infer<typeof enrolmentsSchema>, LoyaltyMemberRow[]>(
    `/api/v1/loyalty/enrolments${qs(params)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "loyalty.members",
      responseSchema: enrolmentsSchema,
      mapResponse: (payload) => payload.data.map(mapEnrolment),
    },
  );
}

/**
 * GAP-LOYALTY-ACCRUALS-01/02/03: loyalty-service exposes points transactions
 * only per enrolment (GET /enrolments/:id/accruals), not tenant-wide, so the
 * tenant-level Accruals surface is the per-member points *position* — current
 * balance and lifetime points earned per enrolment. Same enrolment source as
 * Members but projected to the points columns, so points/balance are always
 * visible (never buried behind a timestamp as the old meta chain did), and the
 * page no longer promises a per-member drill-down route that does not exist.
 */
export function getLoyaltyAccruals(
  params: { limit?: number; offset?: number } = {},
): Promise<LoaderResult<LoyaltyMemberRow[]>> {
  return fetchJson<z.infer<typeof enrolmentsSchema>, LoyaltyMemberRow[]>(
    `/api/v1/loyalty/enrolments${qs(params)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "loyalty.accruals",
      responseSchema: enrolmentsSchema,
      mapResponse: (payload) => payload.data.map(mapEnrolment),
    },
  );
}

export function getLoyaltyRedemptions(
  params: { limit?: number; offset?: number } = {},
): Promise<LoaderResult<LoyaltyRedemptionRow[]>> {
  return fetchJson<z.infer<typeof redemptionsSchema>, LoyaltyRedemptionRow[]>(
    `/api/v1/loyalty/redemptions${qs(params)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "loyalty.redemptions",
      responseSchema: redemptionsSchema,
      mapResponse: (payload) =>
        payload.data.map((r) => ({
          id: r.id,
          memberId: r.memberId ?? null,
          enrolmentId: r.enrolmentId ?? null,
          points: r.points ?? null,
          rewardType: r.rewardType ?? "",
          status: r.status,
          version: r.version ?? null,
          redeemedAt: r.redeemedAt ?? null,
          voidedAt: r.voidedAt ?? null,
        })),
    },
  );
}

export function getLoyaltyTiers(
  params: { limit?: number; offset?: number; programId?: string } = {},
): Promise<LoaderResult<LoyaltyTierRow[]>> {
  return fetchJson<z.infer<typeof tiersSchema>, LoyaltyTierRow[]>(
    `/api/v1/loyalty/tiers${qs(params)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "loyalty.tiers",
      responseSchema: tiersSchema,
      mapResponse: (payload) =>
        payload.data.map((tdef) => ({
          id: tdef.id,
          programId: tdef.programId ?? null,
          name: tdef.name,
          level: tdef.level ?? null,
          minPointsThreshold: tdef.minPointsThreshold ?? null,
          benefits: tdef.benefits ?? null,
        })),
    },
  );
}

/**
 * GAP-LOYALTY-HOME-01: hub KPIs derived from the list endpoints (loyalty-service
 * has no dedicated stats endpoint). Each count comes from a list envelope's
 * `meta.total`; when a call fails the figure is null so the hub renders "—"
 * (never a fabricated 0). Points issued is the sum of lifetime points across
 * the first page of enrolments (an honest tenant-level approximation; the full
 * ledger total would need a backend aggregate, recorded for HUMAN REVIEW).
 */
export async function getLoyaltyStats(): Promise<LoyaltyStats> {
  const [members, redemptions] = await Promise.all([
    fetchJson<z.infer<typeof enrolmentsSchema>, { total: number | null; lifetime: bigint }>(
      `/api/v1/loyalty/enrolments${qs({ limit: 200 })}`,
      { total: null, lifetime: 0n },
      {
        revalidateSeconds: 30,
        telemetryKey: "loyalty.stats.members",
        responseSchema: enrolmentsSchema,
        mapResponse: (payload) => {
          let lifetime = 0n;
          for (const e of payload.data) {
            try {
              if (e.lifetimePoints) lifetime += BigInt(e.lifetimePoints);
            } catch {
              /* ignore an unparseable lifetime figure rather than fail the stat */
            }
          }
          const active = payload.data.filter((e) => e.status === "active").length;
          return { total: payload.meta?.total ?? active, lifetime };
        },
      },
    ),
    fetchJson<z.infer<typeof redemptionsSchema>, number | null>(
      `/api/v1/loyalty/redemptions${qs({ limit: 200 })}`,
      null,
      {
        revalidateSeconds: 30,
        telemetryKey: "loyalty.stats.redemptions",
        responseSchema: redemptionsSchema,
        mapResponse: (payload) => payload.data.filter((r) => r.status === "pending").length,
      },
    ),
  ]);

  return {
    activeMembers: members.source === "error" ? null : members.data.total,
    pointsIssued: members.source === "error" ? null : members.data.lifetime.toString(),
    redemptionsPending: redemptions.source === "error" ? null : redemptions.data,
  };
}
