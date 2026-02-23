import "clsx";
function _layout($$renderer, $$props) {
  let { children } = $$props;
  $$renderer.push(`<div class="min-h-screen flex items-center justify-center p-4"><div class="w-full max-w-sm"><div class="text-center mb-8"><a href="/" class="inline-block text-2xl font-semibold tracking-tight">Muninn</a></div> `);
  children($$renderer);
  $$renderer.push(`<!----></div></div>`);
}
export {
  _layout as default
};
