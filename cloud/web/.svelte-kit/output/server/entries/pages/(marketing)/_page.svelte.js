import { a as ensure_array_like, b as attr, e as escape_html, h as head } from "../../../chunks/index2.js";
import "clsx";
import { B as Button } from "../../../chunks/Button.js";
function Hero($$renderer) {
  $$renderer.push(`<section class="pt-36 pb-24 px-6"><div class="max-w-3xl mx-auto text-center"><h1 class="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-tight">Persistent memory for your <span class="text-emerald-400">AI coding assistant</span></h1> <p class="mt-6 text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">Your AI forgets everything between sessions. Muninn fixes that. Decisions, patterns, file knowledge, and project context — remembered across every session, on every machine.</p> <div class="mt-10">`);
  Button($$renderer, {
    size: "lg",
    href: "/signup",
    children: ($$renderer2) => {
      $$renderer2.push(`<!---->Get Started <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"></path></svg>`);
    }
  });
  $$renderer.push(`<!----></div></div></section>`);
}
function HowItWorks($$renderer) {
  $$renderer.push(`<section class="py-24 px-6"><div class="max-w-6xl mx-auto"><h2 class="text-2xl sm:text-3xl font-bold text-center mb-4">How it works</h2> <p class="text-zinc-400 text-center mb-16 max-w-xl mx-auto">Three steps to give your AI assistant a permanent memory.</p> <div class="grid md:grid-cols-3 gap-6"><div class="bg-zinc-900 border border-zinc-800 rounded-xl p-8"><div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-5"><svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.04a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 1 1 6.364 6.364l-1.757 1.757"></path></svg></div> <div class="text-sm font-medium text-emerald-400 mb-2">Step 1</div> <h3 class="text-lg font-semibold mb-2">Connect</h3> <p class="text-zinc-400 text-sm leading-relaxed">Add the Muninn MCP server to Claude Code with a single command. No local database, no Docker, no setup.</p></div> <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-8"><div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-5"><svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"></path></svg></div> <div class="text-sm font-medium text-emerald-400 mb-2">Step 2</div> <h3 class="text-lg font-semibold mb-2">Code</h3> <p class="text-zinc-400 text-sm leading-relaxed">Your AI automatically remembers decisions, patterns, and project context. It learns your codebase over time.</p></div> <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-8"><div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-5"><svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.841m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"></path></svg></div> <div class="text-sm font-medium text-emerald-400 mb-2">Step 3</div> <h3 class="text-lg font-semibold mb-2">Ship</h3> <p class="text-zinc-400 text-sm leading-relaxed">Consistent codebase knowledge means fewer mistakes, less repetition, and faster shipping across every session.</p></div></div></div></section>`);
}
function Features($$renderer) {
  const features = [
    {
      title: "Project memory",
      description: "Full-text and semantic search across your project's accumulated knowledge. Query what matters, when it matters.",
      icon: "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
    },
    {
      title: "Decision tracking",
      description: "Record architectural decisions with reasoning. Your AI will never contradict a past choice or repeat a resolved debate.",
      icon: "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
    },
    {
      title: "File knowledge",
      description: "Track purpose, fragility, and relationships for every file. Your AI knows what is safe to change and what is not.",
      icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
    },
    {
      title: "Pattern recognition",
      description: "Learnings and conventions are saved automatically. Your AI applies your team's preferred patterns from day one.",
      icon: "M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
    },
    {
      title: "Session continuity",
      description: "Pick up exactly where you left off. Session goals, outcomes, and next steps carry forward automatically.",
      icon: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
    },
    {
      title: "Multi-machine sync",
      description: "One hosted database for all your machines. Same memory on your laptop, desktop, and CI — no local setup required.",
      icon: "M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z"
    }
  ];
  $$renderer.push(`<section class="py-24 px-6 border-t border-zinc-800/50"><div class="max-w-6xl mx-auto"><h2 class="text-2xl sm:text-3xl font-bold text-center mb-4">Everything your AI needs to remember</h2> <p class="text-zinc-400 text-center mb-16 max-w-xl mx-auto">A complete memory layer purpose-built for AI-assisted development.</p> <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"><!--[-->`);
  const each_array = ensure_array_like(features);
  for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
    let f = each_array[$$index];
    $$renderer.push(`<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6"><svg class="w-5 h-5 text-emerald-400 mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round"${attr("d", f.icon)}></path></svg> <h3 class="font-semibold mb-1.5">${escape_html(f.title)}</h3> <p class="text-sm text-zinc-400 leading-relaxed">${escape_html(f.description)}</p></div>`);
  }
  $$renderer.push(`<!--]--></div></div></section>`);
}
const freeFeatures = [
  "10,000 tool calls / month",
  "1 project",
  "Community support"
];
const proFeatures = [
  "100,000 tool calls / month",
  "Unlimited projects",
  "Priority support",
  "Usage analytics",
  "Team collaboration",
  "BYOD (bring your own database)"
];
function PricingCards($$renderer, $$props) {
  let { showCta = true } = $$props;
  $$renderer.push(`<section class="py-24 px-6 border-t border-zinc-800/50"><div class="max-w-4xl mx-auto"><h2 class="text-2xl sm:text-3xl font-bold text-center mb-4">Simple pricing</h2> <p class="text-zinc-400 text-center mb-16 max-w-xl mx-auto">Start free. Upgrade when your usage grows.</p> <div class="grid md:grid-cols-2 gap-6"><div class="bg-zinc-900 border border-zinc-800 rounded-xl p-8"><div class="text-sm font-medium text-zinc-400 mb-1">Free</div> <div class="flex items-baseline gap-1 mb-6"><span class="text-4xl font-bold">$0</span> <span class="text-zinc-500">/mo</span></div> <ul class="space-y-3 mb-8"><!--[-->`);
  const each_array = ensure_array_like(freeFeatures);
  for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
    let f = each_array[$$index];
    $$renderer.push(`<li class="flex items-center gap-3 text-sm text-zinc-300"><svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"></path></svg> ${escape_html(f)}</li>`);
  }
  $$renderer.push(`<!--]--></ul> `);
  if (showCta) {
    $$renderer.push("<!--[-->");
    Button($$renderer, {
      variant: "secondary",
      href: "/signup",
      children: ($$renderer2) => {
        $$renderer2.push(`<!---->Get Started`);
      }
    });
  } else {
    $$renderer.push("<!--[!-->");
  }
  $$renderer.push(`<!--]--></div> <div class="bg-zinc-900 border border-emerald-500/30 rounded-xl p-8 relative"><div class="absolute -top-3 left-8 bg-emerald-500 text-zinc-950 text-xs font-semibold px-3 py-1 rounded-full">Popular</div> <div class="text-sm font-medium text-emerald-400 mb-1">Pro</div> <div class="flex items-baseline gap-1 mb-6"><span class="text-4xl font-bold">$6.50</span> <span class="text-zinc-500">/mo</span></div> <ul class="space-y-3 mb-8"><!--[-->`);
  const each_array_1 = ensure_array_like(proFeatures);
  for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
    let f = each_array_1[$$index_1];
    $$renderer.push(`<li class="flex items-center gap-3 text-sm text-zinc-300"><svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"></path></svg> ${escape_html(f)}</li>`);
  }
  $$renderer.push(`<!--]--></ul> `);
  if (showCta) {
    $$renderer.push("<!--[-->");
    Button($$renderer, {
      href: "/signup",
      children: ($$renderer2) => {
        $$renderer2.push(`<!---->Get Started`);
      }
    });
  } else {
    $$renderer.push("<!--[!-->");
  }
  $$renderer.push(`<!--]--></div></div></div></section>`);
}
function _page($$renderer) {
  head("skv6c4", $$renderer, ($$renderer2) => {
    $$renderer2.title(($$renderer3) => {
      $$renderer3.push(`<title>Muninn Cloud — Persistent Memory for AI Coding Assistants</title>`);
    });
  });
  Hero($$renderer);
  $$renderer.push(`<!----> `);
  HowItWorks($$renderer);
  $$renderer.push(`<!----> `);
  Features($$renderer);
  $$renderer.push(`<!----> `);
  PricingCards($$renderer, {});
  $$renderer.push(`<!---->`);
}
export {
  _page as default
};
