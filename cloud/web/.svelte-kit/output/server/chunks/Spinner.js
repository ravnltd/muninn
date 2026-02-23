import { c as attr_class, d as stringify } from "./index2.js";
function Spinner($$renderer, $$props) {
  let { size = "md" } = $$props;
  const sizes = { sm: "w-4 h-4", md: "w-6 h-6", lg: "w-8 h-8" };
  $$renderer.push(`<svg${attr_class(`${stringify(sizes[size])} animate-spin text-emerald-400`)} fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`);
}
export {
  Spinner as S
};
