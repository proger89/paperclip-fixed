#!/usr/bin/env node
/**
 * check-forbidden-tokens.mjs
 *
 * Scans the codebase for forbidden tokens before publishing to npm.
 * Mirrors the git pre-commit hook logic, but runs against the full
 * working tree (not just staged changes).
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveForbiddenTokens,
  resolveRepoPaths,
  runForbiddenTokenCheck,
} from "./check-forbidden-tokens-lib.mjs";

function main() {
  const { repoRoot, tokensFile } = resolveRepoPaths();
  const tokens = resolveForbiddenTokens(tokensFile);
  process.exit(runForbiddenTokenCheck({ repoRoot, tokens }));
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
