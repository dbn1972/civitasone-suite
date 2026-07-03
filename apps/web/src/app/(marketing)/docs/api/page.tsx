import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API Reference — CivitasOne",
  description:
    "OpenAPI 3.1 specification for the CivitasOne Suite REST API. Bearer token auth, CQRS async writes, 33 services.",
};

const services = [
  { name: "Finance", description: "Budget, bills, payments, GL, sanctions", endpoints: 45 },
  { name: "HRMS", description: "Employees, leave, attendance, payroll", endpoints: 62 },
  { name: "Procurement", description: "Indents, vendors, purchase orders, GRN", endpoints: 38 },
  { name: "Tenant", description: "Settings, plans, subscriptions, quotas", endpoints: 12 },
  { name: "Admin", description: "Feature flags, webhooks, jobs, data export", endpoints: 28 },
  { name: "Identity", description: "Authentication, sessions, devices", endpoints: 18 },
  { name: "Citizen", description: "Requests, RTI, grievances", endpoints: 22 },
  { name: "Stock", description: "Items, barcode lookup, goods receipt", endpoints: 16 },
  { name: "Helpdesk", description: "Tickets, SLA, escalation", endpoints: 24 },
  { name: "Audit", description: "Events, compliance, observations", endpoints: 14 },
];

export default function ApiDocsPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
          API Reference
        </h1>
        <p className="mt-4 text-lg text-gray-500">
          CivitasOne exposes a unified REST API across 33 microservices with 1,185+
          endpoints. All write operations use CQRS (return 202 Accepted) and all
          requests require Bearer token authentication via Keycloak OIDC.
        </p>
      </div>

      {/* Quick links */}
      <div className="mt-10 flex flex-wrap gap-3">
        <a
          href="/docs/api/openapi.yaml"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          download
        >
          <span aria-hidden="true">📄</span> Download OpenAPI Spec (YAML)
        </a>
        <a
          href="https://api.civitasone.app"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span aria-hidden="true">🔗</span> Production Base URL
        </a>
      </div>

      {/* Auth section */}
      <div className="mt-12 rounded-xl border border-gray-200 bg-gray-50 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Authentication</h2>
        <p className="mt-2 text-sm text-gray-600">
          All endpoints require a Bearer token obtained from Keycloak. Include the token
          in the <code className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-mono">Authorization</code> header:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-green-400 font-mono">
{`Authorization: Bearer <access_token>

# Obtain token:
POST /realms/civitasone/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<id>&client_secret=<secret>`}
        </pre>
      </div>

      {/* CQRS note */}
      <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Write Pattern (CQRS)</h2>
        <p className="mt-2 text-sm text-gray-600">
          All mutations (POST, PUT, PATCH, DELETE) return <code className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-mono">202 Accepted</code> with
          a correlation ID. The command is processed asynchronously via SQS.
          Subscribe to webhooks or poll for status updates.
        </p>
      </div>

      {/* Services grid */}
      <h2 className="mt-12 text-2xl font-bold text-gray-900">Services</h2>
      <p className="mt-2 text-gray-500">
        Each service owns its own database and exposes a focused API surface.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="rounded-xl border border-gray-200 p-5 hover:border-gray-300 hover:shadow-sm transition-all"
          >
            <h3 className="font-semibold text-gray-900">{svc.name}</h3>
            <p className="mt-1 text-sm text-gray-500">{svc.description}</p>
            <p className="mt-3 text-xs text-gray-400">{svc.endpoints} endpoints</p>
          </div>
        ))}
      </div>

      {/* Spec info */}
      <div className="mt-12 border-t border-gray-100 pt-8">
        <h2 className="text-lg font-semibold text-gray-900">OpenAPI Specification</h2>
        <p className="mt-2 text-sm text-gray-600">
          The curated spec covers the top 35 most-used endpoints with full request/response
          schemas. For the complete auto-generated spec covering all 1,185 endpoints, run:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-green-400 font-mono">
{`node scripts/docs/generate-openapi.mjs > docs/api/openapi-generated.yaml`}
        </pre>
      </div>

      {/* Back link */}
      <div className="mt-8">
        <Link
          href="/docs"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to Documentation
        </Link>
      </div>
    </section>
  );
}
