/**
 * Plain-language summary of a connection-test failure (GAP-ADMIN-INTEGRATIONS-04).
 * The provider's own error text can carry hostnames, ports and paths; callers
 * show this summary and keep the raw text behind a "Technical detail" disclosure.
 */
export function describeTestFailure(status: string, raw: string | null | undefined): string {
  const text = (raw ?? "").toLowerCase();
  if (status === "unconfigured") return "Not configured yet. Add the connection details and save before testing.";
  if (/econnrefused|enotfound|getaddrinfo|ehostunreach|enetunreach|dns|unreachable|connection refused/.test(text)) {
    return "The server could not be reached. Check the address and that the service is running.";
  }
  if (/etimedout|timed out|timeout|esockettimedout/.test(text)) {
    return "The server did not respond in time. Try again, or check the address.";
  }
  if (/certificate|cert_|tls|ssl|handshake/.test(text)) {
    return "A secure connection could not be established. Check the certificate or TLS settings.";
  }
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid.*(key|token|credential|password)|authentication|auth failed|permission denied/.test(text)) {
    return "The provider rejected the credentials. Check the key or password and try again.";
  }
  return "The connection test did not succeed. Check the settings and try again.";
}
