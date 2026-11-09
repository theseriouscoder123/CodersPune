import { defineConfig, devices } from "@playwright/test";

// Runs the judge flow against production by default; point E2E_BASE_URL at http://localhost:3000 for local runs.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 45_000 }, // serverless + Neon cold starts can take a while on the first request
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://baton-lac.vercel.app",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@phone/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
});
