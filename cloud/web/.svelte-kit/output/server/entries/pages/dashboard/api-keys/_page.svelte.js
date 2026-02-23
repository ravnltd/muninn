import { a as ensure_array_like, e as escape_html } from "../../../../chunks/index2.js";
import { a as api, A as ApiError } from "../../../../chunks/api.js";
import { D as DataTable, f as formatDateTime } from "../../../../chunks/DataTable.js";
import { H as Header, C as Card } from "../../../../chunks/Card.js";
import { B as Button } from "../../../../chunks/Button.js";
import { I as Input } from "../../../../chunks/Input.js";
import { M as Modal } from "../../../../chunks/Modal.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let keys = [];
    let newKeyName = "";
    let creating = false;
    let revokeTarget = null;
    let error = "";
    async function loadKeys() {
      try {
        const res = await api.getKeys();
        keys = res.keys;
      } catch {
      }
    }
    async function revokeKey() {
      if (!revokeTarget) return;
      try {
        await api.revokeKey(revokeTarget.id);
        revokeTarget = null;
        await loadKeys();
      } catch (err) {
        error = err instanceof ApiError ? err.message : "Failed to revoke key";
      }
    }
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      $$renderer3.push(`<div class="max-w-4xl space-y-8">`);
      Header($$renderer3, {
        title: "API Keys",
        description: "Create and manage API keys for accessing Muninn."
      });
      $$renderer3.push(`<!----> `);
      if (error) {
        $$renderer3.push("<!--[-->");
        $$renderer3.push(`<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">${escape_html(error)}</div>`);
      } else {
        $$renderer3.push("<!--[!-->");
      }
      $$renderer3.push(`<!--]--> `);
      {
        $$renderer3.push("<!--[!-->");
      }
      $$renderer3.push(`<!--]--> `);
      Card($$renderer3, {
        children: ($$renderer4) => {
          $$renderer4.push(`<h3 class="font-semibold mb-4">Create new key</h3> <form class="flex gap-3"><div class="flex-1">`);
          Input($$renderer4, {
            placeholder: "Key name (optional)",
            get value() {
              return newKeyName;
            },
            set value($$value) {
              newKeyName = $$value;
              $$settled = false;
            }
          });
          $$renderer4.push(`<!----></div> `);
          Button($$renderer4, {
            type: "submit",
            loading: creating,
            disabled: creating,
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Create`);
            }
          });
          $$renderer4.push(`<!----></form>`);
        }
      });
      $$renderer3.push(`<!----> `);
      DataTable($$renderer3, {
        columns: ["Name", "Prefix", "Created", ""],
        children: ($$renderer4) => {
          const each_array = ensure_array_like(keys);
          if (each_array.length !== 0) {
            $$renderer4.push("<!--[-->");
            for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
              let key = each_array[$$index];
              $$renderer4.push(`<tr><td class="px-6 py-3 text-zinc-300">${escape_html(key.name ?? "—")}</td><td class="px-6 py-3 font-mono text-sm text-zinc-400">${escape_html(key.prefix)}...</td><td class="px-6 py-3 text-zinc-400">${escape_html(formatDateTime(key.createdAt))}</td><td class="px-6 py-3 text-right"><button class="text-sm text-red-400 hover:text-red-300">Revoke</button></td></tr>`);
            }
          } else {
            $$renderer4.push("<!--[!-->");
            $$renderer4.push(`<tr><td colspan="4" class="px-6 py-8 text-center text-zinc-500">No API keys yet</td></tr>`);
          }
          $$renderer4.push(`<!--]-->`);
        }
      });
      $$renderer3.push(`<!----></div> `);
      {
        let actions = function($$renderer4) {
          Button($$renderer4, {
            variant: "secondary",
            onclick: () => {
              revokeTarget = null;
            },
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Cancel`);
            }
          });
          $$renderer4.push(`<!----> `);
          Button($$renderer4, {
            variant: "danger",
            onclick: revokeKey,
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Revoke`);
            }
          });
          $$renderer4.push(`<!---->`);
        };
        Modal($$renderer3, {
          open: revokeTarget !== null,
          onclose: () => {
            revokeTarget = null;
          },
          title: "Revoke API key",
          actions,
          children: ($$renderer4) => {
            $$renderer4.push(`<p class="text-sm text-zinc-400">Are you sure you want to revoke <span class="text-zinc-200 font-mono">${escape_html(revokeTarget?.prefix)}...</span>?
    Any applications using this key will lose access immediately.</p>`);
          }
        });
      }
      $$renderer3.push(`<!---->`);
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
