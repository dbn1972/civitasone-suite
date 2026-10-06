import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({ requireAnyRole: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import PlatformConfigPage from "./page";

const GOOD = {
  controllable: {
    cacheTtl: { finance: 60 },
    rateLimits: { perMinute: 120, burstMax: 30 },
    logLevel: "info",
    debugModeUntil: null,
    notifications: { emailProvider: "smtp", smsProvider: "none", emailFrom: "a@b.in", smsFrom: "CIV" },
  },
  infrastructure: {
    database: { host: "db-host", port: 5432, databases: 31, poolMode: "direct", maxConnections: 10, rlsEnabled: true },
    redis: { url: "redis://:secret@redis-host:6379", status: "connected" },
    queue: { driver: "sqs", endpoint: "http://sqs:4566", region: "ap-south-1" },
    auth: { provider: "Keycloak", algorithm: "RS256", realm: "civitasone", audienceConfigured: true },
    pgbouncer: { configured: true, port: 6432, poolMode: "transaction", maxClientConn: 500, defaultPoolSize: 20 },
    encryption: { piiAtRest: true, mfaAtRest: false, algorithm: "AES-256-GCM" },
    storage: { driver: "S3", bucket: "civitasone", endpoint: "http://s3:4566" },
  },
};

describe("PlatformConfigPage — GAP-TENANT-ADMIN-PLATFORM-CONFIG-02/-03/-05/-06", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders a retryable error state on load error (-02)", async () => {
    // The page's mapConfig returns null; fetchJson resolves source=error.
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });
    render(await PlatformConfigPage());
    expect(screen.getAllByText(/Platform Configuration/).length).toBeGreaterThan(0);
    // RefreshErrorState renders a Try again control.
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("renders the editors + sanitised endpoints on success (-01/-03/-06)", async () => {
    fetchJsonMock.mockResolvedValue({ data: GOOD, source: "api" });
    render(await PlatformConfigPage());
    // -06: back label matches the breadcrumb term.
    expect(screen.getByText("Tenant Admin")).toBeInTheDocument();
    // -01: TTL editor input present.
    expect(screen.getByLabelText(/Finance cache TTL/i)).toBeInTheDocument();
    // -03: redis credentials are never shown; only host:port.
    expect(screen.queryByText(/:secret@/)).toBeNull();
    expect(screen.getByText("redis-host:6379")).toBeInTheDocument();
    // -05: Yes/No rendered as StatusPill text.
    expect(screen.getAllByText("Yes").length).toBeGreaterThan(0);
  });
});
