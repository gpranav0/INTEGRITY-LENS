import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const theme of ["light", "dark"])
  test(`populated pages pass automated WCAG A/AA checks in ${theme} theme`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.addInitScript(
      (theme) =>
        localStorage.setItem("integritylens:theme", JSON.stringify(theme)),
      theme,
    );
    await page.goto("/analysis");
    await page
      .getByRole("button", { name: "Run analysis", exact: true })
      .click();
    await page
      .getByText("Analysis complete. Evidence and rankings are ready.")
      .waitFor();
    await page
      .getByRole("link", { name: "Inspect", exact: true })
      .first()
      .click();
    const evidence = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Open review case" }).click();
    for (const path of [
      "/",
      "/dashboard",
      "/documents",
      "/analysis",
      evidence,
      "/network",
      "/cases",
      "/reports",
      "/lab",
      "/settings",
      "/help",
    ]) {
      await page.goto(path);
      await page.locator("h1").first().waitFor();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            reason: n.failureSummary,
          })),
        })),
        `${theme} ${path}`,
      ).toEqual([]);
    }
  });
