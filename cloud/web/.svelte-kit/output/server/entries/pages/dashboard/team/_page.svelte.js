import { a as ensure_array_like, e as escape_html } from "../../../../chunks/index2.js";
import { a as api, A as ApiError } from "../../../../chunks/api.js";
import { D as DataTable, a as formatDate } from "../../../../chunks/DataTable.js";
import { H as Header, C as Card } from "../../../../chunks/Card.js";
import { B as Button } from "../../../../chunks/Button.js";
import { I as Input } from "../../../../chunks/Input.js";
import { B as Badge } from "../../../../chunks/Badge.js";
import { M as Modal } from "../../../../chunks/Modal.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let members = [];
    let invitations = [];
    let inviteEmail = "";
    let inviteRole = "member";
    let inviting = false;
    let error = "";
    let removeTarget = null;
    async function loadAll() {
      try {
        const [m, i] = await Promise.all([api.getMembers(), api.getInvitations()]);
        members = m.members;
        invitations = i.invitations;
      } catch {
      }
    }
    async function changeRole(userId, role) {
      try {
        await api.updateMemberRole(userId, role);
        await loadAll();
      } catch (err) {
        error = err instanceof ApiError ? err.message : "Failed to update role";
      }
    }
    async function removeMember() {
      if (!removeTarget) return;
      try {
        await api.removeMember(removeTarget.id);
        removeTarget = null;
        await loadAll();
      } catch (err) {
        error = err instanceof ApiError ? err.message : "Failed to remove member";
      }
    }
    let $$settled = true;
    let $$inner_renderer;
    function $$render_inner($$renderer3) {
      $$renderer3.push(`<div class="max-w-4xl space-y-8">`);
      Header($$renderer3, {
        title: "Team",
        description: "Manage your team members and invitations."
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
          $$renderer4.push(`<h3 class="font-semibold mb-4">Invite a team member</h3> <form class="flex gap-3"><div class="flex-1">`);
          Input($$renderer4, {
            type: "email",
            placeholder: "colleague@company.com",
            required: true,
            get value() {
              return inviteEmail;
            },
            set value($$value) {
              inviteEmail = $$value;
              $$settled = false;
            }
          });
          $$renderer4.push(`<!----></div> `);
          $$renderer4.select(
            {
              value: inviteRole,
              class: "bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
            },
            ($$renderer5) => {
              $$renderer5.option({ value: "member" }, ($$renderer6) => {
                $$renderer6.push(`Member`);
              });
              $$renderer5.option({ value: "admin" }, ($$renderer6) => {
                $$renderer6.push(`Admin`);
              });
              $$renderer5.option({ value: "viewer" }, ($$renderer6) => {
                $$renderer6.push(`Viewer`);
              });
            }
          );
          $$renderer4.push(` `);
          Button($$renderer4, {
            type: "submit",
            loading: inviting,
            disabled: inviting,
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Invite`);
            }
          });
          $$renderer4.push(`<!----></form>`);
        }
      });
      $$renderer3.push(`<!----> <h3 class="font-semibold">Members</h3> `);
      DataTable($$renderer3, {
        columns: ["Email", "Role", "Last login", ""],
        children: ($$renderer4) => {
          const each_array = ensure_array_like(members);
          if (each_array.length !== 0) {
            $$renderer4.push("<!--[-->");
            for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
              let member = each_array[$$index];
              $$renderer4.push(`<tr><td class="px-6 py-3"><div><span class="text-zinc-200">${escape_html(member.email)}</span> `);
              if (member.name) {
                $$renderer4.push("<!--[-->");
                $$renderer4.push(`<span class="text-zinc-500 ml-2">${escape_html(member.name)}</span>`);
              } else {
                $$renderer4.push("<!--[!-->");
              }
              $$renderer4.push(`<!--]--></div></td><td class="px-6 py-3">`);
              if (member.role === "owner") {
                $$renderer4.push("<!--[-->");
                Badge($$renderer4, {
                  variant: "success",
                  children: ($$renderer5) => {
                    $$renderer5.push(`<!---->Owner`);
                  }
                });
              } else {
                $$renderer4.push("<!--[!-->");
                $$renderer4.select(
                  {
                    value: member.role,
                    onchange: (e) => changeRole(member.id, e.target.value),
                    class: "bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
                  },
                  ($$renderer5) => {
                    $$renderer5.option({ value: "admin" }, ($$renderer6) => {
                      $$renderer6.push(`Admin`);
                    });
                    $$renderer5.option({ value: "member" }, ($$renderer6) => {
                      $$renderer6.push(`Member`);
                    });
                    $$renderer5.option({ value: "viewer" }, ($$renderer6) => {
                      $$renderer6.push(`Viewer`);
                    });
                  }
                );
              }
              $$renderer4.push(`<!--]--></td><td class="px-6 py-3 text-zinc-400">${escape_html(member.lastLoginAt ? formatDate(member.lastLoginAt) : "Never")}</td><td class="px-6 py-3 text-right">`);
              if (member.role !== "owner") {
                $$renderer4.push("<!--[-->");
                $$renderer4.push(`<button class="text-sm text-red-400 hover:text-red-300">Remove</button>`);
              } else {
                $$renderer4.push("<!--[!-->");
              }
              $$renderer4.push(`<!--]--></td></tr>`);
            }
          } else {
            $$renderer4.push("<!--[!-->");
            $$renderer4.push(`<tr><td colspan="4" class="px-6 py-8 text-center text-zinc-500">No team members yet</td></tr>`);
          }
          $$renderer4.push(`<!--]-->`);
        }
      });
      $$renderer3.push(`<!----> `);
      if (invitations.length > 0) {
        $$renderer3.push("<!--[-->");
        $$renderer3.push(`<h3 class="font-semibold">Pending invitations</h3> `);
        DataTable($$renderer3, {
          columns: ["Email", "Role", "Expires", ""],
          children: ($$renderer4) => {
            $$renderer4.push(`<!--[-->`);
            const each_array_1 = ensure_array_like(invitations.filter((i) => !i.acceptedAt));
            for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
              let inv = each_array_1[$$index_1];
              $$renderer4.push(`<tr><td class="px-6 py-3 text-zinc-300">${escape_html(inv.email)}</td><td class="px-6 py-3">`);
              Badge($$renderer4, {
                children: ($$renderer5) => {
                  $$renderer5.push(`<!---->${escape_html(inv.role)}`);
                }
              });
              $$renderer4.push(`<!----></td><td class="px-6 py-3 text-zinc-400">${escape_html(formatDate(inv.expiresAt))}</td><td class="px-6 py-3 text-right"><button class="text-sm text-red-400 hover:text-red-300">Cancel</button></td></tr>`);
            }
            $$renderer4.push(`<!--]-->`);
          }
        });
        $$renderer3.push(`<!---->`);
      } else {
        $$renderer3.push("<!--[!-->");
      }
      $$renderer3.push(`<!--]--></div> `);
      {
        let actions = function($$renderer4) {
          Button($$renderer4, {
            variant: "secondary",
            onclick: () => {
              removeTarget = null;
            },
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Cancel`);
            }
          });
          $$renderer4.push(`<!----> `);
          Button($$renderer4, {
            variant: "danger",
            onclick: removeMember,
            children: ($$renderer5) => {
              $$renderer5.push(`<!---->Remove`);
            }
          });
          $$renderer4.push(`<!---->`);
        };
        Modal($$renderer3, {
          open: removeTarget !== null,
          onclose: () => {
            removeTarget = null;
          },
          title: "Remove team member",
          actions,
          children: ($$renderer4) => {
            $$renderer4.push(`<p class="text-sm text-zinc-400">Are you sure you want to remove <span class="text-zinc-200">${escape_html(removeTarget?.email)}</span> from your team? They will lose access immediately.</p>`);
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
