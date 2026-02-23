import { h as head, a as ensure_array_like, e as escape_html } from "../../../../chunks/index2.js";
import { B as Button } from "../../../../chunks/Button.js";
const comparisons = [
  {
    feature: "Tool calls / month",
    free: "10,000",
    pro: "100,000"
  },
  { feature: "Projects", free: "1", pro: "Unlimited" },
  { feature: "Team members", free: "1", pro: "Up to 10" },
  { feature: "BYOD (own database)", free: "—", pro: "✓" },
  { feature: "Usage analytics", free: "—", pro: "✓" },
  { feature: "SSO / SAML", free: "—", pro: "✓" },
  { feature: "Priority support", free: "—", pro: "✓" },
  { feature: "Data export", free: "✓", pro: "✓" },
  { feature: "Audit log", free: "—", pro: "✓" }
];
function _page($$renderer) {
  head("133tnjx", $$renderer, ($$renderer2) => {
    $$renderer2.title(($$renderer3) => {
      $$renderer3.push(`<title>Pricing — Muninn Cloud</title>`);
    });
  });
  $$renderer.push(`<section class="pt-36 pb-12 px-6"><div class="max-w-3xl mx-auto text-center"><h1 class="text-4xl sm:text-5xl font-bold tracking-tight">Simple, transparent pricing</h1> <p class="mt-4 text-lg text-zinc-400">Start free. Upgrade when your usage grows.</p></div></section> <section class="pb-24 px-6"><div class="max-w-4xl mx-auto"><div class="grid md:grid-cols-2 gap-6 mb-16"><div class="bg-zinc-900 border border-zinc-800 rounded-xl p-8"><div class="text-sm font-medium text-zinc-400 mb-1">Free</div> <div class="flex items-baseline gap-1 mb-6"><span class="text-4xl font-bold">$0</span> <span class="text-zinc-500">/mo</span></div> <p class="text-sm text-zinc-400 mb-6">For individual developers getting started.</p> `);
  Button($$renderer, {
    variant: "secondary",
    href: "/signup",
    children: ($$renderer2) => {
      $$renderer2.push(`<!---->Get Started`);
    }
  });
  $$renderer.push(`<!----></div> <div class="bg-zinc-900 border border-emerald-500/30 rounded-xl p-8 relative"><div class="absolute -top-3 left-8 bg-emerald-500 text-zinc-950 text-xs font-semibold px-3 py-1 rounded-full">Popular</div> <div class="text-sm font-medium text-emerald-400 mb-1">Pro</div> <div class="flex items-baseline gap-1 mb-6"><span class="text-4xl font-bold">$6.50</span> <span class="text-zinc-500">/mo</span></div> <p class="text-sm text-zinc-400 mb-6">For power users and teams who ship daily.</p> `);
  Button($$renderer, {
    href: "/signup",
    children: ($$renderer2) => {
      $$renderer2.push(`<!---->Get Started`);
    }
  });
  $$renderer.push(`<!----></div></div> <div class="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-zinc-800"><th class="text-left text-zinc-400 font-medium px-6 py-4">Feature</th><th class="text-center text-zinc-400 font-medium px-6 py-4">Free</th><th class="text-center text-emerald-400 font-medium px-6 py-4">Pro</th></tr></thead><tbody class="divide-y divide-zinc-800"><!--[-->`);
  const each_array = ensure_array_like(comparisons);
  for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
    let row = each_array[$$index];
    $$renderer.push(`<tr><td class="px-6 py-3 text-zinc-300">${escape_html(row.feature)}</td><td class="px-6 py-3 text-center text-zinc-400">${escape_html(row.free)}</td><td class="px-6 py-3 text-center text-zinc-200">${escape_html(row.pro)}</td></tr>`);
  }
  $$renderer.push(`<!--]--></tbody></table></div></div></section>`);
}
export {
  _page as default
};
