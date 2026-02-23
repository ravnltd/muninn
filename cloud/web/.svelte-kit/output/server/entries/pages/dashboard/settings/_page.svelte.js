import { e as escape_html } from "../../../../chunks/index2.js";
import "clsx";
import { a as api, A as ApiError } from "../../../../chunks/api.js";
import { g as getAuth } from "../../../../chunks/auth.svelte.js";
import { H as Header, C as Card } from "../../../../chunks/Card.js";
import { B as Button } from "../../../../chunks/Button.js";
import { I as Input } from "../../../../chunks/Input.js";
import { M as Modal } from "../../../../chunks/Modal.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const auth = getAuth();
    let dbUrl = "";
    let dbToken = "";
    let savingDb = false;
    let exporting = false;
    let deleteModal = false;
    let deleteConfirm = "";
    let deleting = false;
    let error = "";
    async function exportData() {
      exporting = true;
      try {
        const data = await api.exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `muninn-export-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        error = err instanceof ApiError ? err.message : "Export failed";
      } finally {
        exporting = false;
      }
    }
    async function deleteAccount() {
      deleting = true;
      try {
        await api.deleteAccount();
        api.logout();
      } catch (err) {
        error = err instanceof ApiError ? err.message : "Failed to delete account";
        deleting = false;
      }
    }
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      $$renderer3.push(`<div class="max-w-4xl space-y-8">`);
      Header($$renderer3, {
        title: "Settings",
        description: "Manage your account and preferences."
      });
      $$renderer3.push(`<!----> `);
      if (error) {
        $$renderer3.push("<!--[-->");
        $$renderer3.push(`<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">${escape_html(error)}</div>`);
      } else {
        $$renderer3.push("<!--[!-->");
      }
      $$renderer3.push(`<!--]--> `);
      Card($$renderer3, {
        children: ($$renderer4) => {
          $$renderer4.push(`<h3 class="font-semibold mb-4">Account</h3> <div class="space-y-3 text-sm"><div class="flex items-center justify-between"><span class="text-zinc-400">Email</span> <span class="text-zinc-200">${escape_html(auth.tenant?.email)}</span></div> <div class="flex items-center justify-between"><span class="text-zinc-400">Name</span> <span class="text-zinc-200">${escape_html(auth.tenant?.name ?? "—")}</span></div> <div class="flex items-center justify-between"><span class="text-zinc-400">Tenant ID</span> <span class="text-zinc-400 font-mono text-xs">${escape_html(auth.tenant?.id)}</span></div></div>`);
        }
      });
      $$renderer3.push(`<!----> `);
      Card($$renderer3, {
        children: ($$renderer4) => {
          $$renderer4.push(`<h3 class="font-semibold mb-1">Bring your own database</h3> <p class="text-sm text-zinc-400 mb-4">Connect your own Turso/LibSQL database for full data ownership.</p> `);
          {
            $$renderer4.push("<!--[!-->");
          }
          $$renderer4.push(`<!--]--> <form class="space-y-3">`);
          Input($$renderer4, {
            label: "Database URL",
            placeholder: "libsql://your-db.turso.io",
            get value() {
              return dbUrl;
            },
            set value($$value) {
              dbUrl = $$value;
              $$settled = false;
            }
          });
          $$renderer4.push(`<!----> `);
          Input($$renderer4, {
            type: "password",
            label: "Auth Token",
            placeholder: "Your Turso auth token",
            get value() {
              return dbToken;
            },
            set value($$value) {
              dbToken = $$value;
              $$settled = false;
            }
          });
          $$renderer4.push(`<!----> `);
          Button($$renderer4, {
            type: "submit",
            variant: "secondary",
            loading: savingDb,
            disabled: !dbUrl || !dbToken,
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Save configuration`);
            }
          });
          $$renderer4.push(`<!----></form>`);
        }
      });
      $$renderer3.push(`<!----> `);
      Card($$renderer3, {
        children: ($$renderer4) => {
          $$renderer4.push(`<h3 class="font-semibold mb-1">Export data</h3> <p class="text-sm text-zinc-400 mb-4">Download all your data in JSON format.</p> `);
          Button($$renderer4, {
            variant: "secondary",
            onclick: exportData,
            loading: exporting,
            disabled: exporting,
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->${escape_html(exporting ? "Exporting..." : "Export data")}`);
            }
          });
          $$renderer4.push(`<!---->`);
        }
      });
      $$renderer3.push(`<!----> <div class="border border-red-500/20 rounded-xl p-6"><h3 class="font-semibold text-red-400 mb-1">Danger zone</h3> <p class="text-sm text-zinc-400 mb-4">Permanently delete your account and all associated data. This cannot be undone.</p> `);
      Button($$renderer3, {
        variant: "danger",
        onclick: () => {
          deleteModal = true;
        },
        children: ($$renderer4) => {
          $$renderer4.push(`<!---->Delete account`);
        }
      });
      $$renderer3.push(`<!----></div></div> `);
      {
        let actions = function($$renderer4) {
          Button($$renderer4, {
            variant: "secondary",
            onclick: () => {
              deleteModal = false;
              deleteConfirm = "";
            },
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Cancel`);
            }
          });
          $$renderer4.push(`<!----> `);
          Button($$renderer4, {
            variant: "danger",
            onclick: deleteAccount,
            loading: deleting,
            disabled: deleteConfirm !== "DELETE" || deleting,
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Delete forever`);
            }
          });
          $$renderer4.push(`<!---->`);
        };
        Modal($$renderer3, {
          open: deleteModal,
          onclose: () => {
            deleteModal = false;
            deleteConfirm = "";
          },
          title: "Delete account",
          actions,
          children: ($$renderer4) => {
            $$renderer4.push(`<div class="space-y-4"><p class="text-sm text-zinc-400">This will permanently delete your account, all API keys, team data, and usage history. This action cannot be undone.</p> `);
            Input($$renderer4, {
              label: "Type DELETE to confirm",
              placeholder: "DELETE",
              get value() {
                return deleteConfirm;
              },
              set value($$value) {
                deleteConfirm = $$value;
                $$settled = false;
              }
            });
            $$renderer4.push(`<!----></div>`);
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
