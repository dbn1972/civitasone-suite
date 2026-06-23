"use client";

import { useEffect, useState } from "react";

type Policy = {
  id: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  employeeType: string;
  maxDaysPerYear: number;
  carryForward: boolean;
  maxAccumulation: number;
  encashable: boolean;
  countMethod: string;
  maxContinuousDays: number;
  minServiceMonths: number;
  genderRestriction: string | null;
  requiresMedicalCert: boolean;
  requiresMedicalCertAfterDays: number;
  prefixSuffixRule: boolean;
  sandwichRule: boolean;
  proRataOnJoining: boolean;
  isActive: boolean;
};

const EMPLOYEE_TYPES = ["permanent", "contractual", "vendor_deputed", "deputation", "consultant"];
const BADGE_COLORS: Record<string, string> = {
  permanent: "bg-blue-100 text-blue-800",
  contractual: "bg-amber-100 text-amber-800",
  vendor_deputed: "bg-purple-100 text-purple-800",
  deputation: "bg-green-100 text-green-800",
  consultant: "bg-gray-100 text-gray-800",
};

export default function LeavePoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<Policy>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function fetchPolicies() {
    setLoading(true);
    const url = filter === "all"
      ? "/api/proxy/v1/hrms/admin/leave-policies"
      : `/api/proxy/v1/hrms/admin/leave-policies?employeeType=${filter}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setPolicies(data.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { fetchPolicies(); }, [filter]);

  function startEdit(p: Policy) {
    setEditId(p.id);
    setEditValues({
      maxDaysPerYear: p.maxDaysPerYear,
      carryForward: p.carryForward,
      maxAccumulation: p.maxAccumulation,
      encashable: p.encashable,
      countMethod: p.countMethod,
      maxContinuousDays: p.maxContinuousDays,
      minServiceMonths: p.minServiceMonths,
      requiresMedicalCert: p.requiresMedicalCert,
      requiresMedicalCertAfterDays: p.requiresMedicalCertAfterDays,
      prefixSuffixRule: p.prefixSuffixRule,
      sandwichRule: p.sandwichRule,
      proRataOnJoining: p.proRataOnJoining,
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setSaving(true);
    const res = await fetch(`/api/proxy/v1/hrms/admin/leave-policies/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editValues),
    });
    setSaving(false);
    if (res.ok) {
      setMessage("✅ Policy updated successfully");
      setEditId(null);
      fetchPolicies();
    } else {
      setMessage("❌ Failed to update");
    }
    setTimeout(() => setMessage(null), 3000);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Leave Policy Configuration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure leave entitlements for each employee type. Changes take effect immediately.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filter === "all" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
        >
          All Types
        </button>
        {EMPLOYEE_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition ${filter === t ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {t.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Message */}
      {message && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
          {message}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading policies...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Employee Type</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Leave Type</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Days/Year</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Max Continuous</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Carry Fwd</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Encashable</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Count Method</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Med Cert</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Sandwich</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Min Service</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {policies.map((p) => (
                <tr key={p.id} className={`hover:bg-gray-50 ${editId === p.id ? "bg-indigo-50" : ""}`}>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${BADGE_COLORS[p.employeeType] ?? "bg-gray-100"}`}>
                      {p.employeeType.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <span className="text-xs text-gray-400 mr-1">{p.leaveTypeCode}</span>
                    {p.leaveTypeName}
                  </td>

                  {/* Editable cells */}
                  {editId === p.id ? (
                    <>
                      <td className="px-2 py-2 text-center">
                        <input type="number" className="w-16 border rounded px-2 py-1 text-center text-sm" value={editValues.maxDaysPerYear ?? 0} onChange={(e) => setEditValues({ ...editValues, maxDaysPerYear: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="number" className="w-16 border rounded px-2 py-1 text-center text-sm" value={editValues.maxContinuousDays ?? 0} onChange={(e) => setEditValues({ ...editValues, maxContinuousDays: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" checked={editValues.carryForward ?? false} onChange={(e) => setEditValues({ ...editValues, carryForward: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" checked={editValues.encashable ?? false} onChange={(e) => setEditValues({ ...editValues, encashable: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <select className="border rounded px-1 py-1 text-xs" value={editValues.countMethod ?? "calendar"} onChange={(e) => setEditValues({ ...editValues, countMethod: e.target.value })}>
                          <option value="calendar">Calendar</option>
                          <option value="working_days">Working Days</option>
                        </select>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" checked={editValues.requiresMedicalCert ?? false} onChange={(e) => setEditValues({ ...editValues, requiresMedicalCert: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="checkbox" checked={editValues.sandwichRule ?? false} onChange={(e) => setEditValues({ ...editValues, sandwichRule: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input type="number" className="w-14 border rounded px-1 py-1 text-center text-xs" value={editValues.minServiceMonths ?? 0} onChange={(e) => setEditValues({ ...editValues, minServiceMonths: Number(e.target.value) })} /> <span className="text-xs text-gray-400">mo</span>
                      </td>
                      <td className="px-2 py-2 text-center space-x-1">
                        <button onClick={saveEdit} disabled={saving} className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50">
                          {saving ? "..." : "Save"}
                        </button>
                        <button onClick={() => setEditId(null)} className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-center font-semibold text-indigo-700">{p.maxDaysPerYear}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{p.maxContinuousDays}d</td>
                      <td className="px-4 py-3 text-center">{p.carryForward ? "✓" : "—"}</td>
                      <td className="px-4 py-3 text-center">{p.encashable ? "💰" : "—"}</td>
                      <td className="px-4 py-3 text-center text-xs">{p.countMethod === "working_days" ? "Working" : "Calendar"}</td>
                      <td className="px-4 py-3 text-center">{p.requiresMedicalCert ? `⚕️ >${p.requiresMedicalCertAfterDays}d` : "—"}</td>
                      <td className="px-4 py-3 text-center">{p.sandwichRule ? "✓" : "—"}</td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">{p.minServiceMonths > 0 ? `${p.minServiceMonths}mo` : "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => startEdit(p)} className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200 font-medium">
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg border text-xs text-gray-500">
        <span className="font-semibold text-gray-700">Legend:</span>{" "}
        ✓ = Yes | — = No | 💰 = Encashable | ⚕️ = Medical certificate required |
        Working = excludes weekends + holidays | Calendar = all days counted
      </div>
    </div>
  );
}
