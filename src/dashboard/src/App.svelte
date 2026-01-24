<script lang="ts">
  import { getProjects, type ProjectInfo } from "./lib/api";
  import Health from "./routes/Health.svelte";
  import Graph from "./routes/Graph.svelte";
  import Memory from "./routes/Memory.svelte";
  import Timeline from "./routes/Timeline.svelte";

  let currentRoute = $state(window.location.hash.slice(1) || "/");
  let projects = $state<ProjectInfo[]>([]);
  let selectedProject = $state<number | null>(null);

  $effect(() => {
    const handler = () => {
      currentRoute = window.location.hash.slice(1) || "/";
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  });

  $effect(() => {
    getProjects().then((p) => {
      projects = p;
      if (p.length > 0 && !selectedProject) {
        selectedProject = p[0].id;
      }
    });
  });

  function navigate(path: string) {
    window.location.hash = path;
  }
</script>

<nav>
  <div class="nav-brand">
    <span class="logo">&#9670;</span>
    <span class="brand-text">Muninn</span>
  </div>

  <div class="nav-links">
    <a href="#/" class:active={currentRoute === "/"} onclick={() => navigate("/")}>Health</a>
    <a href="#/graph" class:active={currentRoute === "/graph"} onclick={() => navigate("/graph")}>Graph</a>
    <a href="#/memory" class:active={currentRoute === "/memory"} onclick={() => navigate("/memory")}>Memory</a>
    <a href="#/timeline" class:active={currentRoute === "/timeline"} onclick={() => navigate("/timeline")}>Timeline</a>
  </div>

  <div class="nav-project">
    {#if projects.length > 0}
      <select bind:value={selectedProject}>
        {#each projects as project}
          <option value={project.id}>{project.name}</option>
        {/each}
      </select>
    {/if}
  </div>
</nav>

<main>
  {#if selectedProject}
    {#if currentRoute === "/"}
      <Health projectId={selectedProject} />
    {:else if currentRoute === "/graph"}
      <Graph projectId={selectedProject} />
    {:else if currentRoute === "/memory"}
      <Memory projectId={selectedProject} />
    {:else if currentRoute === "/timeline"}
      <Timeline projectId={selectedProject} />
    {:else}
      <Health projectId={selectedProject} />
    {/if}
  {:else}
    <div class="empty-state">
      <p>No projects found. Add a project with <code>muninn file add</code> to get started.</p>
    </div>
  {/if}
</main>

<style>
  .nav-brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-right: 2rem;
  }

  .logo {
    color: var(--accent-1);
    font-size: 1.25rem;
  }

  .brand-text {
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .nav-links {
    display: flex;
    gap: 0.25rem;
    flex: 1;
  }

  .nav-project select {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  main {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
  }

  .empty-state code {
    background: var(--bg-elevated);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
  }
</style>
