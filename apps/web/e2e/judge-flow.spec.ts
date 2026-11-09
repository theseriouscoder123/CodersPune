import { expect, test, type Page } from "@playwright/test";

/**
 * The scored loop, as a first-time visitor with no walkthrough:
 * authorised sources → reconstructed knowledge → inspect evidence → review and approve → role-appropriate handover
 * → see what remains unresolved. Each test starts a fresh browser context, so it gets its own sandbox copy.
 */

async function startDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  return page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
}

async function switchPersona(page: Page, name: string) {
  await page.getByTestId("persona-switcher").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("persona-switcher")).toContainText(name);
}

test("judge flow: connect → reconstruct → verify → review → approve → successor handover", async ({ page }) => {
  const ws = await startDemo(page);

  // Connect: sources with who can see them, synthetic label
  await expect(page.getByRole("heading", { name: "Connected sources" })).toBeVisible();
  await expect(page.getByText("Synthetic demo data").first()).toBeVisible();
  await expect(page.getByText(/Visible to/).first()).toBeVisible();

  // Reconstruct: counts by status and the decision timeline
  await page.getByTestId("step-ledger").click();
  await expect(page.getByRole("heading", { name: "The reconstructed ledger" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision timeline" })).toBeVisible();

  // Verify: open a claim, see why it got its status and its quoted evidence
  await page.getByTestId("step-review").click();
  const list = page.getByTestId("claim-list");
  await expect(list.locator("li").first()).toBeVisible();
  const supported = list.locator("li", { hasText: "Supported" }).first();
  await supported.locator("button").click();
  const panel = page.getByTestId("claim-panel");
  await expect(panel.getByTestId("status-reason")).toContainText("Why supported");
  await expect(panel.getByText(/Evidence/).first()).toBeVisible();

  // Review: confirm the claim; progress moves
  await panel.getByTestId("confirm").click();
  await expect(page.getByTestId("review-progress")).toContainText(/[1-9]\d* of \d+ claims reviewed/);

  // Preview + approve
  await page.goto(`/w/${ws}/review/preview`);
  await expect(page.getByText(/What Neha will see/).last()).toBeVisible();
  await page.getByTestId("approve-open").click();
  await expect(page.getByText(/withheld \(restricted\)/)).toBeVisible();
  await page.getByTestId("approve-confirm").click();
  await expect(page.getByText(/Version 1 is approved/)).toBeVisible();

  // Handover as the successor: only permitted, approved content, unresolved items marked
  await switchPersona(page, "Neha");
  await page.goto(`/w/${ws}/handover`);
  const sections = page.getByTestId("handover-sections");
  await expect(sections).toBeVisible();
  await expect(page.getByTestId("handover-meta")).toContainText("Approved by Meera");
  await expect(sections.getByRole("heading", { name: /Start here/ })).toBeVisible();
  await expect(sections.getByRole("heading", { name: /Unresolved/ })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toContain("TechNova"); // restricted #core-team content never reaches Neha
  expect(text).not.toContain("40,000");

  // Evidence is one click away from any handover item
  await sections.getByTestId("source-ref").first().click();
  await expect(page.getByTestId("evidence-drawer")).toBeVisible();
});

test("the successor can't open the draft ledger or the visibility preview", async ({ page }) => {
  const ws = await startDemo(page);
  await switchPersona(page, "Neha");
  await page.goto(`/w/${ws}/review`);
  await expect(page.getByText(/isn.t shared with Neha/)).toBeVisible();
  // and the API refuses too (server-side enforcement, not just hidden UI)
  const persona = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.includes("persona"))?.[1] ?? "");
  const r = await page.request.get(`/api/workspaces/${ws}/claims`, { headers: persona ? { "X-Baton-Persona": persona } : {} });
  expect([403, 404]).toContain(r.status());
});

test("nothing reaches the successor before approval", async ({ page }) => {
  const ws = await startDemo(page);
  await switchPersona(page, "Neha");
  await page.goto(`/w/${ws}/handover`);
  await expect(page.getByTestId("handover-pending")).toBeVisible();
});

test("phone: workspace pages fit the screen @phone", async ({ page }) => {
  const ws = await startDemo(page);
  for (const path of ["sources", "ledger", "review"]) {
    await page.goto(`/w/${ws}/${path}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
  }
});
