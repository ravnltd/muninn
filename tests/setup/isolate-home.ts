/**
 * Test preload: point HOME and MUNINN_HOME at a throwaway dir before any module
 * loads, so tests can never write to the real ~/.muninn (e.g. context/global.md).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolated = mkdtempSync(join(tmpdir(), "muninn-test-home-"));
process.env.HOME = isolated;
process.env.MUNINN_HOME = isolated;
