import { b as attr, c as attr_class, ae as clsx, i as derived } from "./index2.js";
function Button($$renderer, $$props) {
  let {
    variant = "primary",
    size = "md",
    disabled = false,
    loading = false,
    type = "button",
    href,
    onclick,
    children
  } = $$props;
  const base = "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 focus:ring-emerald-500",
    secondary: "border border-zinc-700 hover:border-zinc-600 text-zinc-300 hover:text-zinc-100 focus:ring-zinc-500",
    danger: "bg-red-600 hover:bg-red-500 text-white focus:ring-red-500",
    ghost: "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus:ring-zinc-500"
  };
  const sizes = {
    sm: "text-sm px-3 py-1.5",
    md: "text-sm px-4 py-2.5",
    lg: "text-base px-6 py-3"
  };
  const classes = derived(() => `${base} ${variants[variant]} ${sizes[size]}`);
  if (href) {
    $$renderer.push("<!--[-->");
    $$renderer.push(`<a${attr("href", href)}${attr_class(clsx(classes()))}>`);
    if (loading) {
      $$renderer.push("<!--[-->");
      $$renderer.push(`<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`);
    } else {
      $$renderer.push("<!--[!-->");
    }
    $$renderer.push(`<!--]--> `);
    children($$renderer);
    $$renderer.push(`<!----></a>`);
  } else {
    $$renderer.push("<!--[!-->");
    $$renderer.push(`<button${attr("type", type)}${attr("disabled", disabled || loading, true)}${attr_class(clsx(classes()))}>`);
    if (loading) {
      $$renderer.push("<!--[-->");
      $$renderer.push(`<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`);
    } else {
      $$renderer.push("<!--[!-->");
    }
    $$renderer.push(`<!--]--> `);
    children($$renderer);
    $$renderer.push(`<!----></button>`);
  }
  $$renderer.push(`<!--]-->`);
}
export {
  Button as B
};
