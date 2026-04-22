/**
 * Replaces the root preinstall that used `sh` (fails on Windows without Git sh).
 * Keeps: remove npm/yarn lock files; only allow pnpm.
 */
/* eslint-disable @typescript-eslint/no-require-imports, no-console */
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
for (const f of ["package-lock.json", "yarn.lock"]) {
  const p = path.join(root, f);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch (e) {
    console.error(`[preinstall] could not remove ${f}:`, e);
    process.exit(1);
  }
}

const ua = process.env.npm_config_user_agent || "";
if (!/pnpm\//.test(ua)) {
  console.error(
    "This repository must be installed with pnpm (not npm or yarn).",
  );
  process.exit(1);
}
