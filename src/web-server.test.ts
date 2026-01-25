/**
 * Web Server Tests
 * Verifies static file serving works correctly with Hono + Bun
 *
 * IMPORTANT: These tests catch the 0-byte response bug that causes white screens.
 * If any of these tests fail, static file serving is broken.
 */

import { describe, expect, test } from "bun:test";
import { createApp } from "./web-server";

describe("Static File Serving", () => {
  const app = createApp();

  async function makeRequest(path: string): Promise<Response> {
    const req = new Request(`http://localhost${path}`);
    return app.fetch(req);
  }

  test("index.html serves with content-length > 0", async () => {
    const res = await makeRequest("/");

    expect(res.status).toBe(200);

    const contentLength = res.headers.get("content-length");
    expect(contentLength).not.toBeNull();
    if (contentLength) {
      expect(parseInt(contentLength, 10)).toBeGreaterThan(0);
    }

    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("<!DOCTYPE html>");
  });

  test("JS assets serve with content-length > 0", async () => {
    // First get index.html to find the JS filename
    const indexRes = await makeRequest("/");
    const html = await indexRes.text();

    // Extract JS filename from script tag
    const jsMatch = html.match(/src="\/assets\/(index-[^"]+\.js)"/);
    if (!jsMatch) {
      console.log("No JS file referenced in index.html, skipping test");
      return;
    }

    const jsPath = `/assets/${jsMatch[1]}`;
    const res = await makeRequest(jsPath);

    expect(res.status).toBe(200);

    const contentLength = res.headers.get("content-length");
    expect(contentLength).not.toBeNull();
    if (contentLength) {
      expect(parseInt(contentLength, 10)).toBeGreaterThan(0);
    }

    // Verify it's actually JavaScript
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("javascript");
  });

  test("CSS assets serve with content-length > 0", async () => {
    // First get index.html to find the CSS filename
    const indexRes = await makeRequest("/");
    const html = await indexRes.text();

    // Extract CSS filename from link tag
    const cssMatch = html.match(/href="\/assets\/(index-[^"]+\.css)"/);
    if (!cssMatch) {
      console.log("No CSS file referenced in index.html, skipping test");
      return;
    }

    const cssPath = `/assets/${cssMatch[1]}`;
    const res = await makeRequest(cssPath);

    expect(res.status).toBe(200);

    const contentLength = res.headers.get("content-length");
    expect(contentLength).not.toBeNull();
    if (contentLength) {
      expect(parseInt(contentLength, 10)).toBeGreaterThan(0);
    }

    // Verify it's actually CSS
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("css");
  });

  test("API endpoints return JSON", async () => {
    const res = await makeRequest("/api/projects");

    expect(res.status).toBe(200);

    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("application/json");

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("404 for missing assets", async () => {
    const res = await makeRequest("/assets/nonexistent-12345.js");
    expect(res.status).toBe(404);
  });
});

describe("Content-Length Verification", () => {
  const app = createApp();

  async function makeRequest(path: string): Promise<Response> {
    const req = new Request(`http://localhost${path}`);
    return app.fetch(req);
  }

  test("content-length header matches actual body length for HTML", async () => {
    const res = await makeRequest("/");
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    const body = await res.arrayBuffer();

    expect(body.byteLength).toBe(contentLength);
  });

  test("content-length is never zero for existing files", async () => {
    const paths = ["/"];
    const indexRes = await makeRequest("/");
    const html = await indexRes.text();

    // Add JS and CSS paths if they exist
    const jsMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    const cssMatch = html.match(/href="(\/assets\/index-[^"]+\.css)"/);

    if (jsMatch) paths.push(jsMatch[1]);
    if (cssMatch) paths.push(cssMatch[1]);

    for (const path of paths) {
      const res = await makeRequest(path);
      const contentLength = res.headers.get("content-length");

      expect(contentLength).not.toBe("0");
      expect(parseInt(contentLength || "0", 10)).toBeGreaterThan(0);
    }
  });
});
