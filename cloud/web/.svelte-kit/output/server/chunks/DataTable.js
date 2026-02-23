import { a as ensure_array_like, e as escape_html } from "./index2.js";
function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
function formatDateTime(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
function DataTable($$renderer, $$props) {
  let { columns, children, empty = "No data" } = $$props;
  $$renderer.push(`<div class="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-zinc-800"><!--[-->`);
  const each_array = ensure_array_like(columns);
  for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
    let col = each_array[$$index];
    $$renderer.push(`<th class="text-left text-zinc-400 font-medium px-6 py-3">${escape_html(col)}</th>`);
  }
  $$renderer.push(`<!--]--></tr></thead><tbody class="divide-y divide-zinc-800">`);
  children($$renderer);
  $$renderer.push(`<!----></tbody></table></div></div>`);
}
export {
  DataTable as D,
  formatDate as a,
  formatDateTime as f
};
