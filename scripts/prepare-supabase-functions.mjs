import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(
  root,
  "backend/supabase/functions/_shared/workspace",
);

const files = [
  ["packages/shared/src/index.ts", "shared/index.ts"],
  ["packages/shared/src/backend.ts", "shared/backend.ts"],
  ["packages/engine/src/index.ts", "engine/index.ts"],
  ["packages/engine/src/algorithms.ts", "engine/algorithms.ts"],
  ["packages/engine/src/structures.ts", "engine/structures.ts"],
];

for (const [source, target] of files) {
  const output = resolve(destination, target);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(root, source), output);
}

console.log("Prepared self-contained Supabase function sources.");
