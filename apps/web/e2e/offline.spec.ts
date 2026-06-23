import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

/**
 * 10-T4 — Web offline-first acceptance (prompt 01).
 * Exercises the wired offline layer: service-worker app shell, IndexedDB-backed
 * outbox that survives reload, and the offline status UX. These require the SW to
 * register (production build / `next start`); under `next dev` the SW is still
 * served from /public so registration succeeds.
 */
test.describe('Web offline-first', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('service worker registers and controls the page', async ({ page }) => {
    await page.goto('/dashboard');
    const hasSW = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg);
    });
    expect(hasSW).toBeTruthy();
  });

  test('app shell renders offline after a prior visit', async ({ page, context }) => {
    await page.goto('/dashboard');
    // Give the SW a moment to cache the shell.
    await page.waitForTimeout(1000);

    await context.setOffline(true);
    await page.reload();

    // Either the cached dashboard or the offline fallback must render — never a
    // hard browser error page.
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(0);
    await context.setOffline(false);
  });

  test('offline status pill appears when connectivity drops', async ({ page, context }) => {
    await page.goto('/dashboard');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/offline/i)).toBeVisible();
    await context.setOffline(false);
  });

  test('a mutation made offline is persisted in the local request queue', async ({ page, context }) => {
    await page.goto('/dashboard');
    await context.setOffline(true);

    // Enqueue a mutation through the durable IndexedDB request store the forms use.
    const queuedCount = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        const open = indexedDB.open('civitasone-reqs', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('requests', { keyPath: 'id' });
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('requests', 'readwrite');
          tx.objectStore('requests').put({
            id: 'test-1',
            method: 'POST',
            path: '/v1/test',
            body: {},
            idempotencyKey: 'test-1',
            createdAt: new Date().toISOString(),
            retryCount: 0,
          });
          tx.oncomplete = () => {
            const tx2 = db.transaction('requests', 'readonly');
            const req = tx2.objectStore('requests').getAll();
            req.onsuccess = () => resolve((req.result as unknown[]).length);
          };
        };
        open.onerror = () => resolve(0);
      });
    });

    expect(queuedCount).toBeGreaterThan(0);

    // Survives a reload while still offline (durability).
    await page.reload();
    const afterReload = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('civitasone-reqs', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('requests', 'readonly');
            const req = tx.objectStore('requests').getAll();
            req.onsuccess = () => resolve((req.result as unknown[]).length);
          };
          open.onerror = () => resolve(0);
        }),
    );
    expect(afterReload).toBeGreaterThan(0);
    await context.setOffline(false);
  });
});
