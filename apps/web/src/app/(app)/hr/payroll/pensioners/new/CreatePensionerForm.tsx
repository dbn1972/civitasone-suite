"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function CreatePensionerForm() {
  const router = useRouter();

  const [ppoNo, setPpoNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [basicPension, setBasicPension] = useState("");
  const [commutedPension, setCommutedPension] = useState("");
  const [commutationDate, setCommutationDate] = useState("");
  const [medicalAllowance, setMedicalAllowance] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [pan, setPan] = useState("");
  const [taxRegime, setTaxRegime] = useState<"old" | "new">("new");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const ppoFieldId = useId();
  const nameFieldId = useId();
  const dobFieldId = useId();
  const basicFieldId = useId();
  const commutedFieldId = useId();
  const commDateFieldId = useId();
  const medFieldId = useId();
  const ddoFieldId = useId();
  const bankAccFieldId = useId();
  const ifscFieldId = useId();
  const panFieldId = useId();
  const taxRegimeId = useId();
  const statusMsgId = useId();

  function toMinorUnits(rupees: string): number {
    const val = parseFloat(rupees);
    if (Number.isNaN(val)) return 0;
    return Math.round(val * 100);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!ppoNo.trim() || !fullName.trim() || !dateOfBirth) {
      setStatus("error");
      setMessage("PPO Number, Full Name, and Date of Birth are required.");
      return;
    }

    if (pan.trim() && !PAN_REGEX.test(pan.trim().toUpperCase())) {
      setStatus("error");
      setMessage("PAN must be in valid format (e.g. ABCDE1234F).");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/payroll/pensioners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ppoNo: ppoNo.trim(),
          fullName: fullName.trim(),
          dateOfBirth,
          basicPensionMinor: toMinorUnits(basicPension),
          commutedPensionMinor: commutedPension ? toMinorUnits(commutedPension) : 0,
          commutationDate: commutationDate || undefined,
          medicalAllowanceMinor: medicalAllowance ? toMinorUnits(medicalAllowance) : 0,
          ddoCode: ddoCode.trim() || undefined,
          bankAccountNo: bankAccountNo.trim() || undefined,
          bankIfsc: bankIfsc.trim() || undefined,
          pan: pan.trim().toUpperCase() || undefined,
          taxRegime,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }

      setStatus("success");
      setMessage("Pensioner created successfully.");
      router.push("/hr/payroll/pensioners");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-2xl"
    >
      <div>
        <label htmlFor={ppoFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          PPO Number
        </label>
        <input
          id={ppoFieldId}
          type="text"
          value={ppoNo}
          onChange={(e) => setPpoNo(e.target.value)}
          placeholder="e.g. PPO/2025/001234"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
        />
      </div>

      <div>
        <label htmlFor={nameFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Full Name
        </label>
        <input
          id={nameFieldId}
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Ramesh Kumar Sharma"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
        />
      </div>

      <div>
        <label htmlFor={dobFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Date of Birth
        </label>
        <input
          id={dobFieldId}
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
        />
      </div>

      <div>
        <label htmlFor={basicFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Basic Pension (₹)
        </label>
        <input
          id={basicFieldId}
          type="number"
          min="0"
          step="0.01"
          value={basicPension}
          onChange={(e) => setBasicPension(e.target.value)}
          placeholder="e.g. 25000"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={commutedFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Commuted Pension (₹, optional)
        </label>
        <input
          id={commutedFieldId}
          type="number"
          min="0"
          step="0.01"
          value={commutedPension}
          onChange={(e) => setCommutedPension(e.target.value)}
          placeholder="e.g. 5000"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={commDateFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Commutation Date (optional)
        </label>
        <input
          id={commDateFieldId}
          type="date"
          value={commutationDate}
          onChange={(e) => setCommutationDate(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={medFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Medical Allowance (₹, optional)
        </label>
        <input
          id={medFieldId}
          type="number"
          min="0"
          step="0.01"
          value={medicalAllowance}
          onChange={(e) => setMedicalAllowance(e.target.value)}
          placeholder="e.g. 1000"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={ddoFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          DDO Code (optional)
        </label>
        <input
          id={ddoFieldId}
          type="text"
          value={ddoCode}
          onChange={(e) => setDdoCode(e.target.value)}
          placeholder="e.g. DDO-FIN-001"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={bankAccFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Bank Account No (optional)
        </label>
        <input
          id={bankAccFieldId}
          type="text"
          value={bankAccountNo}
          onChange={(e) => setBankAccountNo(e.target.value)}
          placeholder="e.g. 1234567890"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={ifscFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          Bank IFSC (optional)
        </label>
        <input
          id={ifscFieldId}
          type="text"
          value={bankIfsc}
          onChange={(e) => setBankIfsc(e.target.value)}
          placeholder="e.g. SBIN0001234"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={panFieldId} className="block text-sm font-medium text-slate-700 mb-1">
          PAN (optional)
        </label>
        <input
          id={panFieldId}
          type="text"
          value={pan}
          onChange={(e) => setPan(e.target.value)}
          placeholder="e.g. ABCDE1234F"
          maxLength={10}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium text-slate-700 mb-1">Tax Regime</legend>
        <div className="flex gap-6" id={taxRegimeId}>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="taxRegime"
              value="old"
              checked={taxRegime === "old"}
              onChange={() => setTaxRegime("old")}
              className="accent-indigo-600"
            />
            Old Regime
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="taxRegime"
              value="new"
              checked={taxRegime === "new"}
              onChange={() => setTaxRegime("new")}
              className="accent-indigo-600"
            />
            New Regime
          </label>
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {status === "submitting" ? "Creating…" : "Create Pensioner"}
      </button>

      {message && (
        <p
          id={statusMsgId}
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          className={`text-sm ${status === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          <span className="font-semibold">{status === "error" ? "Error: " : "Success: "}</span>
          {message}
        </p>
      )}
    </form>
  );
}
