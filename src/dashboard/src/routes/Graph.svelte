<script lang="ts">
  import { onMount } from "svelte";
  import { getGraph, getRelationships, type GraphData, type GraphNode, type GraphEdge, type RelationshipInfo } from "../lib/api";

  let { projectId }: { projectId: number } = $props();
  let container: HTMLDivElement;
  let graphData = $state<GraphData | null>(null);
  let relationships = $state<RelationshipInfo[]>([]);
  let selectedNode = $state<GraphNode | null>(null);
  let error = $state<string | null>(null);
  let searchQuery = $state("");
  let highlightedNodes = $state<Set<string>>(new Set());

  // Filters
  let showFiles = $state(true);
  let showDecisions = $state(true);
  let showLearnings = $state(true);
  let showIssues = $state(true);
  let showSessions = $state(true);
  let connectOrphans = $state(true); // Connect orphan nodes to nearest neighbors

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

  // Filter nodes based on settings
  function getFilteredData(data: GraphData): GraphData {
    const typeFilters: Record<string, boolean> = {
      file: showFiles,
      decision: showDecisions,
      learning: showLearnings,
      issue: showIssues,
      session: showSessions,
    };

    // First filter by type
    let filteredNodes = data.nodes.filter(n => typeFilters[n.type] ?? true);
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

    // Filter edges to only include those between filtered nodes
    // Handle D3's mutation of source/target from strings to objects
    let filteredEdges = data.edges.filter(e => {
      const sourceId = typeof e.source === 'string' ? e.source : (e.source as any).id;
      const targetId = typeof e.target === 'string' ? e.target : (e.target as any).id;
      return filteredNodeIds.has(sourceId) && filteredNodeIds.has(targetId);
    });

    // Find connected node IDs
    const connectedIds = new Set<string>();
    for (const edge of filteredEdges) {
      const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any).id;
      const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any).id;
      connectedIds.add(sourceId);
      connectedIds.add(targetId);
    }

    // Connect orphan nodes to their nearest type-neighbor
    if (connectOrphans) {
      const orphanNodes = filteredNodes.filter(n => !connectedIds.has(n.id));

      for (const orphan of orphanNodes) {
        // Find a connected node of the same type, or any connected node
        let target = filteredNodes.find(n => n.type === orphan.type && connectedIds.has(n.id));
        if (!target) {
          target = filteredNodes.find(n => connectedIds.has(n.id));
        }

        if (target) {
          // Create a weak virtual edge
          filteredEdges.push({
            source: orphan.id,
            target: target.id,
            type: "virtual",
            strength: 1,
          } as GraphEdge);
          connectedIds.add(orphan.id);
        }
      }
    }

    return { nodes: filteredNodes, edges: filteredEdges };
  }

  // Get relationships for selected node
  function getNodeRelationships(nodeId: string): { incoming: RelationshipInfo[]; outgoing: RelationshipInfo[] } {
    const [type, id] = nodeId.split(":");
    const numId = parseInt(id, 10);

    const incoming = relationships.filter(r =>
      r.target_type === type && r.target_id === numId
    );
    const outgoing = relationships.filter(r =>
      r.source_type === type && r.source_id === numId
    );

    return { incoming, outgoing };
  }

  // Handle search
  function updateHighlight() {
    if (!searchQuery || !graphData) {
      highlightedNodes = new Set();
      return;
    }
    const q = searchQuery.toLowerCase();
    highlightedNodes = new Set(
      graphData.nodes
        .filter(n => n.label.toLowerCase().includes(q))
        .map(n => n.id)
    );
  }

  $effect(() => {
    updateHighlight();
  });

  $effect(() => {
    if (projectId) {
      Promise.all([
        getGraph(projectId),
        getRelationships(projectId)
      ])
        .then(([g, r]) => {
          graphData = g;
          relationships = r;
          error = null;
          renderGraph(getFilteredData(g));
        })
        .catch((e) => { error = e.message; });
    }
  });

  // Re-render when filters change
  $effect(() => {
    if (graphData) {
      // Access filter states to trigger reactivity
      void [showFiles, showDecisions, showLearnings, showIssues, showSessions, connectOrphans];
      renderGraph(getFilteredData(graphData));
    }
  });

  async function renderGraph(data: GraphData) {
    if (!container || !data || data.nodes.length === 0) return;

    // Dynamic import of D3
    const d3 = await import("d3");

    // Calculate connection count for each node (for sizing)
    const connectionCounts = new Map<string, number>();
    for (const edge of data.edges) {
      const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any).id;
      const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any).id;
      connectionCounts.set(sourceId, (connectionCounts.get(sourceId) || 0) + 1);
      connectionCounts.set(targetId, (connectionCounts.get(targetId) || 0) + 1);
    }

    // Helper to calculate node radius (capped to prevent huge nodes)
    const getNodeRadius = (nodeId: string) => {
      const connections = connectionCounts.get(nodeId) || 0;
      // Base 6, grows with sqrt, max 35
      return Math.min(35, 6 + Math.sqrt(connections) * 2);
    };

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
      .force("link", d3.forceLink(data.edges)
        .id((d: any) => d.id)
        .distance((d: any) => {
          if (d.type === "virtual") return 900;
          return 450;
        })
        .strength((d: any) => d.type === "virtual" ? 0.02 : 0.1)
      )
      .force("charge", d3.forceManyBody()
        .strength(-600)
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide()
        .radius((d: any) => getNodeRadius(d.id) + 150)
        .strength(1)
      )
      .force("x", d3.forceX(width / 2).strength(0.008))
      .force("y", d3.forceY(height / 2).strength(0.008));

    // Draw edges
    const link = g.append("g")
      .selectAll("line")
      .data(data.edges)
      .join("line")
      .attr("stroke", (d: GraphEdge) => d.type === "virtual" ? "#334155" : "#4a90a4")
      .attr("stroke-opacity", (d: GraphEdge) => d.type === "virtual" ? 0.3 : 0.6)
      .attr("stroke-width", (d: GraphEdge) => d.type === "virtual" ? 1 : Math.max(1, d.strength / 3))
      .attr("stroke-dasharray", (d: GraphEdge) => d.type === "virtual" ? "3,3" : "none");

    // Draw nodes
    const node = g.append("g")
      .selectAll("circle")
      .data(data.nodes)
      .join("circle")
      .attr("r", (d: GraphNode) => getNodeRadius(d.id))
      .attr("fill", (d: GraphNode) => NODE_COLORS[d.type] || "#64748b")
      .attr("stroke", (d: GraphNode) => highlightedNodes.has(d.id) ? "#fff" : "#0a0e1a")
      .attr("stroke-width", (d: GraphNode) => highlightedNodes.has(d.id) ? 3 : 1.5)
      .attr("cursor", "pointer")
      .style("filter", (d: GraphNode) => highlightedNodes.size > 0 && !highlightedNodes.has(d.id) ? "opacity(0.3)" : "none")
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
      .text((d: GraphNode) => d.label.length > 30 ? d.label.substring(0, 30) + "..." : d.label)
      .attr("font-size", "14px")
      .attr("font-weight", "500")
      .attr("fill", "#e2e8f0")
      .attr("dx", 16)
      .attr("dy", 5);

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

  <!-- Filter Panel -->
  <div class="filter-panel card">
    <div class="filter-row">
      <input
        type="text"
        class="search-input"
        placeholder="Search nodes..."
        bind:value={searchQuery}
      />
    </div>
    <div class="filter-row">
      <label class="filter-checkbox">
        <input type="checkbox" bind:checked={showFiles} />
        <span class="filter-dot" style="background: {NODE_COLORS.file}"></span>
        Files
      </label>
      <label class="filter-checkbox">
        <input type="checkbox" bind:checked={showDecisions} />
        <span class="filter-dot" style="background: {NODE_COLORS.decision}"></span>
        Decisions
      </label>
      <label class="filter-checkbox">
        <input type="checkbox" bind:checked={showLearnings} />
        <span class="filter-dot" style="background: {NODE_COLORS.learning}"></span>
        Learnings
      </label>
      <label class="filter-checkbox">
        <input type="checkbox" bind:checked={showIssues} />
        <span class="filter-dot" style="background: {NODE_COLORS.issue}"></span>
        Issues
      </label>
      <label class="filter-checkbox">
        <input type="checkbox" bind:checked={showSessions} />
        <span class="filter-dot" style="background: {NODE_COLORS.session}"></span>
        Sessions
      </label>
      <label class="filter-checkbox connect-orphans" title="Connect isolated nodes to the main graph">
        <input type="checkbox" bind:checked={connectOrphans} />
        Connect orphans
      </label>
    </div>
  </div>

  <div class="graph-container" bind:this={container}>
    {#if !graphData || graphData.nodes.length === 0}
      <div class="empty">No graph data available. Add files, decisions, and relationships to see the knowledge graph.</div>
    {:else if getFilteredData(graphData).nodes.length === 0}
      <div class="empty">No nodes match the current filters. Try adjusting filters or disabling "Hide disconnected".</div>
    {/if}
  </div>

  {#if selectedNode}
    {@const nodeRels = getNodeRelationships(selectedNode.id)}
    <div class="detail-panel card">
      <div class="detail-header">
        <span class="detail-type" style="color: {NODE_COLORS[selectedNode.type]}">{selectedNode.type}</span>
        <button class="btn" onclick={() => selectedNode = null}>Close</button>
      </div>
      <h3>{selectedNode.label}</h3>
      {#if selectedNode.temperature}
        <span class="badge badge-{selectedNode.temperature}">{selectedNode.temperature}</span>
      {/if}

      <!-- Relationships Section -->
      {#if nodeRels.incoming.length > 0 || nodeRels.outgoing.length > 0}
        <div class="relationships-section">
          {#if nodeRels.incoming.length > 0}
            <div class="rel-group">
              <h4>Incoming</h4>
              {#each nodeRels.incoming as rel}
                <div class="rel-item">
                  <span class="rel-type">{rel.source_type}:{rel.source_id}</span>
                  <span class="rel-arrow">→</span>
                  <span class="rel-label">{rel.relationship}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#if nodeRels.outgoing.length > 0}
            <div class="rel-group">
              <h4>Outgoing</h4>
              {#each nodeRels.outgoing as rel}
                <div class="rel-item">
                  <span class="rel-label">{rel.relationship}</span>
                  <span class="rel-arrow">→</span>
                  <span class="rel-type">{rel.target_type}:{rel.target_id}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <p class="no-relationships">No relationships recorded</p>
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

  .filter-panel {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .filter-row .search-input {
    max-width: 250px;
  }

  .filter-checkbox {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .filter-checkbox input {
    cursor: pointer;
  }

  .filter-checkbox.connect-orphans {
    margin-left: auto;
    padding-left: 1rem;
    border-left: 1px solid var(--border-subtle);
  }

  .filter-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .graph-container {
    width: 100%;
    height: calc(100vh - 200px);
    margin-top: 80px;
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
    top: 90px;
    right: 1rem;
    width: 320px;
    max-height: calc(100vh - 220px);
    overflow-y: auto;
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

  .relationships-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
  }

  .rel-group {
    margin-bottom: 0.75rem;
  }

  .rel-group h4 {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-bottom: 0.375rem;
  }

  .rel-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.8125rem;
  }

  .rel-type {
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }

  .rel-arrow {
    color: var(--text-muted);
  }

  .rel-label {
    color: var(--accent-1);
    font-weight: 500;
  }

  .no-relationships {
    font-size: 0.8125rem;
    color: var(--text-muted);
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
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
