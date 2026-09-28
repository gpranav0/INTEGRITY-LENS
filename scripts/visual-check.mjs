import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
mkdirSync("docs/screenshots", { recursive: true });
await page.goto("http://127.0.0.1:5173/dashboard");
await page.getByRole("button", { name: "Run analysis", exact: true }).click();
await page
  .getByText("Analysis complete. Evidence and rankings are ready.")
  .waitFor();
await page.getByRole("button", { name: "Dismiss notification" }).click();
await page.screenshot({
  path: "docs/screenshots/dashboard-desktop.png",
  fullPage: true,
});
await page.goto("http://127.0.0.1:5173/");
await page.getByRole("link", { name: "Explore demo workspace" }).waitFor();
await page.screenshot({
  path: "docs/screenshots/landing-desktop.png",
  fullPage: true,
});
await page.goto("http://127.0.0.1:5173/analysis");
await page.getByRole("link", { name: "Inspect", exact: true }).first().click();
await page
  .getByRole("heading", { name: "Evidence Explorer", exact: true })
  .waitFor();
await page.screenshot({
  path: "docs/screenshots/evidence-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 360, height: 800 });
await page.goto("http://127.0.0.1:5173/dashboard");
await page
  .getByRole("heading", { name: "A little clarity goes a long way." })
  .waitFor();
await page.screenshot({
  path: "docs/screenshots/dashboard-mobile.png",
  fullPage: true,
});
await browser.close();
console.log("Visual review screenshots saved to docs/screenshots.");
