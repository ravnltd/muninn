

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/(auth)/_layout.svelte.js')).default;
export const universal = {
  "ssr": false
};
export const universal_id = "src/routes/(auth)/+layout.ts";
export const imports = ["_app/immutable/nodes/2.DnHQVSoU.js","_app/immutable/chunks/BQbrFHdE.js","_app/immutable/chunks/DEIXV2yr.js","_app/immutable/chunks/CSgGRZ2s.js","_app/immutable/chunks/Ba5SyZl2.js"];
export const stylesheets = [];
export const fonts = [];
