import { expect, test, type Page } from "@playwright/test";

async function as(page: Page, name: string) {
  await page.getByTestId("persona-switcher").click();
  await page.getByTestId("persona-menu").getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("persona-switcher")).toContainText(name);
}

/** Before the leaver leaves: countdown, ordered checklist, ticking a manual item, and the leaver's own entry point. */
test("before Rohan leaves checklist", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];

  await page.goto(`/w/${ws}/review/preview`);
  await page.getByTestId("leaving-link").click();
  await page.waitForURL(/\/leaving/);
  await expect(page.getByRole("heading", { name: "Before Rohan leaves" })).toBeVisible();
  await expect(page.getByTestId("leaving-countdown")).toContainText(/15 Nov|days? left|last day/i);
  const items = page.getByTestId("leaving-item");
  await expect(items.first()).toContainText("Vercel");
  const walk = page.locator('[data-testid="leaving-item"][data-kind="walkthrough"]').first();
  await walk.getByTestId("leaving-toggle").click();
  await expect(page.locator('[data-testid="leaving-item"][data-kind="walkthrough"][data-done="1"]').first()).toBeVisible();
  await expect(page.getByTestId("leaving-countdown")).toContainText("1 of");

  // the leaver sees a banner pointing at the same checklist
  await page.goto(`/w/${ws}/sources`);
  await as(page, "Rohan");
  await page.getByTestId("leaver-banner").click();
  await page.waitForURL(/\/leaving/);
  await expect(page.getByTestId("leaving-items")).toContainText("Walk Neha through");
  expect(errors).toEqual([]);
});
