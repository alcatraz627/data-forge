import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { Hono } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Serves the built web app from the API process, so production is one port
 * behind tailscale. Unknown paths fall back to index.html (SPA routing);
 * registered last so /api/* always wins. */
export function addStaticRoutes(app: Hono, dist: string): void {
  const root = resolve(dist);
  if (!existsSync(join(root, 'index.html'))) {
    console.warn(`web dist not found at ${root} — running API-only`);
    return;
  }
  app.get('*', (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    if (path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    let target = join(root, 'index.html');
    try {
      const file = resolve(root, `.${normalize(path)}`);
      if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) target = file;
    } catch {
      // malformed paths (e.g. embedded null bytes) fall back to the SPA shell
    }
    // Hashed build assets never change under the same name — cache them hard
    // (repeat opens were re-downloading ~100KB per visit). The shell files
    // must revalidate every time or a deploy stays invisible on the phone.
    const cache = target.includes(`${root}/assets/`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    return new Response(new Uint8Array(readFileSync(target)), {
      headers: {
        'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
        'cache-control': cache,
      },
    });
  });
}
