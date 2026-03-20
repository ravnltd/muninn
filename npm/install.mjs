#!/usr/bin/env node

/**
 * Muninn Installer
 *
 * Installs Bun (if needed), clones the muninn repo, runs install.sh,
 * and bootstraps from git history.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const INSTALL_DIR = join(homedir(), ".local", "share", "muninn");
const REPO_URL = "https://github.com/ravnltd/muninn.git";

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
    return true;
  } catch {
    return false;
  }
}

function hasBun() {
  try {
    const result = spawnSync("bun", ["--version"], { stdio: "pipe" });
    return result.status === 0;
  } catch {
    return false;
  }
}

console.log("\n  Muninn — Persistent Memory for AI Coding Agents\n");

// Step 1: Install Bun if needed
if (!hasBun()) {
  console.log("  Installing Bun...\n");
  if (!run("curl -fsSL https://bun.sh/install | bash")) {
    console.error("\n  Failed to install Bun. Install manually: https://bun.sh\n");
    process.exit(1);
  }
  // Source bun into current PATH
  const bunDir = join(homedir(), ".bun", "bin");
  process.env.PATH = `${bunDir}:${process.env.PATH}`;
}

// Step 2: Clone or update repo
if (existsSync(INSTALL_DIR)) {
  console.log("  Updating existing installation...\n");
  run("git pull", { cwd: INSTALL_DIR });
  run("bun install", { cwd: INSTALL_DIR });
} else {
  console.log("  Cloning muninn...\n");
  if (!run(`git clone ${REPO_URL} "${INSTALL_DIR}"`)) {
    console.error("\n  Failed to clone repository.\n");
    process.exit(1);
  }
  run("bun install", { cwd: INSTALL_DIR });
}

// Step 3: Run install.sh
console.log("\n  Running installer...\n");
const installScript = join(INSTALL_DIR, "install.sh");
if (existsSync(installScript)) {
  run(`bash "${installScript}"`, { cwd: INSTALL_DIR });
}

// Step 4: Bootstrap from git history (if in a git repo)
try {
  const result = spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "pipe" });
  if (result.status === 0) {
    const muninnBin = join(homedir(), ".local", "bin", "muninn");
    if (existsSync(muninnBin)) {
      console.log("\n  Bootstrapping from git history...\n");
      run(`"${muninnBin}" init`, { cwd: process.cwd() });
    }
  }
} catch {
  // Not in a git repo, skip bootstrap
}

console.log("\n  Done! Start a coding session — Muninn auto-initializes.\n");
