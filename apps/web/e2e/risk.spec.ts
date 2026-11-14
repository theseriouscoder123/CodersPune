import { expect, test } from "@playwright/test";

/** Knowledge risk: who would take knowledge with them, why (fixed rules), and starting a handover from there. */
test("knowledge risk panel and starting a handover from it", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];

  await page.goto(`/w/${ws}/ledger`);
  await page.getByTestId("ledger-risk-link").click();
  await page.waitForURL(/\/risk/);
  const rohan = page.getByTestId("risk-rohan");
  await expect(rohan.getByTestId("risk-level")).toContainText("High risk");
  await expect(rohan).toContainText(".github/workflows/deploy.yml (31 of 33 commits)");
  await expect(rohan.getByRole("link", { name: /Open Rohan's handover/ })).toBeVisible();
  await expect(page.getByTestId("unowned")).toContainText("Firebase account/project and its billing");
  await expect(page.getByTestId("risk-rules")).toContainText("No AI is involved");

  // Kabir has no handover yet: start one, and land on its preview
  const kabir = page.getByTestId("risk-kabir");
  await kabir.getByTestId("risk-start").click();
  const neha = await kabir.getByTestId("risk-successor").locator("option", { hasText: "Neha" }).getAttribute("value");
  await kabir.getByTestId("risk-successor").selectOption(neha!);
  await kabir.getByRole("button", { name: "Start handover" }).click();
  await page.waitForURL(/\/review\/preview\?h=/);
  await expect(page.getByText(/Kabir → Neha/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
