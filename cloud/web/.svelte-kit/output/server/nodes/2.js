

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/(auth)/_layout.svelte.js')).default;
export const universal = {
  "ssr": false
};
export const universal_id = "src/routes/(auth)/+layout.ts";
export const imports = ["_app/immutable/nodes/2.DnNMhFJr.js","_app/immutable/chunks/Dp4zGy6Y.js","_app/immutable/chunks/BJmdqduM.js","_app/immutable/chunks/CtKp2v9R.js","_app/immutable/chunks/CvwpLTzV.js"];
export const stylesheets = [];
export const fonts = [];
