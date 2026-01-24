import App from "./App.svelte";
import "./styles/theme.css";

const app = new App({
  target: document.getElementById("app")!,
});

export default app;
