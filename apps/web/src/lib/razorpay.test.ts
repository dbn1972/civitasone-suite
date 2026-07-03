import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadRazorpayScript } from "./razorpay";

describe("loadRazorpayScript", () => {
  beforeEach(() => {
    // Remove any previously injected script
    const existing = document.getElementById("razorpay-script");
    existing?.remove();
  });

  it("resolves immediately if script already exists", async () => {
    const script = document.createElement("script");
    script.id = "razorpay-script";
    document.head.appendChild(script);
    await expect(loadRazorpayScript()).resolves.toBeUndefined();
  });

  it("appends script tag to head", () => {
    // We can't actually load the script, but we can verify it creates the element
    const promise = loadRazorpayScript();
    const script = document.getElementById("razorpay-script") as HTMLScriptElement;
    expect(script).toBeInTheDocument();
    expect(script.src).toContain("checkout.razorpay.com");
    // Trigger load to resolve promise
    script.onload?.(new Event("load"));
    return promise;
  });

  it("rejects on script error", async () => {
    const promise = loadRazorpayScript();
    const script = document.getElementById("razorpay-script") as HTMLScriptElement;
    script.onerror?.(new Event("error"));
    await expect(promise).rejects.toThrow("Failed to load Razorpay");
  });
});
