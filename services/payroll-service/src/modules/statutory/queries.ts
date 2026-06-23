import * as repo from "./repo.js";

export async function listPfReport(tenantId: string, limit: number) {
  const rows = await repo.listPfByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    period: r.period,
    basicMinor: Number(r.basicMinor),
    empContribMinor: Number(r.empContribMinor),
    erContribMinor: Number(r.erContribMinor),
  }));
}

export async function listEsiReport(tenantId: string, limit: number) {
  const rows = await repo.listEsiByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    period: r.period,
    grossMinor: Number(r.grossMinor),
    empContribMinor: Number(r.empContribMinor),
    erContribMinor: Number(r.erContribMinor),
  }));
}

export async function listTdsReport(tenantId: string, limit: number) {
  const rows = await repo.listTdsByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    period: r.period,
    taxableMinor: Number(r.taxableMinor),
    tdsMinor: Number(r.tdsMinor),
  }));
}

export async function listGratuityReport(tenantId: string, limit: number) {
  const rows = await repo.listGratuityByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    yearsOfService: r.yearsOfService,
    gratuityMinor: Number(r.gratuityMinor),
    status: r.status,
  }));
}

export async function listGpfReport(tenantId: string, limit: number) {
  const rows = await repo.listGpfByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    period: r.period,
    basicMinor: Number(r.basicMinor),
    contribPct: r.contribPct,
    empContribMinor: Number(r.empContribMinor),
  }));
}

export async function listNpsReport(tenantId: string, limit: number) {
  const rows = await repo.listNpsByTenant(tenantId, limit);
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    period: r.period,
    basicMinor: Number(r.basicMinor),
    empContribPct: r.empContribPct,
    erContribPct: r.erContribPct,
    empContribMinor: Number(r.empContribMinor),
    erContribMinor: Number(r.erContribMinor),
  }));
}
