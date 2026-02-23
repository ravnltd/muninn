import { e as escape_html, i as derived } from "../../../chunks/index2.js";
import { g as getAuth } from "../../../chunks/auth.svelte.js";
import { H as Header, C as Card } from "../../../chunks/Card.js";
import "clsx";
import { C as CodeBlock } from "../../../chunks/CodeBlock.js";
function StatCard($$renderer, $$props) {
  let { label, value, subtitle } = $$props;
  $$renderer.push(`<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6"><p class="text-sm text-zinc-400 mb-1">${escape_html(label)}</p> <p class="text-3xl font-bold tracking-tight">${escape_html(value)}</p> `);
  if (subtitle) {
    $$renderer.push("<!--[-->");
    $$renderer.push(`<p class="text-sm text-zinc-500 mt-1">${escape_html(subtitle)}</p>`);
  } else {
    $$renderer.push("<!--[!-->");
  }
  $$renderer.push(`<!--]--></div>`);
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const auth = getAuth();
    const setupCommand = derived(() => `claude mcp add --scope user muninn \\
  -- npx -y muninn-mcp@latest \\
  --cloud YOUR_API_KEY`);
    $$renderer2.push(`<div class="max-w-4xl space-y-8">`);
    Header($$renderer2, { title: "Overview", description: "Welcome back." });
    $$renderer2.push(`<!----> <div class="grid sm:grid-cols-3 gap-4">`);
    StatCard($$renderer2, {
      label: "Plan",
      value: auth.tenant?.plan === "pro" ? "Pro" : "Free",
      subtitle: auth.tenant?.plan === "free" ? "Upgrade for more" : "Active subscription"
    });
    $$renderer2.push(`<!----> `);
    StatCard($$renderer2, {
      label: "Tool calls this month",
      value: "...",
      subtitle: ""
    });
    $$renderer2.push(`<!----> `);
    StatCard($$renderer2, { label: "Period", value: "..." });
    $$renderer2.push(`<!----></div> `);
    {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--> `);
    Card($$renderer2, {
      children: ($$renderer3) => {
        $$renderer3.push(`<h3 class="font-semibold mb-1">Quick setup</h3> <p class="text-sm text-zinc-400 mb-4">Add Muninn to Claude Code on any machine:</p> `);
        CodeBlock($$renderer3, { code: setupCommand() });
        $$renderer3.push(`<!---->`);
      }
    });
    $$renderer2.push(`<!----> <div class="grid sm:grid-cols-3 gap-4"><a href="/dashboard/api-keys" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"><p class="text-sm font-medium">API Keys</p> <p class="text-xs text-zinc-500 mt-1">Manage access tokens</p></a> <a href="/dashboard/team" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"><p class="text-sm font-medium">Team</p> <p class="text-xs text-zinc-500 mt-1">Invite collaborators</p></a> <a href="/dashboard/billing" class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"><p class="text-sm font-medium">Billing</p> <p class="text-xs text-zinc-500 mt-1">Manage subscription</p></a></div></div>`);
  });
}
export {
  _page as default
};
