"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const textareaStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", resize: "vertical" as const, fontFamily: "inherit", fontSize: 14 } as const;

export default function NewContractorPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    registrationNo: "",
    pan: "",
    gst: "",
    email: "",
    phone: "",
    address: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    const uppercaseFields = ["pan", "gst"];
    setForm((prev) => ({
      ...prev,
      [name]: uppercaseFields.includes(name) ? value.toUpperCase() : value,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
      };
      if (form.registrationNo.trim()) body.registrationNo = form.registrationNo.trim();
      if (form.pan.trim()) body.pan = form.pan.trim();
      if (form.gst.trim()) body.gst = form.gst.trim();
      if (form.email.trim()) body.email = form.email.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.address.trim()) body.address = form.address.trim();

      const res = await fetch("/api/proxy/v1/works/contractors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Create failed");
      setMessage("Registered.");
      toast.success("Contractor registered.");
      setTimeout(() => router.push("/works/contractors"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
      <PageHeader title="Register Contractor" />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
        {error && <div style={errBanner}>{error}</div>}
        {message && <div style={okBanner}>{message}</div>}

        <div>
          <label style={labelStyle} htmlFor="name">Contractor name *</label>
          <input
            id="name"
            name="name"
            style={inputStyle}
            value={form.name}
            onChange={handleChange}
            required
            maxLength={256}
            placeholder="Full legal name of contractor"
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="registrationNo">Registration number</label>
          <input
            id="registrationNo"
            name="registrationNo"
            style={inputStyle}
            value={form.registrationNo}
            onChange={handleChange}
            placeholder="e.g. PWD/A/2024/001"
            maxLength={64}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="pan">PAN</label>
          <input
            id="pan"
            name="pan"
            style={inputStyle}
            value={form.pan}
            onChange={handleChange}
            placeholder="ABCDE1234F"
            maxLength={10}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="gst">GSTIN</label>
          <input
            id="gst"
            name="gst"
            style={inputStyle}
            value={form.gst}
            onChange={handleChange}
            placeholder="29ABCDE1234F1Z5"
            maxLength={15}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            style={inputStyle}
            value={form.email}
            onChange={handleChange}
            placeholder="contractor@example.com"
            maxLength={256}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="phone">Mobile number</label>
          <input
            id="phone"
            name="phone"
            style={inputStyle}
            inputMode="numeric"
            value={form.phone}
            onChange={handleChange}
            placeholder="10-digit mobile number"
            maxLength={20}
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="address">Address</label>
          <textarea
            id="address"
            name="address"
            style={textareaStyle}
            rows={2}
            value={form.address}
            onChange={handleChange}
            maxLength={1024}
            placeholder="Registered office address"
          />
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            onClick={() => router.push("/works/contractors")}
            style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", cursor: "pointer" }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
            disabled={busy}
          >
            {busy ? "Saving…" : "Register Contractor"}
          </button>
        </div>
      </form>
    </div>
  );
}
