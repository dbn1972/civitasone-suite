"use client";

import { useState } from "react";
import Link from "next/link";

export default function NewFilePage() {
  const [subject, setSubject] = useState("");
  const [classification, setClassification] = useState("unclassified");
  const [department, setDepartment] = useState("");
  const [tags, setTags] = useState("");
  const [initialNote, setInitialNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        subject,
        classification,
        department: department || undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        initialNote: initialNote || undefined,
      };
      const res = await fetch("/api/proxy/v1/estab/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        const body = await res.json().catch(() => ({})) as { fileNo?: string };
        setToast({ type: "success", message: `File created${body.fileNo ? `: ${body.fileNo}` : ""}.` });
        setSubject("");
        setDepartment("");
        setTags("");
        setInitialNote("");
        setClassification("unclassified");
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setToast({ type: "error", message: body.message ?? `Error ${res.status}` });
      }
    } catch {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-2xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <Link href="/estab/list" className="hover:text-slate-900">Files</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">New File</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Create File</h1>
          <p className="mt-1 text-sm text-slate-600">Opens a new eOffice digital file with an initial note.</p>
        </header>

        {toast && (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            {toast.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-slate-700">
                Subject <span className="text-red-500">*</span>
              </label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief subject of the file"
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="classification" className="block text-sm font-medium text-slate-700">Classification</label>
              <select
                id="classification"
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="unclassified">Unclassified</option>
                <option value="restricted">Restricted</option>
                <option value="confidential">Confidential</option>
                <option value="secret">Secret</option>
                <option value="top_secret">Top Secret</option>
              </select>
            </div>

            <div>
              <label htmlFor="department" className="block text-sm font-medium text-slate-700">Department</label>
              <input
                id="department"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Finance, IT, HR"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="tags" className="block text-sm font-medium text-slate-700">Tags</label>
              <input
                id="tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma-separated tags, e.g. procurement, urgent"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="initialNote" className="block text-sm font-medium text-slate-700">Initial Note</label>
              <textarea
                id="initialNote"
                value={initialNote}
                onChange={(e) => setInitialNote(e.target.value)}
                rows={4}
                placeholder="Opening note or context for this file"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-6 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create File"}
            </button>
            <Link
              href="/estab/list"
              className="rounded-md border border-slate-300 px-6 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
