import { c as attr_class, d as stringify } from "./index2.js";
function Badge($$renderer, $$props) {
  let { variant = "default", children } = $$props;
  const variants = {
    default: "bg-zinc-800 text-zinc-300",
    success: "bg-emerald-500/10 text-emerald-400",
    warning: "bg-amber-500/10 text-amber-400",
    danger: "bg-red-500/10 text-red-400"
  };
  $$renderer.push(`<span${attr_class(`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stringify(variants[variant])}`)}>`);
  children($$renderer);
  $$renderer.push(`<!----></span>`);
}
export {
  Badge as B
};
