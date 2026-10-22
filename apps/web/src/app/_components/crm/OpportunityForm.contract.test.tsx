import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { OpportunityForm } from "./OpportunityForm";
import { normaliseOpportunity } from "@/lib/crm/opportunity";
// The REAL crm-service validators. The web app cannot depend on the service package, so this test reaches
// the source file directly: it is the only way to prove that what the form puts on the wire is accepted.
import { createDealBody, updateDealBody } from "../../../../../../services/crm-service/src/modules/deals/validators";

/**
 * GAP-CRM-OPPORTUNITIES-NEW-02 / -NEW-06 end to end at the HTTP edge: render the real form, let the real
 * createOpportunity / updateOpportunity build the request, capture the exact JSON body that would reach the
 * network and run it through crm-service's own zod schemas (POST /v1/crm/deals -> createDealBody,
 * PATCH /v1/crm/deals/:id -> updateDealBody). Nothing between the form and the fetch is mocked, so a body the
 * service would answer 400 fails here.
 */

const PIPELINE_ID = "11111111-1111-4111-8111-111111111111";
const STAGE_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const DEAL_ID = "44444444-4444-4444-8444-444444444444";

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function serve() {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api\/proxy\//, "");
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({ method, path, body: JSON.parse(String(init?.body)) });
      return reply({ id: DEAL_ID, status: "accepted" }, 202);
    }
    if (path.startsWith("v1/crm/pipelines")) {
      return reply({
        data: [{ id: PIPELINE_ID, name: "Enterprise", enabled: true, stages: [{ id: STAGE_ID, name: "Qualify", mandatoryFields: [] }] }],
      });
    }
    if (path.startsWith("v1/crm/accounts")) return reply({ data: [{ id: ACCOUNT_ID, name: "Acme Corp" }], meta: { total: 1 } });
    return reply({});
  });
  return sent;
}

afterEach(() => vi.restoreAllMocks());

const field = (label: string | RegExp) => screen.getByLabelText(label);

