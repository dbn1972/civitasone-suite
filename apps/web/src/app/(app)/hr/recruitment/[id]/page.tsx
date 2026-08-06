"use client";

/**
 * /hr/recruitment/[id] — the recruitment list links VACANCY (job-opening) ids
 * here, so this page is a vacancy-applications view: it lists the vacancy's
 * applications and offers Hire on selected/offered ones. Deep links that carry
 * an APPLICATION id still work — when no applications match the id as a
 * vacancy, the page falls back to the single-application view.
 */

import { useCallback, useEffect, useId, useState } from "react";
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

const HIREABLE_STAGES = new Set(["selected", "offered"]);

export default function RecruitmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [applications, setApplications] = useState<Application[] | null>(null);
  const [single, setSingle] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hire dialog state
  const [hireTarget, setHireTarget] = useState<Application | null>(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The id is normally a vacancy id — list its applications.
      const listRes = await fetch(`/api/proxy/v1/hrms/applications?jobOpeningId=${encodeURIComponent(id)}`);
      if (listRes.ok) {
        const json = (await listRes.json()) as { data?: Application[] };
        const rows = Array.isArray(json.data) ? json.data : [];
        if (rows.length > 0) {
          setApplications(rows);
          setSingle(null);
          return;
        }
      }
      // Fallback: a deep link straight to one application.
      const oneRes = await fetch(`/api/proxy/v1/hrms/applications/${encodeURIComponent(id)}`);
      if (oneRes.ok) {
        const data = await oneRes.json();
        setSingle((data.payload ?? data) as Application);
        setApplications(null);
        return;
      }
      if (listRes.ok) {
        // Valid vacancy, no applications yet.
        setApplications([]);
        setSingle(null);
        return;
      }
      setError(listRes.status === 404 || oneRes.status === 404 ? "Vacancy or application not found." : `Failed to load (${listRes.status})`);
    } catch {
      setError("Network error loading applications.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function openHire(app: Application) {
    setHireTarget(app);
    setHireStatus("idle");
    setHireMessage("");
  }

  async function handleHire(e: React.FormEvent) {
    e.preventDefault();
    if (!hireTarget) return;
    if (!employeeNo.trim() || !dateOfJoining || !departmentId.trim() || !designationId.trim()) {
      setHireStatus("error");
      setHireMessage("All fields are required.");
      return;
    }

    setHireStatus("submitting");
    setHireMessage("");

    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${hireTarget.id}/hire`, {
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
      setHireMessage(`Hire initiated for ${hireTarget.applicantName}. Employee record is being created.`);
      setHireTarget(null);
      await load();
      router.refresh();
    } catch (err) {
      setHireStatus("error");
      setHireMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  if (loading) {
    return (
      <main className="page-main" aria-labelledby="page-heading">
        <p className="text-center text-slate-500 py-12">Loading applications…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-main" aria-labelledby="page-heading">
        <div className="mb-4">
          <button onClick={() => router.back()} className="text-sm text-indigo-600 hover:underline">
            ← Back to Recruitment
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-center text-slate-400">{error}</p>
        </div>
      </main>
    );
  }

  const rows = single ? [single] : applications ?? [];

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-indigo-600 hover:underline">
          ← Back to Recruitment
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 id="page-heading" className="text-xl font-bold text-slate-800 mb-4">
          {single ? single.applicantName : "Applications"}
        </h1>

        {rows.length === 0 ? (
          <p className="text-center text-slate-400 py-8">
            No applications received for this vacancy yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Applicant</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Stage</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium text-slate-800">{a.applicantName}</td>
                  <td className="py-2 pr-4 text-slate-600">{a.email ?? "—"}</td>
                  <td className="py-2 pr-4 capitalize">{a.stage}</td>
                  <td className="py-2 pr-4 capitalize">{a.status}</td>
                  <td className="py-2 text-right">
                    {HIREABLE_STAGES.has(a.stage) && (
                      <button
                        onClick={() => openHire(a)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        Hire
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
      {hireTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hire-dialog-title"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 mx-4">
            <h2 id="hire-dialog-title" className="text-lg font-bold text-slate-800 mb-4">
              Hire — {hireTarget.applicantName}
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
                  onClick={() => setHireTarget(null)}
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
