import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { resetSessionIdentityCache } from "@/lib/auth/useSessionIdentity";
import { OfferWorkflowDialog } from "./OfferWorkflowDialog";

const CHAIN = [{ stage: "HR", role: "hr_admin" }, { stage: "Finance", role: "finance_officer" }];
const offer = (over: Record<string, unknown> = {}) => ({
  id: "o-1", offerNo: "OFR-0001", offerVersion: 1, status: "draft", basicMinor: "5610000", joiningBonusMinor: "0", relocationMinor: "0", variablePayMinor: "0",
  grossCtcMinor: "5610000", grade: null, payLevel: "10", payCell: 3, joiningDate: null, approvalChain: CHAIN, currentStage: -1, createdBy: "maker-1", ...over,
});

type Routes = { offers: unknown[]; session?: { userId: string; roles: string[] }; post?: (url: string, body: unknown) => Response };
function stub({ offers, session = { userId: "maker-1", roles: ["hr_officer"] }, post }: Routes) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u === "/api/auth/session") return new Response(JSON.stringify({ authenticated: true, ...session }), { status: 200 });
    if (u.endsWith("/offers") && method === "GET") return new Response(JSON.stringify({ data: offers }), { status: 200 });
    if (u.includes("/pay-matrix/lookup")) return new Response(JSON.stringify({ basicMinor: "5610050" }), { status: 200 });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    return post ? post(u, body) : new Response(JSON.stringify({}), { status: 200 });
  }));
  return calls;
}

function renderDialog() {
  const onChanged = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OfferWorkflowDialog applicationId="app-1" applicantName="Meera Iyer" onClose={vi.fn()} onChanged={onChanged} />
    </NextIntlClientProvider>,
  );
  return onChanged;
}

beforeEach(() => resetSessionIdentityCache());
afterEach(() => vi.unstubAllGlobals());

describe("OfferWorkflowDialog", () => {
  it("a draft offer made by the signed-in HR user can be submitted for approval", async () => {
    const calls = stub({ offers: [offer()] });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/proxy/v1/hrms/offers/o-1/submit" && c.method === "POST")).toBe(true));
    expect(await screen.findByText("Submitted for approval.")).toBeInTheDocument();
  });

  it("the creator sees no Approve button, only a maker-checker hint", async () => {
    stub({ offers: [offer({ status: "pending_approval", currentStage: 1 })], session: { userId: "maker-1", roles: ["finance_officer"] } });
    renderDialog();
    expect(await screen.findByText(/you created this offer, so another approver must approve it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting finance approval/i)).toBeInTheDocument();
  });

  it("an independent approver with the stage role can approve with comments", async () => {
    const calls = stub({ offers: [offer({ status: "pending_approval", currentStage: 1 })], session: { userId: "checker-9", roles: ["finance_officer"] } });
    renderDialog();
    fireEvent.change(await screen.findByLabelText("Comments"), { target: { value: "ok within grade" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/offers/o-1/approve"))?.body).toEqual({ comments: "ok within grade" }));
  });

  it("a user without the stage role is told which role is needed", async () => {
    stub({ offers: [offer({ status: "pending_approval", currentStage: 1 })], session: { userId: "checker-9", roles: ["hr_officer"] } });
    renderDialog();
    expect(await screen.findByText(/needs the finance_officer role to approve/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("returning for correction needs a comment", async () => {
    const calls = stub({ offers: [offer({ status: "pending_approval", currentStage: 0 })], session: { userId: "checker-9", roles: ["hr_admin"] } });
    renderDialog();
    const ret = await screen.findByRole("button", { name: "Return for correction" });
    expect(ret).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Comments"), { target: { value: "basic exceeds level 10 cell 3" } });
    expect(ret).not.toBeDisabled();
    fireEvent.click(ret);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/return"))?.body).toEqual({ comments: "basic exceeds level 10 cell 3" }));
  });

  it("an approved offer can be released, and the service's maker-checker refusal is shown in plain words", async () => {
    stub({
      offers: [offer({ status: "approved", currentStage: 1 })],
      post: () => new Response(JSON.stringify({ code: "SOD_VIOLATION" }), { status: 409 }),
    });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Release to candidate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot approve an offer you created/i);
  });

  it("looks up the pay-matrix basic for a level and cell and fills the field in rupees", async () => {
    stub({ offers: [] });
    renderDialog();
    fireEvent.change(await screen.findByLabelText(/pay level/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^cell/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Use pay-matrix basic" }));
    await waitFor(() => expect(screen.getByLabelText(/basic pay/i)).toHaveValue("56100.50"));
  });

  it("only a live offer blocks creating a new draft: a declined version allows one", async () => {
    stub({ offers: [offer({ status: "declined" })] });
    renderDialog();
    expect(await screen.findByRole("button", { name: "Create draft offer" })).toBeInTheDocument();
  });

  it("rejects a pay level without a cell before any request", async () => {
    const calls = stub({ offers: [] });
    renderDialog();
    fireEvent.change(await screen.findByLabelText(/pay level/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/basic pay/i), { target: { value: "56100" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft offer" }));
    expect(await screen.findByText(/pay level \(1–18\) and a cell \(1–40\) together/i)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