describe("OpportunityForm -> POST /v1/crm/deals (createDealBody)", () => {
  it("premise: the blanks the form used to send are a 400 for the real validator", () => {
    const old = { name: "x", pipelineId: PIPELINE_ID, stage: "Qualify", valueMinor: "0", product: "", nextStep: "", expectedCloseDate: "" };
    const result = createDealBody.safeParse(old);
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["product", "expectedCloseDate"]));
  });

  it("a form with only a name filled in sends a body the service accepts, with nothing blank and no invented 0%", async () => {
    const sent = serve();
    renderWithIntl(<OpportunityForm />);
    await waitFor(() => expect(field(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(field(/opportunity name/i), { target: { value: "State datacentre refresh" } });
    await waitFor(() => expect((field("Stage") as HTMLSelectElement).value).toBe("qualify"));
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toMatchObject({ method: "POST", path: "v1/crm/deals" });
    const raw = sent[0]!.body as Record<string, unknown>;
    const parsed = createDealBody.parse(raw);
    expect(parsed).toMatchObject({ name: "State datacentre refresh", pipelineId: PIPELINE_ID, stage: "Qualify", stageId: STAGE_ID, valueMinor: "0" });
    // optional fields left untouched are absent from the wire body, never "" (NEW-06: nor a 0 probability / quantity)
    for (const key of ["product", "nextStep", "expectedCloseDate", "probability", "quantity", "competitors", "accountId"]) {
      expect(raw).not.toHaveProperty(key);
    }
  });

  it("a fully filled form sends every value to the service exactly, money as exact paise", async () => {
    const sent = serve();
    renderWithIntl(<OpportunityForm />);
    await waitFor(() => expect(field(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(field(/opportunity name/i), { target: { value: "Acme renewal" } });
    await waitFor(() => expect((field("Stage") as HTMLSelectElement).value).toBe("qualify"));
    fireEvent.change(field("Account"), { target: { value: "Acme" } });
    fireEvent.mouseDown(await screen.findByText("Acme Corp"));
    fireEvent.change(field(/deal value in rupees/i), { target: { value: "1500.50" } });
    fireEvent.change(field(/probability percent/i), { target: { value: "40" } });
    fireEvent.change(field("Quantity"), { target: { value: "12" } });
    fireEvent.change(field("Product"), { target: { value: " Server racks " } });
    fireEvent.change(field("Competitors"), { target: { value: "Acme, Globex" } });
    fireEvent.change(field("Next step"), { target: { value: "Send quotation" } });
    fireEvent.change(field("Expected close date"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(createDealBody.parse(sent[0]!.body)).toMatchObject({
      name: "Acme renewal",
      accountId: ACCOUNT_ID,
      valueMinor: "150050",
      probability: 40,
      quantity: 12,
      product: "Server racks",
      competitors: ["Acme", "Globex"],
      nextStep: "Send quotation",
      expectedCloseDate: "2026-12-31",
    });
  });
});

describe("OpportunityForm -> PATCH /v1/crm/deals/:id (updateDealBody)", () => {
  const deal = (over: Record<string, unknown> = {}) =>
    normaliseOpportunity({
      id: DEAL_ID,
      name: "Existing deal",
      pipelineId: PIPELINE_ID,
      stage: "Qualify",
      valueMinor: "150050",
      product: "",
      quantity: 3,
      competitors: [],
      nextStep: "",
      expectedCloseDate: "",
      ...over,
    })!;

  it("premise: a string value and blank text are a 400 for the real validator", () => {
    const result = updateDealBody.safeParse({ valueMinor: "150050", product: "", expectedCloseDate: "" });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["valueMinor", "product", "expectedCloseDate"]));
  });

  it("saving an untouched deal sends a body the service accepts (number value, cleared text as null)", async () => {
    const sent = serve();
    renderWithIntl(<OpportunityForm opportunity={deal()} />);
    await waitFor(() => expect(field(/opportunity name/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save opportunity/i }));
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toMatchObject({ method: "PATCH", path: `v1/crm/deals/${DEAL_ID}` });
    const raw = sent[0]!.body as Record<string, unknown>;
    expect(typeof raw.valueMinor).toBe("number");
    expect(updateDealBody.parse(raw)).toMatchObject({
      valueMinor: 150050,
      product: null,
      quantity: 3,
      nextStep: null,
      expectedCloseDate: null,
      competitors: [],
    });
  });

  it("edited values and the account link reach the service, and a cleared field is sent as null", async () => {
    const sent = serve();
    renderWithIntl(<OpportunityForm opportunity={deal({ accountId: ACCOUNT_ID, product: "Racks", nextStep: "Call" })} />);
    await waitFor(() => expect(field(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(field(/deal value in rupees/i), { target: { value: "2000" } });
    fireEvent.change(field("Product"), { target: { value: "" } });
    fireEvent.change(field("Next step"), { target: { value: "Visit site" } });
    fireEvent.change(field("Expected close date"), { target: { value: "2027-01-15" } });
    fireEvent.click(screen.getByRole("button", { name: /save opportunity/i }));
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(updateDealBody.parse(sent[0]!.body)).toMatchObject({
      valueMinor: 200000,
      accountId: ACCOUNT_ID,
      product: null,
      nextStep: "Visit site",
      expectedCloseDate: "2027-01-15",
    });
  });

  it("a zero-value deal stays saveable", async () => {
    const sent = serve();
    renderWithIntl(<OpportunityForm opportunity={deal({ valueMinor: "0" })} />);
    await waitFor(() => expect(field(/opportunity name/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save opportunity/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(updateDealBody.parse(sent[0]!.body).valueMinor).toBe(0);
  });

  it("refuses a value that would not survive as a JSON number instead of sending a rounded amount", async () => {
    const sent = serve();
    renderWithIntl(<OpportunityForm opportunity={deal()} />);
    await waitFor(() => expect(field(/opportunity name/i)).toBeInTheDocument());
    // 9,007,199,254,740,993 paise is one past Number.MAX_SAFE_INTEGER: rupees 90071992547409.93
    fireEvent.change(field(/deal value in rupees/i), { target: { value: "90071992547409.93" } });
    fireEvent.click(screen.getByRole("button", { name: /save opportunity/i }));
    expect(await screen.findByText(/too large to save/i)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });
});
