import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

// /ai is the ai-agent-service console. The mock gateway filters /v1/ai/chat on ?status= and
// /v1/ai/governance/audit on ?blocked=, so the filter tests below exercise the real server-side paths.
test.describe('AI & Copilot', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  test('hub shows the five AI areas and links to each', async ({ page }) => {
    await page.goto('/ai');
    await expect(page.locator('#page-heading:visible')).toContainText('AI & Copilot');
    await expect(page.getByText('Conversational AI, copilot assistance, and multi-agent orchestration.')).toBeVisible();
    for (const [label, href] of [
      ['Chat', '/ai/chat'],
      ['Copilot', '/ai/copilot'],
      ['Agents', '/ai/agents'],
      ['Guardrails', '/ai/guardrails'],
      ['Governance', '/ai/governance'],
    ] as const) {
      await expect(page.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('href', href);
    }
  });

  test('hub link opens the agents list', async ({ page }) => {
    await page.goto('/ai');
    await page.getByRole('link', { name: /^Agents/ }).click();
    await expect(page).toHaveURL(/\/ai\/agents/);
    await expect(page.locator('#page-heading:visible')).toContainText('AI — Agents');
  });

  test('agents table shows each agent with its lifecycle status', async ({ page }) => {
    await page.goto('/ai/agents');
    await expect(page.locator('#page-heading:visible')).toContainText('AI — Agents');
    for (const col of ['Agent', 'Status', 'Updated', 'ID']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    await expect(page.getByRole('row', { name: /Grievance Triage Agent/ })).toContainText('Active');
    await expect(page.getByRole('row', { name: /Leave Policy Assistant/ })).toContainText('Paused');
    await expect(page.getByRole('link', { name: 'Manage in Governance' })).toHaveAttribute('href', '/ai/governance');
  });

  test('guardrails table shows type, severity and pattern of each rule', async ({ page }) => {
    await page.goto('/ai/guardrails');
    await expect(page.locator('#page-heading:visible')).toContainText('AI — Guardrails');
    const pii = page.getByRole('row', { name: /Aadhaar number redaction/ });
    await expect(pii).toContainText('PII redaction');
    await expect(pii).toContainText('High');
    await expect(pii).toContainText('Active');
    const injection = page.getByRole('row', { name: /Prompt injection block/ });
    await expect(injection).toContainText('Prompt-injection block');
    await expect(injection).toContainText('Critical');
    await expect(page.getByRole('link', { name: 'View blocked prompts' })).toHaveAttribute('href', '/ai/governance?blocked=true');
  });

  test('copilot summarises its turn history and counts typed prompt characters', async ({ page }) => {
    await page.goto('/ai/copilot');
    await expect(page.locator('#page-heading:visible')).toContainText('Copilot');
    const main = page.locator('main');
    await expect(main).toContainText(/Turns\s*2/);
    await expect(main).toContainText(/Answered \(latest page\)\s*1/);
    await expect(main).toContainText(/Awaiting \(latest page\)\s*1/);
    await expect(main).toContainText(/Avg Latency\s*820 ms/);
    const answered = page.getByRole('row', { name: /Summarise the pending leave rules/ });
    await expect(answered).toContainText('Answered');
    await expect(answered).toContainText('govllm-1');
    await expect(page.getByRole('row', { name: /Draft a note on file movement delays/ })).toContainText('Awaiting');
    await page.getByLabel('Prompt', { exact: true }).fill('Hello');
    await expect(page.getByText('5 / 32,000 characters')).toBeVisible();
  });

  test('chat lists conversations with real counts, handed-off first', async ({ page }) => {
    await page.goto('/ai/chat');
    await expect(page.locator('#page-heading:visible')).toContainText('Assistant Conversations');
    const main = page.locator('main');
    await expect(main).toContainText(/Conversations\s*3/);
    await expect(main).toContainText(/With agent\s*1/);
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toContainText('grievance-desk');
    await expect(rows.nth(1)).toContainText('Citizen asked for a person');
    await expect(rows.nth(3)).toContainText('12 min');
    await expect(page.getByText(/^Waiting \d/)).toHaveCount(1);
  });

  test('the chat status filter narrows the list on the server', async ({ page }) => {
    await page.goto('/ai/chat');
    await page.getByRole('combobox', { name: /status/i }).selectOption({ label: 'With a human agent' });
    await expect(page).toHaveURL(/\/ai\/chat\?status=handed_off/);
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('row').nth(1)).toContainText('grievance-desk');
    await expect(page.getByText('12 min')).toHaveCount(0);
  });

  test('governance shows counters, the audit trail and the kill-switch', async ({ page }) => {
    await page.goto('/ai/governance');
    await expect(page.locator('#page-heading:visible')).toContainText('AI Governance');
    const main = page.locator('main');
    await expect(main).toContainText(/AI Invocations\s*1,240/);
    await expect(main).toContainText(/Blocked Actions\s*62/);
    await expect(main).toContainText(/Block Rate\s*5%/);
    await expect(page.getByText('Elevated — review the block reasons')).toBeVisible();
    await expect(page.getByRole('row', { name: /Prompt injection detected/ })).toContainText('Blocked');
    await expect(page.getByRole('heading', { name: 'Agent Kill-Switch' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pause/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Resume/ })).toBeVisible();
  });

  test('Show blocked only narrows the audit trail to refused actions', async ({ page }) => {
    await page.goto('/ai/governance');
    await expect(page.getByRole('row', { name: /Allowed/ })).toHaveCount(1);
    await page.getByRole('link', { name: 'Show blocked only' }).click();
    await expect(page).toHaveURL(/blocked=true/);
    await expect(page.getByRole('link', { name: 'Show all actions' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Blocked/ })).toHaveCount(1);
    await expect(page.getByRole('row', { name: /Allowed/ })).toHaveCount(0);
  });

  test('no agents shows the empty state', async ({ page }) => {
    await authenticate(page, 'empty');
    await page.goto('/ai/agents');
    await expect(page.locator('#page-heading:visible')).toContainText('AI — Agents');
    await expect(page.getByText('No agents defined')).toBeVisible();
    await expect(page.getByText('Agents published for this office appear here with their current status.')).toBeVisible();
  });

  test('a failed chat load shows a retry state and dashes, not zero counts', async ({ page }) => {
    await authenticate(page, 'down');
    await page.goto('/ai/chat');
    await expect(page.locator('#page-heading:visible')).toContainText('Assistant Conversations');
    await expect(page.getByText("We couldn't load conversations.")).toBeVisible();
    await expect(page.locator('main')).toContainText(/Conversations\s*—/);
    await expect(page.getByRole('combobox', { name: /status/i })).toBeVisible();
  });
});
