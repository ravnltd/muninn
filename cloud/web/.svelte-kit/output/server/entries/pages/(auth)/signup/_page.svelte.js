import { h as head, e as escape_html } from "../../../../chunks/index2.js";
import "@sveltejs/kit/internal";
import "../../../../chunks/exports.js";
import "../../../../chunks/utils.js";
import "clsx";
import "@sveltejs/kit/internal/server";
import "../../../../chunks/root.js";
import "../../../../chunks/state.svelte.js";
import { B as Button } from "../../../../chunks/Button.js";
import { I as Input } from "../../../../chunks/Input.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let name = "";
    let email = "";
    let password = "";
    let loading = false;
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      head("z5wozd", $$renderer3, ($$renderer4) => {
        $$renderer4.title(($$renderer5) => {
          $$renderer5.push(`<title>Sign up — Muninn</title>`);
        });
      });
      $$renderer3.push(`<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-6">`);
      {
        $$renderer3.push("<!--[!-->");
        $$renderer3.push(`<h1 class="text-xl font-semibold text-center mb-6">Create your account</h1> `);
        {
          $$renderer3.push("<!--[!-->");
        }
        $$renderer3.push(`<!--]--> <form class="space-y-4">`);
        Input($$renderer3, {
          type: "text",
          id: "name",
          label: "Name",
          placeholder: "Your name (optional)",
          get value() {
            return name;
          },
          set value($$value) {
            name = $$value;
            $$settled = false;
          }
        });
        $$renderer3.push(`<!----> `);
        Input($$renderer3, {
          type: "email",
          id: "email",
          label: "Email",
          placeholder: "you@example.com",
          required: true,
          get value() {
            return email;
          },
          set value($$value) {
            email = $$value;
            $$settled = false;
          }
        });
        $$renderer3.push(`<!----> `);
        Input($$renderer3, {
          type: "password",
          id: "password",
          label: "Password",
          placeholder: "Min 8 characters",
          required: true,
          get value() {
            return password;
          },
          set value($$value) {
            password = $$value;
            $$settled = false;
          }
        });
        $$renderer3.push(`<!----> `);
        Button($$renderer3, {
          type: "submit",
          loading,
          disabled: loading,
          children: ($$renderer4) => {
            $$renderer4.push(`<!---->${escape_html("Create account")}`);
          }
        });
        $$renderer3.push(`<!----></form> <p class="text-center text-sm text-zinc-500 mt-4">Already have an account? <a href="/login" class="text-emerald-400 hover:underline">Sign in</a></p>`);
      }
      $$renderer3.push(`<!--]--></div>`);
    }
    do {
      $$settled = true;
      $$inner_renderer = $$renderer2.copy();
      $$render_inner($$inner_renderer);
    } while (!$$settled);
    $$renderer2.subsume($$inner_renderer);
  });
}
export {
  _page as default
};
