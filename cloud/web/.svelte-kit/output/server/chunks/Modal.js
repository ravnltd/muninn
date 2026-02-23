import { e as escape_html } from "./index2.js";
import "clsx";
function Modal($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { open, onclose, title, children, actions } = $$props;
    if (open) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true"><div class="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md shadow-2xl"><div class="flex items-center justify-between p-6 border-b border-zinc-800"><h2 class="text-lg font-semibold">${escape_html(title)}</h2> <button class="text-zinc-400 hover:text-zinc-200" aria-label="Close"><svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"></path></svg></button></div> <div class="p-6">`);
      children($$renderer2);
      $$renderer2.push(`<!----></div> `);
      if (actions) {
        $$renderer2.push("<!--[-->");
        $$renderer2.push(`<div class="flex items-center justify-end gap-3 p-6 border-t border-zinc-800">`);
        actions($$renderer2);
        $$renderer2.push(`<!----></div>`);
      } else {
        $$renderer2.push("<!--[!-->");
      }
      $$renderer2.push(`<!--]--></div></div>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
export {
  Modal as M
};
