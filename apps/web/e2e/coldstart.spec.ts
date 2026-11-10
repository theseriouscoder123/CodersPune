import { expect, test, type Page } from "@playwright/test";

/** Cold-start check (not part of the suite): COLD=1 pnpm exec playwright test e2e/coldstart.spec.ts --project desktop */
test.skip(!process.env.COLD, "cold-start check only");

async function vitals(page: Page) {
  return page.evaluate(async () => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const lcp = await new Promise<number>((res) => {
      let v = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => res(v), 800);
    });
    return { ttfb: Math.round(nav.responseStart), domReady: Math.round(nav.domContentLoadedEventEnd), lcp: Math.round(lcp),
      transferKB: Math.round(performance.getEntriesByType("resource").reduce((a, r) => a + ((r as PerformanceResourceTiming).transferSize || 0), 0) / 1024) };
  });
}

for (const net of ["fast", "slow3g"] as const) {
  test(`first visit on ${net} network`, async ({ page, context }) => {
    test.setTimeout(240_000);
    if (net === "slow3g") {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 });
    }
    const t0 = Date.now();
    await page.goto("/", { waitUntil: "load" });
    const landing = await vitals(page);
    const t1 = Date.now();
    await page.getByRole("button", { name: "Try the demo" }).first().click();
    await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
    await expect(page.getByRole("heading", { name: "Connected sources" })).toBeVisible({ timeout: 120_000 });
    const demoReady = Date.now() - t1;
    const ws = page.url().match(/\/w\/([0-9a-f-]+)\//)![1];
    const t2 = Date.now();
    await page.goto(`/w/${ws}/review`);
    await expect(page.getByTestId("claim-list").locator("li").first()).toBeVisible({ timeout: 120_000 });
    const ledgerReady = Date.now() - t2;
    console.log(`[cold:${net}] landing load ${Date.now() - t0 - demoReady - ledgerReady}ms ttfb=${landing.ttfb} lcp=${landing.lcp} transfer=${landing.transferKB}KB | demo ready ${demoReady}ms | claims list ${ledgerReady}ms`);

    // a returning visitor (new tab, same browser) lands in the SAME copy
    const p2 = await context.newPage();
    await p2.goto("/");
    await p2.getByRole("button", { name: "Try the demo" }).first().click();
    await p2.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
    expect(p2.url()).toContain(ws);
    console.log(`[cold:${net}] returning visitor reuses their copy: yes`);
  });
}

test("someone else's workspace link explains itself", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).first().click();
  await page.waitForURL(/\/w\/[0-9a-f-]+\/sources/);
  const url = page.url();
  const other = await (await browser.newContext()).newPage();
  await other.goto(url);
  await other.waitForTimeout(4000);
  console.log(`[cold:shared-link] ${(await other.locator("main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 240)}`);
});
