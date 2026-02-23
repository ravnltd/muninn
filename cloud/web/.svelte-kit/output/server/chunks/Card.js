import { e as escape_html, c as attr_class, d as stringify } from "./index2.js";
import "clsx";
function Header($$renderer, $$props) {
  let { title, description } = $$props;
  $$renderer.push(`<div class="mb-8"><h1 class="text-2xl font-bold tracking-tight">${escape_html(title)}</h1> `);
  if (description) {
    $$renderer.push("<!--[-->");
    $$renderer.push(`<p class="mt-1 text-zinc-400">${escape_html(description)}</p>`);
  } else {
    $$renderer.push("<!--[!-->");
  }
  $$renderer.push(`<!--]--></div>`);
}
function Card($$renderer, $$props) {
  let { padding = true, children } = $$props;
  $$renderer.push(`<div${attr_class(`bg-zinc-900 border border-zinc-800 rounded-xl ${stringify(padding ? "p-6" : "")}`)}>`);
  children($$renderer);
  $$renderer.push(`<!----></div>`);
}
export {
  Card as C,
  Header as H
};
