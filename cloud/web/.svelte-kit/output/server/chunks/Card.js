import { c as attr_class, d as stringify } from "./index2.js";
function Card($$renderer, $$props) {
  let { padding = true, children } = $$props;
  $$renderer.push(`<div${attr_class(`bg-zinc-900 border border-zinc-800 rounded-xl ${stringify(padding ? "p-6" : "")}`)}>`);
  children($$renderer);
  $$renderer.push(`<!----></div>`);
}
export {
  Card as C
};
