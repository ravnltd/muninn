/**
 * OAuth Authorization Page
 *
 * Renders login + consent form for the OAuth authorization flow.
 * Inline styles via Tailwind CDN — no build step needed.
 */

interface AuthorizePageParams {
  clientId: string;
  clientName?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  error?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderAuthorizePage(params: AuthorizePageParams): string {
  const errorHtml = params.error
    ? `<div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">${escapeHtml(params.error)}</div>`
    : "";

  const appName = params.clientName ? escapeHtml(params.clientName) : "An application";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in — Muninn</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-16 h-16 bg-zinc-800 rounded-2xl mb-4">
        <svg class="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
        </svg>
      </div>
      <h1 class="text-xl font-semibold text-white">Sign in to Muninn</h1>
      <p class="text-zinc-400 text-sm mt-1">${appName} wants to access your memory tools</p>
    </div>

    <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      ${errorHtml}
      <form method="POST" action="/auth/authorize" class="space-y-4">
        <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}">
        <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
        <input type="hidden" name="state" value="${escapeHtml(params.state)}">
        <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
        <input type="hidden" name="scope" value="${escapeHtml(params.scope)}">

        <div>
          <label class="block text-sm font-medium text-zinc-300 mb-1" for="email">Email</label>
          <input
            type="email" id="email" name="email" required autofocus
            class="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            placeholder="you@example.com"
          >
        </div>

        <div>
          <label class="block text-sm font-medium text-zinc-300 mb-1" for="password">Password</label>
          <input
            type="password" id="password" name="password" required
            class="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            placeholder="Your password"
          >
        </div>

        <div class="bg-zinc-800 rounded-lg p-3 text-sm">
          <p class="text-zinc-400">This will grant access to:</p>
          <ul class="mt-1 text-zinc-300 space-y-1">
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
              Read and write project memory
            </li>
            <li class="flex items-center gap-2">
              <svg class="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
              Use all muninn tools
            </li>
          </ul>
        </div>

        <button
          type="submit"
          class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
        >
          Authorize
        </button>
      </form>

      <p class="text-center text-xs text-zinc-500 mt-4">
        Don't have an account? <a href="https://muninn.pro" class="text-emerald-400 hover:underline">Sign up</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function renderAuthorizeError(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — Muninn</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
  <div class="w-full max-w-sm text-center">
    <div class="inline-flex items-center justify-center w-16 h-16 bg-red-900/30 rounded-2xl mb-4">
      <svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>
    </div>
    <h1 class="text-xl font-semibold text-white mb-2">Authorization Error</h1>
    <p class="text-zinc-400">${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}
