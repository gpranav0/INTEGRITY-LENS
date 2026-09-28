import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
test("complete local import → analysis → evidence → decision → report lifecycle", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Look beyond the score. Understand the evidence.",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Explore demo workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity goes a long way." }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Import documents", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import documents", exact: true })
    .click();
  await page.getByLabel("Identifier", { exact: true }).fill("TEST-001");
  await page.getByLabel("Document title").fill("Test garden submission");
  await page
    .getByLabel("Paste document text")
    .fill(
      "Community gardens create shared spaces where residents exchange knowledge and build lasting relationships. Access to green space can strengthen neighborhood connections through repeated informal encounters.",
    );
  await page.getByRole("button", { name: "Add pasted document" }).click();
  await expect(
    page.getByRole("button", { name: /Test garden submission/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Similarity analysis", exact: true })
    .click();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(
    page.getByText("Analysis complete. Evidence and rankings are ready."),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Inspect", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence Explorer", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".passage")).not.toHaveCount(0);
  await page.locator("body").click({ position: { x: 260, y: 90 } });
  await page.keyboard.press("j");
  await expect(
    page.getByRole("heading", { name: /Passage 2 of/ }),
  ).toBeVisible();
  await page.keyboard.press("k");
  await expect(
    page.getByRole("heading", { name: /Passage 1 of/ }),
  ).toBeVisible();
  await page.getByLabel("Demo role", { exact: true }).selectOption("Reviewer");
  await expect(
    page
      .getByText("Author hidden · blind review demo", { exact: false })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open review case" }).click();
  await expect(
    page.getByRole("heading", { name: "Review cases", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reviewer note", { exact: true })
    .fill("Review opened with contextual evidence.");
  await page.getByRole("button", { name: "Move to Under review" }).click();
  await page
    .getByLabel("Reviewer note", { exact: true })
    .fill("Discuss quotation and collaboration permissions.");
  await page.getByRole("button", { name: "Move to Needs discussion" }).click();
  await page.getByRole("button", { name: "Move to Resolved" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "A justification is required to resolve this case.",
  );
  await page
    .getByLabel("Resolution justification")
    .fill(
      "The overlap is explained by permitted collaboration. No misconduct finding is made.",
    );
  await page.getByRole("button", { name: "Move to Resolved" }).click();
  await page
    .getByLabel("Reviewer note", { exact: true })
    .fill("Review and contextual discussion complete.");
  await page.getByRole("button", { name: "Move to Closed" }).click();
  await expect(
    page.getByText("This local review is closed.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create a report" }).click();
  await expect(
    page.getByRole("heading", { name: "Academic similarity review" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML" }).click();
  expect((await download).suggestedFilename()).toContain("integritylens-");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Academic similarity review" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Test garden submission/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    requests.filter(
      (url) =>
        !url.startsWith("http://127.0.0.1:5173") && !url.startsWith("blob:"),
    ),
  ).toEqual([]);
});
test("individual invalid files, local persistence, and confirmed reset", async ({
  page,
}) => {
  await page.goto("/documents");
  await page
    .getByRole("button", { name: "Import documents", exact: true })
    .click();
  await page.getByLabel("Choose text files").setInputFiles([
    {
      name: "GOOD-001.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "This is a valid imported fictional teaching document.",
      ),
    },
    {
      name: "BAD-001.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([0xc3, 0x28]),
    },
    { name: "EMPTY.txt", mimeType: "text/plain", buffer: Buffer.from("") },
  ]);
  await expect(
    page.getByText("GOOD-001.txt: imported", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "BAD-001.txt: Invalid UTF-8 encoding. Save this file as UTF-8 text.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("EMPTY.txt: The document is empty."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /GOOD-001/ })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("unrelated-app", "keep"));
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset demo workspace" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep my workspace" }).click();
  await page.getByRole("button", { name: "Reset demo workspace" }).click();
  await page.getByRole("button", { name: "Reset IntegrityLens data" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/documents");
  await expect(page.getByRole("button", { name: /GOOD-001/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("unrelated-app"))).toBe(
    "keep",
  );
});
test("all actual algorithm traces, graph, settings, and cancellation controls", async ({
  page,
}) => {
  await page.goto("/lab");
  for (const name of [
    "KMP",
    "Rabin–Karp",
    "Z-algorithm",
    "Aho–Corasick",
    "LCS",
    "Edit distance",
    "AVL rotations",
    "B-tree splits",
    "Union-find",
    "Dijkstra",
    "Max-flow",
  ]) {
    await page
      .locator(".algorithm-list")
      .getByRole("button", { name, exact: false })
      .click();
    await expect(page.locator(".lab-output")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page.locator(".trace-stage .eyebrow")).toContainText("STEP 2");
    await page.getByRole("button", { name: "Reset trace" }).click();
  }
  await page.goto("/analysis");
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(
    page.getByText("Analysis complete. Evidence and rankings are ready."),
  ).toBeVisible();
  await page.goto("/network");
  await expect(page.locator(".graph canvas").first()).toBeVisible();
  await page.getByLabel("Minimum spanning forest").check();
  await page.getByText("Accessible relationship list", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect SUB-001" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inspect SUB-001" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "system", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    /light|dark/,
  );
});
test("360px navigation, keyboard focus, and page layouts", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "A little clarity goes a long way." }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Document library" }),
  ).toBeVisible();
  for (const path of [
    "/",
    "/dashboard",
    "/documents",
    "/analysis",
    "/network",
    "/cases",
    "/reports",
    "/lab",
    "/settings",
    "/help",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
