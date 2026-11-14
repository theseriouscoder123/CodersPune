import { expect, test } from "@playwright/test";

/** Fix F1 in the browser: the approve dialog and the successor's page report the same number of items. */
test("approve dialog and successor page agree on counts", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];

  await page.goto(`/w/${ws}/review/preview`);
  await page.getByRole("button", { name: /Approve handover/ }).click();
  const counts = page.getByTestId("approve-counts");
  await expect(counts).toBeVisible();
  const shared = (await counts.locator("p").first().innerText()).trim();
  expect(Number(shared)).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Approve and share/ }).click();
  await expect(page.getByText(/Version 1 approved/i).first()).toBeVisible();

  await page.getByRole("button", { name: /View as/ }).click();
  await page.waitForURL(/\/handover/);
  await expect(page.getByTestId("handover-counts")).toContainText(`${shared} item`);
  const cards = page.locator("[data-section] li[class*='rounded-xl']:not([class*='dashed'])");
  const history = await page.locator("[data-section] li.opacity-70").count();
  expect((await cards.count()) - history).toBe(Number(shared));
});
