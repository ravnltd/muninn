/**
 * Static file serving helper for the dashboard.
 *
 * IMPORTANT: Hono + Bun requires explicit Content-Length when returning raw Response.
 * Using Bun.file().text() or passing Bun.file directly results in 0-byte responses.
 * Always use arrayBuffer() and set Content-Length explicitly.
 */

import { existsSync } from "node:fs";

export interface ServeFileOptions {
  contentType: string;
  cache?: "immutable" | "no-cache";
}

export async function serveStaticFile(filePath: string, options: ServeFileOptions): Promise<Response | null> {
  if (!existsSync(filePath)) return null;

  const file = Bun.file(filePath);
  const content = await file.arrayBuffer();
  const cacheControl =
    options.cache === "immutable" ? "public, max-age=31536000, immutable" : "no-cache, no-store, must-revalidate";

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": options.contentType,
      "Content-Length": String(content.byteLength),
      "Cache-Control": cacheControl,
      ...(options.cache === "no-cache" && { Pragma: "no-cache", Expires: "0" }),
    },
  });
}
