import { a as ensure_array_like, f as store_get, b as attr, c as attr_class, e as escape_html, u as unsubscribe_stores, d as stringify } from "../../../../chunks/index2.js";
import { p as page } from "../../../../chunks/stores.js";
function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    let { children } = $$props;
    const tabs = [
      { href: "/dashboard/knowledge", label: "Browser" },
      { href: "/dashboard/knowledge/graph", label: "Graph" },
      { href: "/dashboard/knowledge/timeline", label: "Timeline" },
      { href: "/dashboard/knowledge/reports", label: "Reports" }
    ];
    $$renderer2.push(`<div class="space-y-6"><nav class="flex gap-1 border-b border-zinc-800 pb-px"><!--[-->`);
    const each_array = ensure_array_like(tabs);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let tab = each_array[$$index];
      const active = store_get($$store_subs ??= {}, "$page", page).url.pathname === tab.href;
      $$renderer2.push(`<a${attr("href", tab.href)}${attr_class(`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${stringify(active ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-600")}`)}>${escape_html(tab.label)}</a>`);
    }
    $$renderer2.push(`<!--]--></nav> `);
    children($$renderer2);
    $$renderer2.push(`<!----></div>`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
export {
  _layout as default
};
