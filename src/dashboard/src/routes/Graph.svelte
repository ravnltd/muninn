<script lang="ts">
  import { onMount } from "svelte";
  import { getGraph, type GraphData, type GraphNode, type GraphEdge } from "../lib/api";

  let { projectId }: { projectId: number } = $props();
  let container: HTMLDivElement;
  let graphData = $state<GraphData | null>(null);
  let selectedNode = $state<GraphNode | null>(null);
  let error = $state<string | null>(null);

  const NODE_COLORS: Record<string, string> = {
    file: "#06b6d4",
    decision: "#8b5cf6",
    learning: "#10b981",
    issue: "#ef4444",
    session: "#f59e0b",
  };

  const NODE_SHAPES: Record<string, string> = {
    file: "square",
    decision: "diamond",
    learning: "circle",
    issue: "triangle",
    session: "hexagon",
  };

  $effect(() => {
    if (projectId) {
      getGraph(projectId)
        .then((g) => { graphData = g; error = null; renderGraph(g); })
        .catch((e) => { error = e.message; });
    }
  });

  async function renderGraph(data: GraphData) {
    if (!container || !data || data.nodes.length === 0) return;

    // Dynamic import of D3
    const d3 = await import("d3");

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous
    d3.select(container).selectAll("svg").remove();

    const svg = d3.select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);

    // Create zoom behavior
    const g = svg.append("g");
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        }) as any
    );

    // Setup simulation
    const simulation = d3.forceSimulation(data.nodes as any)
      .force("link", d3.forceLink(data.edges).id((d: any) => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(25));

    // Draw edges
    const link = g.append("g")
      .selectAll("line")
      .data(data.edges)
      .join("line")
      .attr("stroke", "#1e3a5f")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d: GraphEdge) => Math.max(1, d.strength / 3));

    // Draw nodes
    const node = g.append("g")
      .selectAll("circle")
      .data(data.nodes)
      .join("circle")
      .attr("r", (d: GraphNode) => Math.max(6, d.size))
      .attr("fill", (d: GraphNode) => NODE_COLORS[d.type] || "#64748b")
      .attr("stroke", "#0a0e1a")
      .attr("stroke-width", 1.5)
      .attr("cursor", "pointer")
      .on("click", (_event: any, d: GraphNode) => { selectedNode = d; })
      .call(d3.drag<any, any>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }) as any
      );

    // Labels
    const label = g.append("g")
      .selectAll("text")
      .data(data.nodes)
      .join("text")
      .text((d: GraphNode) => d.label.length > 20 ? d.label.substring(0, 20) + "..." : d.label)
      .attr("font-size", "10px")
      .attr("fill", "#94a3b8")
      .attr("dx", 12)
      .attr("dy", 4);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);

      label
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y);
    });
  }
</script>

<div class="graph-page">
  {#if error}
    <div class="card error-card"><p>Failed to load graph: {error}</p></div>
  {/if}

  <div class="graph-container" bind:this={container}>
    {#if !graphData || graphData.nodes.length === 0}
      <div class="empty">No graph data available. Add files, decisions, and relationships to see the knowledge graph.</div>
    {/if}
  </div>

  {#if selectedNode}
    <div class="detail-panel card">
      <div class="detail-header">
        <span class="detail-type" style="color: {NODE_COLORS[selectedNode.type]}">{selectedNode.type}</span>
        <button class="btn" onclick={() => selectedNode = null}>Close</button>
      </div>
      <h3>{selectedNode.label}</h3>
      {#if selectedNode.temperature}
        <span class="badge badge-{selectedNode.temperature}">{selectedNode.temperature}</span>
      {/if}
    </div>
  {/if}

  <!-- Legend -->
  <div class="legend card">
    {#each Object.entries(NODE_COLORS) as [type, color]}
      <div class="legend-item">
        <span class="legend-dot" style="background: {color}"></span>
        <span>{type}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .graph-page {
    height: 100%;
    position: relative;
  }

  .graph-container {
    width: 100%;
    height: calc(100vh - 120px);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    padding: 2rem;
    text-align: center;
  }

  .detail-panel {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 300px;
    z-index: 10;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .detail-type {
    text-transform: uppercase;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .legend {
    position: absolute;
    bottom: 1rem;
    left: 1rem;
    display: flex;
    gap: 1rem;
    padding: 0.75rem 1rem;
    z-index: 10;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .error-card {
    border-color: var(--danger);
    color: var(--danger);
    margin-bottom: 1rem;
  }
</style>
