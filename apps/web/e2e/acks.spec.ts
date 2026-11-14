import { expect, test, type Page } from "@playwright/test";

/**
 * Round 3 improvement #3 in the browser: the reviewer sees withheld items that look like the successor's own work
 * (with a rewrite from sources the successor can read), approves, and the successor acknowledges items and asks a
 * question that the reviewer answers and the successor closes.
 */
async function as(page: Page, name: string) {
  await page.getByTestId("persona-switcher").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("persona-switcher")).toContainText(name);
}

test("withheld rewrite, acknowledgement and questions to closure", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];

  // reviewer preview: the successor's own withheld work is flagged, with a precomputed rewrite
  await page.goto(`/w/${ws}/review/preview`);
  await expect(page.getByText(/Looks like Neha's own work/).first()).toBeVisible();
  await expect(page.getByTestId("rerendered").first()).toContainText("Rewritten from sources Neha can read");
  await page.getByRole("button", { name: /Approve handover/ }).click();
  await page.getByRole("button", { name: /Approve and share/ }).click();
  await expect(page.getByText(/Version 1 approved/i).first()).toBeVisible();

  // successor acknowledges and asks
  await page.goto(`/w/${ws}/handover`);
  await as(page, "Neha");
  await expect(page.getByTestId("ack-progress")).toContainText("Your progress");
  const controls = page.getByTestId("ack-controls");
  await controls.first().getByTestId("ack-got-it").click();
  await expect(controls.first().getByTestId("ack-got-it")).toHaveText(/Acknowledged/);
  await controls.nth(1).getByTestId("ack-ask").click();
  await controls.nth(1).getByTestId("ack-question").fill("Who do I ask for access?");
  await controls.nth(1).getByRole("button", { name: "Send" }).click();
  await expect(controls.nth(1)).toContainText("Waiting for the reviewer");

  // reviewer answers
  await as(page, "Meera");
  const rq = page.getByTestId("reviewer-questions");
  await expect(rq).toContainText("Who do I ask for access?");
  await rq.getByTestId("answer-question").fill("Ask Rohan, he still has admin until 15 Nov.");
  await rq.getByRole("button", { name: "Answer" }).click();
  await expect(rq).toContainText("waiting for them to close it");

  // successor reads the answer and closes the question
  await as(page, "Neha");
  await expect(controls.nth(1)).toContainText("Ask Rohan");
  await controls.nth(1).getByTestId("ack-close").click();
  await expect(controls.nth(1)).toContainText("Closed");
  expect(errors).toEqual([]);
});
