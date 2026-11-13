import { expect, test } from "@playwright/test";

/**
 * Round 3 improvement #1, end to end in the browser: the reviewer prepares and sends a gap interview, the leaver
 * answers (free text and a conflict pick), submits, and the reviewer sees cited testimony and resolves the conflict
 * as suggested. Runs in its own demo copy.
 */
test("gap interview: send, answer as the leaver, review the testimony", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];

  await page.goto(`/w/${ws}/review?tab=missing`);
  await page.getByTestId("start-interview").click();
  await page.waitForURL(/\/interview\//);
  const questions = page.getByTestId("interview-question");
  await expect(questions.first()).toBeVisible();
  expect(await questions.count()).toBeGreaterThan(1);

  await page.getByTestId("send-interview").click();
  await page.getByTestId("play-leaver").click();
  await expect(page.getByTestId("interview-status")).toHaveText("Waiting for your answers");

  // one free-text answer and the conflict pick
  const text = questions.filter({ has: page.locator("textarea") }).first();
  await text.locator("textarea").fill("It's on Rohan's personal Google account; moving it to the club account is pending.");
  await text.getByTestId("save-answer").click();
  await expect(text.getByText("Saved")).toBeVisible();
  const conflict = questions.filter({ has: page.locator("input[type=radio]") }).first();
  await conflict.locator("input[type=radio]").first().check();
  await conflict.getByTestId("save-answer").click();
  await expect(conflict.getByText("Saved")).toBeVisible();

  // a double click on submit still produces one result
  await page.getByTestId("submit-interview").click();
  await page.getByRole("button", { name: "Submit answers" }).last().click();
  await expect(page.getByTestId("interview-status")).toHaveText("Answered");

  // back to the reviewer
  await page.getByTestId("persona-switcher").click();
  await page.getByRole("option", { name: /Meera/ }).click();
  await expect(page.getByTestId("open-testimony").first()).toBeVisible();
  await page.getByTestId("resolve-as-suggested").first().click();
  await expect(page.getByText("Conflict resolved").first()).toBeVisible();

  await page.getByTestId("open-testimony").first().click();
  await page.waitForURL(/\/review\?/);
  await expect(page.getByText(/Leaver testimony/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
