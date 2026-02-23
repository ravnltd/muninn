import "clsx";
import { H as Header } from "../../../../../chunks/Header.js";
import { S as Spinner } from "../../../../../chunks/Spinner.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div class="max-w-[900px] mx-auto space-y-8">`);
    Header($$renderer2, {
      title: "Session Timeline",
      description: "Track your coding sessions and their outcomes"
    });
    $$renderer2.push(`<!----> `);
    {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="flex items-center justify-center py-12">`);
      Spinner($$renderer2, { size: "lg" });
      $$renderer2.push(`<!----></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
