import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, "..");
const sourceDir = path.join(serverDir, "src", "onboarding-assets");
const targetDir = path.join(serverDir, "dist", "onboarding-assets");

await fs.mkdir(targetDir, { recursive: true });
await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
