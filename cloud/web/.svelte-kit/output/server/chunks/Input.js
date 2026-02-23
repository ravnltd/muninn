import { b as attr, e as escape_html, c as attr_class, ad as bind_props, d as stringify } from "./index2.js";
function Input($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      type = "text",
      id,
      name,
      value = "",
      placeholder,
      required = false,
      disabled = false,
      label,
      error,
      oninput
    } = $$props;
    $$renderer2.push(`<div>`);
    if (label) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<label${attr("for", id)} class="block text-sm font-medium text-zinc-300 mb-1.5">${escape_html(label)}</label>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--> <input${attr("type", type)}${attr("id", id)}${attr("name", name)}${attr("value", value)}${attr("placeholder", placeholder)}${attr("required", required, true)}${attr("disabled", disabled, true)}${attr_class(`w-full px-3 py-2 bg-zinc-800 border rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent ${stringify(error ? "border-red-500" : "border-zinc-700")}`)}/> `);
    if (error) {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<p class="mt-1 text-sm text-red-400">${escape_html(error)}</p>`);
    } else {
      $$renderer2.push("<!--[!-->");
    }
    $$renderer2.push(`<!--]--></div>`);
    bind_props($$props, { value });
  });
}
export {
  Input as I
};
