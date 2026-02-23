import { h as head } from "../../chunks/index2.js";
function _layout($$renderer, $$props) {
  let { children } = $$props;
  head("12qhfyh", $$renderer, ($$renderer2) => {
    $$renderer2.title(($$renderer3) => {
      $$renderer3.push(`<title>Muninn Cloud</title>`);
    });
    $$renderer2.push(`<meta name="description" content="Hosted persistent memory for Claude Code. Your AI remembers decisions, patterns, and project context across every session."/>`);
  });
  children($$renderer);
  $$renderer.push(`<!---->`);
}
export {
  _layout as default
};
