import "clsx";
import { H as Header } from "../../../../../chunks/Header.js";
import { S as Spinner } from "../../../../../chunks/Spinner.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div class="max-w-5xl space-y-6">`);
    Header($$renderer2, {
      title: "Monthly Value Report",
      description: "See what Muninn has done for your project this month."
    });
    $$renderer2.push(`<!----> `);
    {
      $$renderer2.push("<!--[-->");
      $$renderer2.push(`<div class="flex items-center justify-center py-20">`);
      Spinner($$renderer2, { size: "lg" });
      $$renderer2.push(`<!----></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
