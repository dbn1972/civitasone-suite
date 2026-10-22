"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The tenant's own DPO address (tenant settings `dpoEmail`), resolved on the
 * server by the route layout and handed to the client form. null = the tenant
 * has not configured one, so getDpoEmail() falls back to the deploy-wide value.
 */
const DpoEmailContext = createContext<string | null>(null);

export function DpoEmailProvider({ value, children }: { value: string | null; children: ReactNode }) {
  return <DpoEmailContext.Provider value={value}>{children}</DpoEmailContext.Provider>;
}

export function useTenantDpoEmail(): string | null {
  return useContext(DpoEmailContext);
}
