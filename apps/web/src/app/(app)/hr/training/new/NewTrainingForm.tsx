"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

export function NewTrainingForm() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [facilitator, setFacilitator] = useState("");
  const [maxParticipants, setMaxParticipants] = useState(30);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const titleId = useId();
  const venueId = useId();
  const fromDateId = useId();
  const toDateId = useId();
  const facilitatorId = useId();
  const maxParticipantsId = useId();
  const statusMsgId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !fromDate || !toDate) {
      setStatus("error");
      setMessage("Title, from date, and to date are required.");
      return;
    }
    if (new Date(toDate) < new Date(fromDate)) {
      setStatus("error");
      setMessage("To date must be on or after from date.");
      return;
    }
    if (maxParticipants < 1) {
      setStatus("error");
      setMessage("Max participants must be at least 1.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/proxy/v1/hrms/trainings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          venue: venue.trim() || undefined,
          fromDate,
          toDate,
          facilitator: facilitator.trim() || undefined,
          maxParticipants,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        setStatus("error");
        setMessage(text || `Request failed (${res.status})`);
        return;
      }

      setStatus("success");
      setMessage("Training program created successfully.");
      router.push("/hr/training");
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
        <label htmlFor={titleId} className="block text-sm font-medium text-slate-700 mb-1">
          Title
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Advanced Excel Training"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
        />
      </div>

      <div>
        <label htmlFor={venueId} className="block text-sm font-medium text-slate-700 mb-1">
          Venue (optional)
        </label>
        <input
          id={venueId}
          type="text"
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          placeholder="e.g. Conference Hall, Block A"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={fromDateId} className="block text-sm font-medium text-slate-700 mb-1">
            From Date
          </label>
          <input
            id={fromDateId}
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>
        <div>
          <label htmlFor={toDateId} className="block text-sm font-medium text-slate-700 mb-1">
            To Date
          </label>
          <input
            id={toDateId}
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor={facilitatorId} className="block text-sm font-medium text-slate-700 mb-1">
          Facilitator (optional)
        </label>
        <input
          id={facilitatorId}
          type="text"
          value={facilitator}
          onChange={(e) => setFacilitator(e.target.value)}
          placeholder="e.g. Dr. Sharma"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor={maxParticipantsId} className="block text-sm font-medium text-slate-700 mb-1">
          Max Participants
        </label>
        <input
          id={maxParticipantsId}
          type="number"
          min={1}
          value={maxParticipants}
          onChange={(e) => setMaxParticipants(Number(e.target.value))}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          required
        />
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {status === "submitting" ? "Creating…" : "Create Training Program"}
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
