import { describe, it, expect } from "vitest";
import {
  CONTACT_TOPICS,
  CONTACT_TOPIC_SOURCE,
  firstInvalidFieldId,
  isValidEmail,
  toPublicLeadBody,
  validateContact,
  type ContactFormInput,
} from "./contactForm";

function base(overrides: Partial<ContactFormInput> = {}): ContactFormInput {
  return {
    name: "Priya Das",
    department: "Revenue Department",
    email: "priya@example.gov.in",
    phone: "+91 98765 43210",
    topic: "sales",
    message: "We would like a demo for our municipality.",
    consent: true,
    ...overrides,
  };
}

describe("validateContact", () => {
  it("accepts a complete, valid submission", () => {
    expect(validateContact(base())).toEqual({});
  });

  it("requires a name", () => {
    expect(validateContact(base({ name: "   " })).name).toBeDefined();
  });

  it("requires a valid email", () => {
    expect(validateContact(base({ email: "" })).email).toBeDefined();
    expect(validateContact(base({ email: "not-an-email" })).email).toBeDefined();
  });

  it("requires a message", () => {
    expect(validateContact(base({ message: "" })).message).toBeDefined();
  });

  it("requires consent (DPDP)", () => {
    expect(validateContact(base({ consent: false })).consent).toBeDefined();
  });

  it("allows a blank phone but rejects a malformed one", () => {
    expect(validateContact(base({ phone: "" })).phone).toBeUndefined();
    expect(validateContact(base({ phone: "12" })).phone).toBeDefined();
  });

  it("rejects an unknown topic", () => {
    expect(validateContact(base({ topic: "nope" as never })).topic).toBeDefined();
  });

  it("caps over-long fields to the crm column bounds", () => {
    expect(validateContact(base({ name: "x".repeat(201) })).name).toBeDefined();
    expect(validateContact(base({ department: "y".repeat(201) })).department).toBeDefined();
  });
});

describe("firstInvalidFieldId", () => {
  it("returns the first invalid field in form order", () => {
    const errors = validateContact(base({ name: "", email: "bad" }));
    expect(firstInvalidFieldId(errors)).toBe("contact-name");
  });

  it("returns null when there are no errors", () => {
    expect(firstInvalidFieldId({})).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(isValidEmail("a@b.in")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("toPublicLeadBody", () => {
  it("maps department->company, topic->source and never sends an unmodelled message key", () => {
    const body = toPublicLeadBody(base({ topic: "security", message: "secret details" }));
    expect(body).toEqual({
      name: "Priya Das",
      email: "priya@example.gov.in",
      consent: true,
      source: CONTACT_TOPIC_SOURCE.security,
      phone: "+91 98765 43210",
      company: "Revenue Department",
    });
    // Strict crm endpoint rejects unknown keys — the message must not be forwarded.
    expect(body).not.toHaveProperty("message");
  });

  it("omits optional phone/company when blank", () => {
    const body = toPublicLeadBody(base({ phone: "  ", department: "" }));
    expect(body).not.toHaveProperty("phone");
    expect(body).not.toHaveProperty("company");
  });

  it("emits a distinct source per topic", () => {
    const sources = CONTACT_TOPICS.map((t) => toPublicLeadBody(base({ topic: t })).source);
    expect(new Set(sources).size).toBe(CONTACT_TOPICS.length);
  });
});
