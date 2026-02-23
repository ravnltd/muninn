import "clsx";
import { H as Header } from "../../../../chunks/Header.js";
import { C as Card } from "../../../../chunks/Card.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div class="max-w-4xl space-y-8">`);
    Header($$renderer2, {
      title: "Usage",
      description: "Monitor your tool call usage for the current billing period."
    });
    $$renderer2.push(`<!----> `);
    {
      $$renderer2.push("<!--[!-->");
      Card($$renderer2, {
        children: ($$renderer3) => {
          $$renderer3.push(`<p class="text-zinc-500 text-center py-8">Loading usage data...</p>`);
        }
      });
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
