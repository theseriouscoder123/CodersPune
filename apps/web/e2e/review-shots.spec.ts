import { expect, test } from "@playwright/test";

/** Ad-hoc visual review captures (not part of the suite): REVIEW_SHOTS=<dir> pnpm exec playwright test e2e/review-shots.spec.ts */
const OUT = process.env.REVIEW_SHOTS ?? "";
test.skip(!OUT, "visual review only");

for (const vp of [{ name: "desk", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test(`review ${vp.name}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${vp.name}-landing.png`, fullPage: true });
    await page.goto("/new");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${vp.name}-new.png`, fullPage: true });
    await page.goto("/");
    await page.getByRole("button", { name: "Try the demo" }).first().click();
    await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
    const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
    const run = await page.evaluate(async (id) => (await (await fetch(`/api/workspaces/${id}/runs/latest`)).json()).run?.id, ws);
    await page.goto(`/w/${ws}/runs/${run}`);
    await expect(page.getByText("How this ledger was built")).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${vp.name}-run.png`, fullPage: true });
    await page.goto(`/w/${ws}/sources`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/${vp.name}-sources.png`, fullPage: false });
  });
}
