import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

// GAP-REVENUE-HOME-01 / GAP-REVENUE-ASSESSEES-DETAIL-02: the /revenue segment
// now has a role + module gate. A signed-in user with no revenue role must get
// "access restricted" on direct URL navigation, not the assessee data.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => [] as string[]) }));

vi.mock("@/lib/auth/roleGuard", () => ({
	getSessionRoles: getSessionRolesMock,
}));

// ModuleGate is an async server component (reads enabled modules); stub it to
// render children so this test isolates the role gate.
vi.mock("../ModuleGate", () => ({
	ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import RevenueLayout from "./layout";

describe("RevenueLayout role gate", () => {
	beforeEach(() => {
		getSessionRolesMock.mockReset();
	});

	it("denies a signed-in user with no revenue role", () => {
		getSessionRolesMock.mockReturnValue(["hr_officer"]);
		render(<RevenueLayout>{<div>secret ledger</div>}</RevenueLayout>);
		expect(screen.queryByText("secret ledger")).not.toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
	});

	it("allows a revenue officer", () => {
		getSessionRolesMock.mockReturnValue(["revenue_officer"]);
		render(<RevenueLayout>{<div>secret ledger</div>}</RevenueLayout>);
		expect(screen.getByText("secret ledger")).toBeInTheDocument();
	});

	it("fails open when roles are unknown (empty)", () => {
		getSessionRolesMock.mockReturnValue([]);
		render(<RevenueLayout>{<div>secret ledger</div>}</RevenueLayout>);
		expect(screen.getByText("secret ledger")).toBeInTheDocument();
	});
});
