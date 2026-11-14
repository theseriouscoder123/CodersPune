import { expect, test, type Page } from "@playwright/test";

/**
 * Captures the screenshots for the project PDF (docs/05 §M6): 1440x900, light theme, production.
 * Not part of the normal suite: run with  SHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts --project desktop
 */
test.skip(!process.env.SHOTS, "screenshots only when SHOTS=1");
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });

const OUT = "../../docs/screenshots";

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(900);
}

async function shot(page: Page, name: string, fullPage = false) {
  await settle(page);
  if (fullPage) await page.addStyleTag({ content: "[data-testid=tour]{display:none!important}" });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

async function persona(page: Page, name: string) {
  await page.getByTestId("persona-switcher").click();
  await page.getByTestId("persona-menu").getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("persona-switcher")).toContainText(name);
}

test("capture screenshots", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await shot(page, "01-landing");
  await shot(page, "01b-landing-full", true);

  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
  await expect(page.getByRole("heading", { name: "Connected sources" })).toBeVisible();
  await shot(page, "02-sources");

  const run = await page.evaluate(async (id) => (await (await fetch(`/api/workspaces/${id}/runs/latest`)).json()).run?.id, ws);
  if (run) {
    await page.goto(`/w/${ws}/runs/${run}`);
    await shot(page, "03-run-progress");
  }

  await page.goto(`/w/${ws}/ledger`);
  await expect(page.getByRole("heading", { name: "The reconstructed ledger" })).toBeVisible();
  await shot(page, "04-ledger");
  await expect(page.getByRole("heading", { name: "Decision timeline" })).toBeVisible();
  await page.getByRole("heading", { name: "Decision timeline" }).evaluate((el) => {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: "instant" as ScrollBehavior });
  });
  await shot(page, "08-timeline");

  await page.goto(`/w/${ws}/review`);
  const list = page.getByTestId("claim-list");
  await list.locator("li", { hasText: "OneSignal" }).first().locator("button").click();
  await shot(page, "05-evidence-panel");

  await page.goto(`/w/${ws}/review?tab=conflicts`);
  await list.locator("li").first().locator("button").click();
  await shot(page, "06-conflict");

  await page.goto(`/w/${ws}/review?tab=missing`);
  await list.locator("li").first().locator("button").click();
  await shot(page, "07-missing-questions");

  await page.keyboard.press("Control+k");
  await page.getByTestId("search-palette").getByRole("textbox", { name: "Search" }).fill("Cloudinary");
  await page.waitForTimeout(1200);
  await shot(page, "15-search");
  await page.keyboard.press("Escape");

  await page.goto(`/w/${ws}/review/preview`);
  await shot(page, "09-preview-withheld", true);
  await page.getByTestId("approve-open").click();
  await page.getByTestId("approve-confirm").click();
  await expect(page.getByText(/Version 1 is approved/)).toBeVisible();

  // a second version so the changelog and version history have something to show
  await page.goto(`/w/${ws}/review?tab=missing`);
  await page.goto(`/w/${ws}/review`);
  await list.locator("li", { hasText: "Supported" }).first().locator("button").click();
  await page.getByTestId("claim-panel").getByTestId("confirm").click();
  await page.waitForTimeout(800);
  await page.goto(`/w/${ws}/review/preview`);
  await page.getByTestId("approve-open").click();
  await page.getByTestId("approve-confirm").click();
  await expect(page.getByText(/Version 2 is approved/)).toBeVisible();

  await page.goto(`/w/${ws}/handover`);
  await page.getByTestId("versions").scrollIntoViewIfNeeded();
  await shot(page, "11-versions");

  await page.goto(`/w/${ws}/activity`);
  await shot(page, "14-activity");
  await page.goto(`/w/${ws}/team`);
  await shot(page, "13-team-notifications", true);

  await persona(page, "Neha");
  await page.goto(`/w/${ws}/handover`);
  await shot(page, "10-handover-neha");
  await shot(page, "10b-handover-neha-full", true);
  await page.getByTestId("handover-sections").getByTestId("source-ref").first().click();
  await expect(page.getByTestId("evidence-drawer")).toBeVisible();
  await shot(page, "16-evidence-drawer");
  await page.keyboard.press("Escape");

  // Ask (one live AI call; skipped quietly if the free quota is exhausted)
  const ask = page.getByTestId("ask-handover");
  await ask.getByRole("button", { name: "What should I do first?" }).click();
  await ask.getByText(/Answer from the handover|Partial answer|doesn.t cover|quota|busy/i).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  await ask.scrollIntoViewIfNeeded();
  await shot(page, "12-ask-handover");
});

test("capture Round 3 screenshots", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];

  // 08b: why two decisions relate (the timeline's detail drawer)
  await page.goto(`/w/${ws}/ledger`);
  const tl = page.getByTestId("decision-timeline");
  await tl.getByTestId("relation-chip").first().click();
  await expect(page.getByTestId("relation-detail")).toBeVisible();
  await shot(page, "08b-timeline-why");
  await page.keyboard.press("Escape");

  // 21: knowledge risk
  await page.goto(`/w/${ws}/risk`);
  await expect(page.getByTestId("risk-people")).toBeVisible();
  await shot(page, "21-knowledge-risk");

  // 20: compare what two people see
  await page.goto(`/w/${ws}/review/preview`);
  await expect(page.getByText(/will see \(\d+/).first()).toBeVisible();
  await page.getByTestId("compare-views").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("compare-summary")).toBeVisible();
  await page.getByTestId("compare-views").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64));
  await shot(page, "20-compare-views");

  // 09b: the approve dialog with its counts
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: /Approve handover/ }).click();
  await expect(page.getByTestId("approve-counts")).toBeVisible();
  await shot(page, "09b-approve-counts");
  await page.getByRole("button", { name: /Approve and share/ }).click();
  await expect(page.getByText(/Version 1 approved/i).first()).toBeVisible();

  // 19: a successor question waiting for the reviewer
  await page.goto(`/w/${ws}/handover`);
  await persona(page, "Neha");
  const controls = page.getByTestId("ack-controls");
  await controls.first().getByTestId("ack-got-it").click();
  await controls.nth(1).getByTestId("ack-ask").click();
  await controls.nth(1).getByTestId("ack-question").fill("Who do I ask for admin access to the Vercel project?");
  await controls.nth(1).getByRole("button", { name: "Send" }).click();
  await expect(controls.nth(1)).toContainText("Waiting for the reviewer");
  await persona(page, "Meera");
  const rq = page.getByTestId("reviewer-questions");
  await expect(rq).toContainText("Vercel project");
  await rq.scrollIntoViewIfNeeded();
  await rq.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64));
  await shot(page, "19-acks-reviewer-questions");

  // 17 and 18: the gap interview, as the reviewer and then as the leaver
  await page.goto(`/w/${ws}/review?tab=missing`);
  await page.getByTestId("start-interview").click();
  await page.waitForURL(/\/interview\//);
  await expect(page.getByTestId("interview-question").first()).toBeVisible();
  await shot(page, "17-interview-reviewer");
  await page.getByTestId("send-interview").click();
  await page.getByTestId("play-leaver").click();
  await expect(page.getByTestId("interview-status")).toHaveText("Waiting for your answers");
  await shot(page, "18-interview-leaver");
});
