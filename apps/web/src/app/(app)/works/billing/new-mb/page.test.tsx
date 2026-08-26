import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewMbPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";

describe("Issue Measurement Book form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("prefills the Work ID from the ?workId passed by the billing detail page", () => {
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    expect(screen.getByPlaceholderText("UUID of the work")).toHaveValue(WORK);
  });

  it("leaves Work ID empty when no param is supplied (tenant-wide entry point)", () => {
    render(<NewMbPage />);
    expect(screen.getByPlaceholderText("UUID of the work")).toHaveValue("");
  });
});
