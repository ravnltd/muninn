import { c as attr_class, e as escape_html, d as stringify } from "./index2.js";
function CodeBlock($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { code, language = "bash" } = $$props;
    $$renderer2.push(`<div class="relative group"><pre class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto text-sm font-mono text-zinc-300"><code${attr_class(`language-${stringify(language)}`)}>${escape_html(code)}</code></pre> <button class="absolute top-3 right-3 p-1.5 rounded-md bg-zinc-800 text-zinc-400 hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity" title="Copy">`);
    {
      $$renderer2.push("<!--[!-->");
      $$renderer2.push(`<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"></path></svg>`);
    }
    $$renderer2.push(`<!--]--></button></div>`);
  });
}
export {
  CodeBlock as C
};
