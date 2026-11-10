import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The scored loop, as a first-time visitor with no walkthrough:
 * authorised sources → reconstructed knowledge → inspect evidence → review and approve → role-appropriate handover
 * → see what remains unresolved.
 *
 * The desktop tests share ONE sandbox (one browser context, run in order) so a test run doesn't eat into the
 * per-network demo limit.
 */

async function startDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  return page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
}

async function switchPersona(page: Page, name: string) {
  await page.getByTestId("persona-switcher").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("persona-switcher")).toContainText(name);
}

test.describe.serial("judge flow @desktop", () => {
  let context: BrowserContext;
  let page: Page;
  let ws = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log(`[browser error] ${m.text().slice(0, 300)}`); });
    page.on("pageerror", (e) => console.log(`[page error] ${e.message.slice(0, 300)}`));
    page.on("requestfailed", (r) => console.log(`[request failed] ${r.url()} ${r.failure()?.errorText}`));
    ws = await startDemo(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("Connect: sources, who can see each one, synthetic label", async () => {
    await expect(page.getByRole("heading", { name: "Connected sources" })).toBeVisible();
    await expect(page.getByText("Synthetic demo data").first()).toBeVisible();
    await expect(page.getByText(/Visible to/).first()).toBeVisible();
  });

  test("nothing reaches the successor before approval", async () => {
    await switchPersona(page, "Neha");
    await page.goto(`/w/${ws}/handover`);
    await expect(page.getByTestId("handover-pending")).toBeVisible();
  });

  test("the successor can't open the draft ledger, in the UI or the API", async () => {
    await page.goto(`/w/${ws}/review`);
    await expect(page.getByText(/isn.t shared with Neha/)).toBeVisible();
    const persona = await page.evaluate((id) => localStorage.getItem(`baton:persona:${id}`) ?? "", ws);
    expect(persona).not.toBe("");
    const r = await page.request.get(`/api/workspaces/${ws}/claims`, { headers: { "X-Baton-Persona": persona } });
    expect([403, 404]).toContain(r.status());
  });

  test("Reconstruct: counts by status and the decision timeline", async () => {
    await switchPersona(page, "Meera");
    await page.goto(`/w/${ws}/ledger`);
    await expect(page.getByRole("heading", { name: "The reconstructed ledger" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Decision timeline" })).toBeVisible();
  });

  test("Search (Ctrl+K) finds claims and source passages", async () => {
    await page.keyboard.press("Control+k");
    const palette = page.getByTestId("search-palette");
    await palette.getByRole("textbox", { name: "Search" }).fill("push reminders");
    await expect(palette.getByText("Claims")).toBeVisible();
    await expect(palette.getByText("In the sources")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("Verify: a claim shows why it got its status and its quoted evidence; the reviewer confirms it", async () => {
    await page.getByTestId("step-review").click();
    const list = page.getByTestId("claim-list");
    const supported = list.locator("li", { hasText: "Supported" }).first();
    await supported.locator("button").click();
    const panel = page.getByTestId("claim-panel");
    await expect(panel.getByTestId("status-reason")).toContainText("Why supported");
    await expect(panel.getByText(/Evidence/).first()).toBeVisible();
    await panel.getByTestId("confirm").click();
    await expect(page.getByTestId("toast-action")).toHaveText("Undo"); // every confirm/reject can be undone
    await expect(page.getByTestId("review-progress")).toContainText(/[1-9]\d* of \d+ claims reviewed/);
  });

  test("Review: preview what the successor will see, then approve", async () => {
    await page.goto(`/w/${ws}/review/preview`);
    await expect(page.getByText(/What Neha will see/).last()).toBeVisible();
    await page.getByTestId("approve-open").click();
    await expect(page.getByText(/withheld \(restricted\)/)).toBeVisible();
    await page.getByTestId("approve-confirm").click();
    await expect(page.getByText(/Version 1 is approved/)).toBeVisible();
  });

  test("Handover: the successor sees only permitted, approved content with unresolved items marked", async () => {
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
    await sections.getByTestId("source-ref").first().click();
    await expect(page.getByTestId("evidence-drawer")).toBeVisible();
  });

  test("Getting-started checklist reflects real progress: 6/6 after the loop", async () => {
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("tour-open")).toContainText("Tour complete");
  });
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
