"use client";

import { useEffect, useId, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Application = {
  id: string;
  applicantName: string;
  email?: string;
  mobile?: string;
  stage: string;
  status: string;
  jobOpeningId: string;
};

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hire dialog state
  const [showHireDialog, setShowHireDialog] = useState(false);
  const [employeeNo, setEmployeeNo] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [basicMinor, setBasicMinor] = useState(0);
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [employeeType, setEmployeeType] = useState<"permanent" | "temporary" | "contract" | "deputation">("permanent");
  const [hireStatus, setHireStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [hireMessage, setHireMessage] = useState("");

  const empNoId = useId();
  const dojId = useId();
  const basicId = useId();
  const deptId = useId();
  const desigId = useId();
  const typeId = useId();
  const statusMsgId = useId();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/proxy/v1/hrms/applications/${id}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Application not found." : `Failed to load (${res.status})`);
          return;
        }
        const data = await res.json();
        setApplication(data.payload ?? data);
      } catch {
        setError("Network error loading application.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleHire(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeNo.trim() || !dateOfJoining || !departmentId.trim() || !designationId.trim()) {
      setHireStatus("error");
      setHireMessage("All fields are required.");
      return;
    }

    setHireStatus("submitting");
    setHireMessage("");

    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${id}/hire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeNo: employeeNo.trim(),
          dateOfJoining,
          basicMinor,
          departmentId: departmentId.trim(),
          designationId: designationId.trim(),
          employeeType,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        setHireStatus("error");
        setHireMessage(text || `Request failed (${res.status})`);
        return;
      }

      setHireStatus("success");
      setHireMessage("Hire initiated successfully. Employee record is being created.");
      setShowHireDialog(false);
      router.refresh();
    } catch (err) {
      setHireStatus("error");
      setHireMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  if (loading) {
    return (
      <main className="page-main" aria-labelledby="page-heading">
        <p className="text-center text-slate-500 py-12">Loading application…</p>
      </main>
    );
  }

  if (error || !application) {
    return (
      <main className="page-main" aria-labelledby="page-heading">
        <div className="mb-4">
          <button onClick={() => router.back()} className="text-sm text-indigo-600 hover:underline">
            ← Back to Recruitment
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-center text-slate-400">{error ?? "Application not found."}</p>
        </div>
      </main>
    );
  }

  const canHire = application.stage === "selected" || application.stage === "offered";

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-indigo-600 hover:underline">
          ← Back to Recruitment
        </button>
        {canHire && (
          <button
            onClick={() => setShowHireDialog(true)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Hire
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-w-3xl">
        <h1 id="page-heading" className="text-xl font-bold text-slate-800 mb-4">
          {application.applicantName}
        </h1>
        <div className="fields">
          <div className="field">
            <span className="lbl">Application ID</span>
            <span className="val font-mono text-sm">{application.id}</span>
          </div>
          <div className="field">
            <span className="lbl">Stage</span>
            <span className="val capitalize">{application.stage}</span>
          </div>
          <div className="field">
            <span className="lbl">Status</span>
            <span className="val capitalize">{application.status}</span>
          </div>
          {application.email && (
            <div className="field">
              <span className="lbl">Email</span>
              <span className="val">{application.email}</span>
            </div>
          )}
          {application.mobile && (
            <div className="field">
              <span className="lbl">Mobile</span>
              <span className="val">{application.mobile}</span>
            </div>
          )}
        </div>
      </div>

      {hireStatus === "success" && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3"
        >
          <span className="font-semibold">Success: </span>{hireMessage}
        </p>
      )}

      {/* Hire Dialog */}
      {showHireDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hire-dialog-title"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 mx-4">
            <h2 id="hire-dialog-title" className="text-lg font-bold text-slate-800 mb-4">
              Hire — {application.applicantName}
            </h2>
            <form onSubmit={handleHire} className="space-y-4">
              <div>
                <label htmlFor={empNoId} className="block text-sm font-medium text-slate-700 mb-1">
                  Employee No
                </label>
                <input
                  id={empNoId}
                  type="text"
                  value={employeeNo}
                  onChange={(e) => setEmployeeNo(e.target.value)}
                  placeholder="e.g. EMP-2024-001"
                  maxLength={32}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label htmlFor={dojId} className="block text-sm font-medium text-slate-700 mb-1">
                  Date of Joining
                </label>
                <input
                  id={dojId}
                  type="date"
                  value={dateOfJoining}
                  onChange={(e) => setDateOfJoining(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label htmlFor={basicId} className="block text-sm font-medium text-slate-700 mb-1">
                  Basic Pay (in minor units, e.g. paise)
                </label>
                <input
                  id={basicId}
                  type="number"
                  min={0}
                  value={basicMinor}
                  onChange={(e) => setBasicMinor(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label htmlFor={deptId} className="block text-sm font-medium text-slate-700 mb-1">
                  Department ID
                </label>
                <input
                  id={deptId}
                  type="text"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  placeholder="UUID of department"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label htmlFor={desigId} className="block text-sm font-medium text-slate-700 mb-1">
                  Designation ID
                </label>
                <input
                  id={desigId}
                  type="text"
                  value={designationId}
                  onChange={(e) => setDesignationId(e.target.value)}
                  placeholder="UUID of designation"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label htmlFor={typeId} className="block text-sm font-medium text-slate-700 mb-1">
                  Employee Type
                </label>
                <select
                  id={typeId}
                  value={employeeType}
                  onChange={(e) => setEmployeeType(e.target.value as typeof employeeType)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="permanent">Permanent</option>
                  <option value="temporary">Temporary</option>
                  <option value="contract">Contract</option>
                  <option value="deputation">Deputation</option>
                </select>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={hireStatus === "submitting"}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {hireStatus === "submitting" ? "Processing…" : "Confirm Hire"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowHireDialog(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>

              {hireMessage && hireStatus === "error" && (
                <p
                  id={statusMsgId}
                  role="alert"
                  aria-live="assertive"
                  className="text-sm text-red-600"
                >
                  <span className="font-semibold">Error: </span>{hireMessage}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
