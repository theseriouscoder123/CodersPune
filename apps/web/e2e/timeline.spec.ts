import { expect, test } from "@playwright/test";

/**
 * Round 3 improvement #2 in the browser: the decision timeline tells a changed decision apart from a contradiction,
 * explains why, flags stale open work, and the reviewer can override a relation and keep stale work open.
 */
test("decision timeline: explain, filter, override", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
  await page.goto(`/w/${ws}/ledger`);

  const tl = page.getByTestId("decision-timeline");
  await expect(tl.getByTestId("relation-chip").first()).toBeVisible();

  // contradictions filter -> open one -> the reason is shown
  await tl.getByTestId("tl-filter-contradictions").click();
  await tl.getByTestId("relation-chip").first().click();
  const detail = page.getByTestId("relation-detail");
  await expect(detail).toContainText("A contradiction");
  await expect(detail).toContainText("no reversal language");
  await page.getByRole("button", { name: "Close" }).first().click();

  // stale open work, kept open by the reviewer
  await tl.getByTestId("tl-filter-stale").click();
  const staleChips = tl.getByTestId("stale-chip");
  const before = await staleChips.count();
  expect(before).toBeGreaterThan(0);
  await staleChips.first().click();
  await expect(page.getByTestId("stale-detail")).toContainText("Why Baton thinks so");
  await page.getByTestId("still-open").click();
  await expect(staleChips).toHaveCount(before - 1);

  // override a changed decision into a contradiction
  await tl.getByTestId("tl-filter-changes").click();
  await tl.getByTestId("relation-chip").first().click();
  await page.getByRole("radio", { name: /Contradiction/ }).click();
  await page.getByPlaceholder(/Why\?/).fill("These are two different auth setups");
  await page.getByTestId("save-relation").click();
  await tl.getByTestId("tl-filter-contradictions").click();
  await expect(tl.getByText("· reviewer").first()).toBeVisible();
  expect(errors).toEqual([]);
});
