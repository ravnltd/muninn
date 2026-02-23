import { e as escape_html } from "../../../../chunks/index2.js";
import "clsx";
import "@sveltejs/kit/internal";
import "../../../../chunks/exports.js";
import "../../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../../chunks/root.js";
import "../../../../chunks/state.svelte.js";
import { a as api, A as ApiError } from "../../../../chunks/api.js";
import { g as getAuth } from "../../../../chunks/auth.svelte.js";
import { H as Header } from "../../../../chunks/Header.js";
import { C as Card } from "../../../../chunks/Card.js";
import { B as Button } from "../../../../chunks/Button.js";
import { B as Badge } from "../../../../chunks/Badge.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const auth = getAuth();
    let loading = false;
    let error = "";
    async function upgrade() {
      loading = true;
      error = "";
      try {
        const { url } = await api.createCheckout();
        window.location.href = url;
      } catch (err) {
        error = err instanceof ApiError ? err.message : "Failed to start checkout";
        loading = false;
      }
    }
    async function manage() {
      loading = true;
      error = "";
      try {
        const { url } = await api.openPortal();
        window.location.href = url;
      } catch (err) {
        error = err instanceof ApiError ? err.message : "Failed to open billing portal";
        loading = false;
      }
    }
    $$renderer2.push(`<div class="max-w-4xl space-y-8">`);
    Header($$renderer2, {
      title: "Billing",
      description: "Manage your subscription and payment method."
    });
    $$renderer2.push(`<!----> `);
    {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (error) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">${escape_html(error)}</div>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--> `);
    Card($$renderer2, {
      children: ($$renderer3) => {
        $$renderer3.push(`<div class="flex items-start justify-between"><div><h3 class="font-semibold mb-1">Current plan</h3> <div class="flex items-center gap-3"><span class="text-3xl font-bold">${escape_html(auth.tenant?.plan === "pro" ? "$6.50" : "$0")}</span> <span class="text-zinc-500">/month</span> `);
        Badge($$renderer3, {
          variant: auth.tenant?.plan === "pro" ? "success" : "default",
          children: ($$renderer4) => {
            $$renderer4.push(`<!---->${escape_html(auth.tenant?.plan ?? "free")}`);
          }
        });
        $$renderer3.push(`<!----></div></div></div> <div class="mt-6 pt-6 border-t border-zinc-800">`);
        if (auth.tenant?.plan === "free") {
          $$renderer3.push("<!--[-->");
          $$renderer3.push(`<div class="space-y-4"><div><h4 class="text-sm font-medium mb-2">Upgrade to Pro</h4> <ul class="space-y-1.5 text-sm text-zinc-400"><li>100,000 tool calls / month (10x more)</li> <li>Unlimited projects</li> <li>Team collaboration, SSO, BYOD</li> <li>Priority support</li></ul></div> `);
          Button($$renderer3, {
            onclick: upgrade,
            loading,
            disabled: loading,
            children: ($$renderer4) => {
              $$renderer4.push(`<!---->${escape_html(loading ? "Redirecting..." : "Upgrade to Pro — $6.50/mo")}`);
            }
          });
          $$renderer3.push(`<!----></div>`);
        } else {
          $$renderer3.push("<!--[!-->");
          Button($$renderer3, {
            variant: "secondary",
            onclick: manage,
            loading,
            disabled: loading,
            children: ($$renderer4) => {
              $$renderer4.push(`<!---->${escape_html(loading ? "Opening..." : "Manage subscription")}`);
            }
          });
        }
        $$renderer3.push(`<!--]--></div>`);
      }
    });
    $$renderer2.push(`<!----></div>`);
  });
}
export {
  _page as default
};
