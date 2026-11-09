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
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

async function persona(page: Page, name: string) {
  await page.getByTestId("persona-switcher").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("persona-switcher")).toContainText(name);
}

test("capture screenshots", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await shot(page, "01-landing");

  await page.getByRole("button", { name: "Try the demo" }).click();
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
