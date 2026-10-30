import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFilePath, loadConfig } from "../../src/config/index";

const ENV_KEYS = ["MUNINN_HOME", "MUNINN_MODE", "MUNINN_PRIMARY_URL", "MUNINN_AUTH_TOKEN"] as const;

describe("loadConfig resolution: env → config.json → default", () => {
  let dir: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    dir = mkdtempSync(join(tmpdir(), "muninn-config-"));
    process.env.MUNINN_HOME = dir;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("defaults to local with no env and no file", () => {
    expect(loadConfig().mode).toBe("local");
  });

  test("reads mode and url from config.json when env is unset (hook environment)", () => {
    writeFileSync(configFilePath(), JSON.stringify({ mode: "http", primaryUrl: "http://127.0.0.1:8081" }));
    const config = loadConfig();
    expect(config.mode).toBe("http");
    expect(config.primaryUrl).toBe("http://127.0.0.1:8081");
  });

  test("env overrides config.json", () => {
    writeFileSync(configFilePath(), JSON.stringify({ mode: "http", primaryUrl: "http://127.0.0.1:8081" }));
    process.env.MUNINN_MODE = "local";
    expect(loadConfig().mode).toBe("local");
  });

  test("rejects an invalid config file loudly", () => {
    writeFileSync(configFilePath(), JSON.stringify({ mode: "cloud" }));
    expect(() => loadConfig()).toThrow(/Invalid Muninn config file/);
  });
});
