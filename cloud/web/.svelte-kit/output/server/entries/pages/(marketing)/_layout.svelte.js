import "clsx";
import { a as ensure_array_like, b as attr, c as attr_class, d as stringify, f as store_get, e as escape_html, u as unsubscribe_stores } from "../../../chunks/index2.js";
import { p as page } from "../../../chunks/stores.js";
import { B as Button } from "../../../chunks/Button.js";
function Nav($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    const links = [
      { href: "/pricing", label: "Pricing" },
      { href: "/docs", label: "Docs" }
    ];
    $$renderer2.push(`<nav class="fixed top-0 w-full z-50 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-md"><div class="max-w-6xl mx-auto flex items-center justify-between px-6 py-4"><div class="flex items-center gap-8"><a href="/" class="text-lg font-semibold tracking-tight">Muninn</a> <div class="hidden sm:flex items-center gap-6"><!--[-->`);
    const each_array = ensure_array_like(links);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let link = each_array[$$index];
      $$renderer2.push(`<a${attr("href", link.href)}${attr_class(`text-sm transition-colors ${stringify(store_get($$store_subs ??= {}, "$page", page).url.pathname === link.href ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200")}`)}>${escape_html(link.label)}</a>`);
    }
    $$renderer2.push(`<!--]--></div></div> <div class="hidden sm:flex items-center gap-4"><a href="/login" class="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Log in</a> `);
    Button($$renderer2, {
      size: "sm",
      href: "/signup",
      children: ($$renderer3) => {
        $$renderer3.push(`<!---->Sign up`);
      }
    });
    $$renderer2.push(`<!----></div> <button class="sm:hidden text-zinc-400"><svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">`);
    {
      $$renderer2.push("<!--[!-->");
      $$renderer2.push(`<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"></path>`);
    }
    $$renderer2.push(`<!--]--></svg></button></div> `);
    {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--></nav>`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
function Footer($$renderer) {
  $$renderer.push(`<footer class="border-t border-zinc-800/50 py-12 px-6"><div class="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500"><span>Built by <a href="https://github.com/ravnltd" class="text-zinc-400 hover:text-zinc-300 transition-colors">Ravn</a></span> <div class="flex items-center gap-6"><a href="/docs" class="text-zinc-400 hover:text-zinc-300 transition-colors">Docs</a> <a href="/pricing" class="text-zinc-400 hover:text-zinc-300 transition-colors">Pricing</a> <a href="https://github.com/ravnltd/muninn" class="flex items-center gap-2 text-zinc-400 hover:text-zinc-300 transition-colors"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"></path></svg> GitHub</a></div></div></footer>`);
}
function _layout($$renderer, $$props) {
  let { children } = $$props;
  Nav($$renderer);
  $$renderer.push(`<!----> <main>`);
  children($$renderer);
  $$renderer.push(`<!----></main> `);
  Footer($$renderer);
  $$renderer.push(`<!---->`);
}
export {
  _layout as default
};
