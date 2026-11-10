import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** WCAG 2.1 A/AA automated audit (axe-core) of every main screen, as the reviewer and as the successor. */

const PAGES = ["sources", "ledger", "review", "review/preview", "team", "activity", "health", "handover"];

async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600); // let entry animations settle so contrast is measured on final colours
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of r.violations) {
    console.log(`[a11y] ${label} · ${v.impact} · ${v.id} · ${v.nodes.length} node(s) · ${v.nodes[0]?.target.join(" ")}`);
  }
  return serious;
}

test("a11y: landing page @desktop", async ({ page }) => {
  await page.goto("/");
  expect(await audit(page, "landing")).toEqual([]);
});

test("a11y: workspace screens @desktop", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
  const failures: string[] = [];
  for (const p of PAGES) {
    await page.goto(`/w/${ws}/${p}`);
    const serious = await audit(page, p);
    failures.push(...serious.map((v) => `${p}: ${v.id} (${v.nodes.length})`));
  }
  expect(failures).toEqual([]);
});

test("a11y: workspace screens in dark mode @desktop", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
  const failures: string[] = [];
  for (const p of ["sources", "ledger", "review", "handover"]) {
    await page.goto(`/w/${ws}/${p}`);
    failures.push(...(await audit(page, `dark ${p}`)).map((v) => `${p}: ${v.id} (${v.nodes.length})`));
  }
  expect(failures).toEqual([]);
});
