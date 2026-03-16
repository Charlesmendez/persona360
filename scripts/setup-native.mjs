#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function read(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: false
  });
}

const versionResult = read("pnpm", ["--version"]);
const pnpmVersion = (versionResult.stdout ?? "").trim();

console.log(`Detected pnpm ${pnpmVersion || "unknown"}.`);

const approveHelp = read("pnpm", ["approve-builds", "--help"]);
const approveHelpText = `${approveHelp.stdout ?? ""}\n${approveHelp.stderr ?? ""}`;
const supportsApproveBuilds = approveHelp.status === 0;
const supportsApproveAll = approveHelpText.includes("--all");

if (supportsApproveBuilds && supportsApproveAll) {
  console.log("Approving pending native builds...");
  run("pnpm", ["approve-builds", "--all"]);
  console.log("Rebuilding native dependencies...");
  run("pnpm", ["rebuild", "better-sqlite3", "esbuild"]);
  process.exit(0);
}

console.log("This pnpm version does not support `pnpm approve-builds --all`.");
console.log("Trying a direct rebuild...");

const rebuild = spawnSync("pnpm", ["rebuild", "better-sqlite3", "esbuild"], {
  stdio: "inherit",
  shell: false
});

if (rebuild.status === 0) {
  console.log("Native dependencies rebuilt successfully.");
  process.exit(0);
}

console.error("");
console.error("Native dependency setup needs one of these fixes:");
console.error("1. Upgrade pnpm to >= 10.32.0, then rerun `pnpm setup:native`.");
console.error("2. Or run `pnpm install --dangerously-allow-all-builds` and then `pnpm rebuild better-sqlite3 esbuild`.");

process.exit(rebuild.status ?? 1);
