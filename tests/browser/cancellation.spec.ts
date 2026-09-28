import { test, expect } from "@playwright/test";
test("worker cancellation discards partial work and leaves the interface responsive", async ({
  page,
}) => {
  await page.goto("/documents");
  await page.getByRole("heading", { name: "Document library" }).waitFor();
  await page.evaluate(async () => {
    const documents = Array.from({ length: 24 }, (_, i) => ({
      id: "CANCEL-" + i,
      title: "Bounded cancellation fixture " + i,
      author: "Fictional test",
      kind: "submission",
      createdAt: "2026-09-20T00:00:00Z",
      text: Array.from(
        { length: 30 },
        (_, j) =>
          `This garden ${i} offers spaces ${j} for local people to discuss community participation and support shared environmental learning through practical activities.`,
      ).join("\n"),
    }));
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("integritylens-local-v1", 1);
      r.onsuccess = () => {
        const tx = r.result.transaction("workspace", "readwrite");
        tx.objectStore("workspace").put(
          {
            documents,
            results: [],
            cases: [],
            analyzedAt: null,
            analysisSettings: null,
          },
          "snapshot",
        );
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
  });
  await page.goto("/analysis");
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel analysis", exact: true })
    .click();
  await expect(
    page.getByText(
      "Analysis cancelled. Previously completed results are retained.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Inspect", exact: true }),
  ).toHaveCount(0);
  await page.goto("/documents");
  await expect(
    page.getByRole("button", { name: /Bounded cancellation fixture/ }),
  ).toHaveCount(24);
});
