import { expect, test } from "@playwright/test";

/** The successor's first week: built from the approved handover, ticks off as items are acknowledged. */
test("successor's first-week plan", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
  await page.goto(`/w/${ws}/review/preview`);
  await expect(page.getByText(/will see \(\d+/).first()).toBeVisible();
  await page.getByRole("button", { name: /Approve handover/ }).click();
  await page.getByRole("button", { name: /Approve and share/ }).click();
  await page.getByRole("button", { name: /View as/ }).click();
  await page.waitForURL(/\/handover/, { waitUntil: "commit" });

  await page.getByTestId("ack-controls").first().getByTestId("ack-got-it").click();
  await expect(page.getByTestId("ack-controls").first().getByTestId("ack-got-it")).toHaveText(/Acknowledged/);
  await page.getByTestId("first-week-link").click();
  await page.waitForURL(/\/first-week/);
  await expect(page.getByRole("heading", { name: "Your first week" })).toBeVisible();
  await expect(page.getByTestId("bucket-day1")).toContainText("admin access");
  await page.getByTestId("bucket-day1").getByRole("button", { name: /Show all/ }).click();
  await expect(page.getByTestId("bucket-day1").locator('[data-done="1"]')).toContainText("Vercel");  // done items sink to the end
  await expect(page.getByTestId("bucket-day1")).toContainText("It names you.");
  await expect(page.getByTestId("first-week-progress")).toContainText(/^1 of \d+ picked up/);
  await expect(page.getByTestId("first-week")).not.toContainText("TechNova");
  expect(errors).toEqual([]);
});
