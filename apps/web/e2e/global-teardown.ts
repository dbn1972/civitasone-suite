import http from 'node:http';

export default async function globalTeardown(): Promise<void> {
  const server = (global as Record<string, unknown>).__e2eMockServer as http.Server | undefined;
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('[e2e] Mock gateway stopped');
  }
}
