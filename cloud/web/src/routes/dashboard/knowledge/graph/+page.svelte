<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { Project, GraphData, GraphNode, GraphEdge } from '$lib/types';
  import Header from '../../../../components/dashboard/Header.svelte';
  import Card from '../../../../components/ui/Card.svelte';
  import Spinner from '../../../../components/ui/Spinner.svelte';

  let projects = $state<Project[]>([]);
  let selectedProjectId = $state<number | null>(null);
  let graphData = $state<GraphData | null>(null);
  let selectedNode = $state<GraphNode | null>(null);
  let loading = $state(true);
  let loadingGraph = $state(false);
  let error = $state<string | null>(null);
  let searchQuery = $state('');
  let highlightedNodes = $state<Set<string>>(new Set());
  let container: HTMLDivElement | undefined = $state();

  // Filter toggles
  let showFiles = $state(true);
  let showDecisions = $state(true);
  let showLearnings = $state(true);
  let showIssues = $state(true);
  let showSessions = $state(true);
  let connectOrphans = $state(true);

  let svgRendered = $state(false);

  const NODE_COLORS: Record<string, string> = {
    file: '#06b6d4',
    decision: '#8b5cf6',
    learning: '#10b981',
    issue: '#ef4444',
    session: '#f59e0b',
  };

  // Derived filter version for visibility tracking
  const filterVersion = $derived(
    `${showFiles}-${showDecisions}-${showLearnings}-${showIssues}-${showSessions}`
  );

  onMount(async () => {
    try {
      const res = await api.getProjects();
      projects = res.projects;
      if (projects.length > 0) {
        selectedProjectId = projects[0].id;
      }
    } catch { /* handled by api client */ }
    loading = false;
  });

  // Load graph when project changes
  $effect(() => {
    const projectId = selectedProjectId;
    if (projectId === null) return;

    loadingGraph = true;
    error = null;
    selectedNode = null;
    svgRendered = false;

    api.getProjectGraph(projectId).then((data) => {
      graphData = data;
      renderGraph(data);
    }).catch((e) => {
      error = e instanceof Error ? e.message : 'Failed to load graph';
      graphData = null;
    }).finally(() => {
      loadingGraph = false;
    });
  });

  // Update visibility when filters change (no rebuild)
  $effect(() => {
    const _version = filterVersion;
    if (graphData && svgRendered) {
      updateVisibility();
    }
  });

  // Rebuild on connectOrphans toggle
  let prevConnectOrphans: boolean | undefined = $state(undefined);
  $effect(() => {
    const current = connectOrphans;
    if (graphData && prevConnectOrphans !== undefined && current !== prevConnectOrphans) {
      svgRendered = false;
      renderGraph(graphData);
    }
    prevConnectOrphans = current;
  });

  // Update search highlighting
  $effect(() => {
    if (!searchQuery || !graphData) {
      highlightedNodes = new Set();
      return;
    }
    const q = searchQuery.toLowerCase();
    highlightedNodes = new Set(
      graphData.nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id)
    );
  });

  function getVisibleTypes(): Set<string> {
    const visible = new Set<string>();
    if (showFiles) visible.add('file');
    if (showDecisions) visible.add('decision');
    if (showLearnings) visible.add('learning');
    if (showIssues) visible.add('issue');
    if (showSessions) visible.add('session');
    return visible;
  }

  async function updateVisibility() {
    if (!container || !graphData) return;
    const d3 = await import('d3');
    const visibleTypes = getVisibleTypes();

    d3.select(container).selectAll('circle')
      .style('display', (d: any) => visibleTypes.has(d.type) ? null : 'none');
    d3.select(container).selectAll('text')
      .style('display', (d: any) => visibleTypes.has(d.type) ? null : 'none');
    d3.select(container).selectAll('line')
      .style('display', (d: any) => {
        const st = typeof d.source === 'string' ? d.source.split(':')[0] : d.source.type;
        const tt = typeof d.target === 'string' ? d.target.split(':')[0] : d.target.type;
        return visibleTypes.has(st) && visibleTypes.has(tt) ? null : 'none';
      });
  }

  function addVirtualEdges(data: GraphData): GraphData {
    const edges = [...data.edges];
    const connectedIds = new Set<string>();
    for (const edge of edges) {
      const sid = typeof edge.source === 'string' ? edge.source : (edge.source as any).id;
      const tid = typeof edge.target === 'string' ? edge.target : (edge.target as any).id;
      connectedIds.add(sid);
      connectedIds.add(tid);
    }
    for (const orphan of data.nodes.filter(n => !connectedIds.has(n.id))) {
      const target = data.nodes.find(n => n.type === orphan.type && connectedIds.has(n.id))
        || data.nodes.find(n => connectedIds.has(n.id));
      if (target) {
        edges.push({ source: orphan.id, target: target.id, type: 'virtual', strength: 1 });
        connectedIds.add(orphan.id);
      }
    }
    return { nodes: data.nodes, edges };
  }

  async function renderGraph(data: GraphData) {
    if (!container || !data || data.nodes.length === 0) return;

    const d3 = await import('d3');
    const processed = connectOrphans ? addVirtualEdges(data) : data;

    // Connection counts for node sizing
    const connectionCounts = new Map<string, number>();
    for (const edge of processed.edges) {
      const sid = typeof edge.source === 'string' ? edge.source : (edge.source as any).id;
      const tid = typeof edge.target === 'string' ? edge.target : (edge.target as any).id;
      connectionCounts.set(sid, (connectionCounts.get(sid) || 0) + 1);
      connectionCounts.set(tid, (connectionCounts.get(tid) || 0) + 1);
    }

    const getNodeRadius = (nodeId: string) => {
      const connections = connectionCounts.get(nodeId) || 0;
      return Math.min(35, 6 + Math.sqrt(connections) * 2);
    };

    // Fragility-based opacity: higher fragility = more opaque/prominent
    const getNodeOpacity = (node: GraphNode) => {
      if (node.type !== 'file' || !node.fragility) return 1;
      return 0.4 + (node.fragility / 10) * 0.6;
    };

    // Fragility-based stroke for files
    const getNodeStroke = (node: GraphNode) => {
      if (node.type !== 'file' || !node.fragility) return '#18181b';
      if (node.fragility >= 7) return '#f87171';
      if (node.fragility >= 4) return '#fbbf24';
      return '#18181b';
    };

    const getNodeStrokeWidth = (node: GraphNode) => {
      if (node.type !== 'file' || !node.fragility) return 1.5;
      if (node.fragility >= 7) return 3;
      if (node.fragility >= 4) return 2;
      return 1.5;
    };

    const width = container.clientWidth;
    const height = container.clientHeight;

    d3.select(container).selectAll('svg').remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    const g = svg.append('g');
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => { g.attr('transform', event.transform); }) as any
    );

    const simulation = d3.forceSimulation(processed.nodes as any)
      .force('link', d3.forceLink(processed.edges)
        .id((d: any) => d.id)
        .distance((d: any) => d.type === 'virtual' ? 900 : 450)
        .strength((d: any) => d.type === 'virtual' ? 0.02 : 0.1)
      )
      .force('charge', d3.forceManyBody().strength(-600))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => getNodeRadius(d.id) + 150).strength(1))
      .force('x', d3.forceX(width / 2).strength(0.008))
      .force('y', d3.forceY(height / 2).strength(0.008))
      .stop();

    // Pre-compute layout
    const tickCount = Math.min(300, Math.ceil(Math.log(processed.nodes.length) * 50));
    for (let i = 0; i < tickCount; i++) {
      simulation.tick();
    }

    // Draw edges
    const link = g.append('g')
      .selectAll('line')
      .data(processed.edges)
      .join('line')
      .attr('stroke', (d: GraphEdge) => d.type === 'virtual' ? '#27272a' : '#4a90a4')
      .attr('stroke-opacity', (d: GraphEdge) => d.type === 'virtual' ? 0.3 : 0.6)
      .attr('stroke-width', (d: GraphEdge) => d.type === 'virtual' ? 1 : Math.max(1, d.strength / 3))
      .attr('stroke-dasharray', (d: GraphEdge) => d.type === 'virtual' ? '3,3' : 'none')
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y);

    // Draw nodes with fragility-based coloring
    const node = g.append('g')
      .selectAll('circle')
      .data(processed.nodes)
      .join('circle')
      .attr('r', (d: GraphNode) => getNodeRadius(d.id))
      .attr('fill', (d: GraphNode) => NODE_COLORS[d.type] || '#64748b')
      .attr('fill-opacity', (d: GraphNode) => getNodeOpacity(d))
      .attr('stroke', (d: GraphNode) =>
        highlightedNodes.has(d.id) ? '#fff' : getNodeStroke(d)
      )
      .attr('stroke-width', (d: GraphNode) =>
        highlightedNodes.has(d.id) ? 3 : getNodeStrokeWidth(d)
      )
      .attr('cursor', 'pointer')
      .style('filter', (d: GraphNode) =>
        highlightedNodes.size > 0 && !highlightedNodes.has(d.id) ? 'opacity(0.3)' : 'none'
      )
      .attr('cx', (d: any) => d.x)
      .attr('cy', (d: any) => d.y)
      .on('click', (_event: any, d: GraphNode) => { selectedNode = d; })
      .call(d3.drag<any, any>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        }) as any
      );

    // Labels
    const label = g.append('g')
      .selectAll('text')
      .data(processed.nodes)
      .join('text')
      .text((d: GraphNode) => d.label.length > 30 ? d.label.substring(0, 30) + '...' : d.label)
      .attr('font-size', '12px')
      .attr('font-weight', '500')
      .attr('fill', '#a1a1aa')
      .attr('dx', 14)
      .attr('dy', 4)
      .attr('x', (d: any) => d.x)
      .attr('y', (d: any) => d.y);

    // Tick handler for drag interactions
    simulation.on('tick', () => {
      link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      node.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);
      label.attr('x', (d: any) => d.x).attr('y', (d: any) => d.y);
    });

    svgRendered = true;
    updateVisibility();
  }
</script>

<div class="max-w-7xl space-y-6">
  <Header title="Knowledge Graph" description="Visualize relationships between files, decisions, learnings, and issues." />

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  {:else if projects.length === 0}
    <Card>
      <div class="text-center py-12">
        <p class="text-zinc-400 text-sm">No projects found. Connect Muninn to a project to see its knowledge graph.</p>
      </div>
    </Card>
  {:else}
    <!-- Project selector -->
    <div>
      <label for="graph-project-select" class="block text-sm font-medium text-zinc-300 mb-1.5">Project</label>
      <select
        id="graph-project-select"
        bind:value={selectedProjectId}
        class="w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      >
        {#each projects as project}
          <option value={project.id}>{project.name}</option>
        {/each}
      </select>
    </div>

    {#if error}
      <Card>
        <p class="text-red-400 text-sm">Failed to load graph: {error}</p>
      </Card>
    {/if}

    <!-- Filter panel -->
    <div class="flex flex-wrap items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
      <input
        type="text"
        placeholder="Search nodes..."
        bind:value={searchQuery}
        class="max-w-[220px] px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      />

      <div class="flex items-center gap-4 flex-wrap">
        {#each [
          { key: 'file', label: 'Files', checked: showFiles, toggle: () => showFiles = !showFiles },
          { key: 'decision', label: 'Decisions', checked: showDecisions, toggle: () => showDecisions = !showDecisions },
          { key: 'learning', label: 'Learnings', checked: showLearnings, toggle: () => showLearnings = !showLearnings },
          { key: 'issue', label: 'Issues', checked: showIssues, toggle: () => showIssues = !showIssues },
          { key: 'session', label: 'Sessions', checked: showSessions, toggle: () => showSessions = !showSessions },
        ] as filter}
          <label class="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={filter.checked} onchange={filter.toggle} class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0" />
            <span class="w-2 h-2 rounded-full" style="background: {NODE_COLORS[filter.key]}"></span>
            {filter.label}
          </label>
        {/each}
      </div>

      <label class="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none ml-auto border-l border-zinc-700 pl-4">
        <input type="checkbox" bind:checked={connectOrphans} class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0" />
        Connect orphans
      </label>
    </div>

    <!-- Graph container -->
    <div class="relative">
      {#if loadingGraph}
        <div class="flex items-center justify-center h-[600px] bg-zinc-900 border border-zinc-800 rounded-xl">
          <Spinner />
        </div>
      {:else}
        <div
          bind:this={container}
          class="w-full h-[600px] bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden"
        >
          {#if !graphData || graphData.nodes.length === 0}
            <div class="flex items-center justify-center h-full">
              <p class="text-zinc-500 text-sm">No graph data. Add files, decisions, and relationships to visualize the knowledge graph.</p>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Selected node detail -->
      {#if selectedNode}
        <div class="absolute top-4 right-4 w-72 z-10">
          <Card>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wide" style="color: {NODE_COLORS[selectedNode.type]}">{selectedNode.type}</span>
                <button onclick={() => selectedNode = null} class="text-zinc-500 hover:text-zinc-300 text-sm">Close</button>
              </div>
              <h3 class="text-sm font-medium text-white break-all">{selectedNode.label}</h3>
              {#if selectedNode.temperature}
                <span class="inline-block text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 capitalize">{selectedNode.temperature}</span>
              {/if}
              {#if selectedNode.fragility !== undefined && selectedNode.fragility > 0}
                <div class="flex items-center gap-2">
                  <span class="text-xs text-zinc-500">Fragility</span>
                  <div class="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full {selectedNode.fragility >= 7 ? 'bg-red-400' : selectedNode.fragility >= 4 ? 'bg-amber-400' : 'bg-emerald-400'}"
                      style="width: {selectedNode.fragility * 10}%"
                    ></div>
                  </div>
                  <span class="text-xs {selectedNode.fragility >= 7 ? 'text-red-400' : selectedNode.fragility >= 4 ? 'text-amber-400' : 'text-zinc-400'}">{selectedNode.fragility}/10</span>
                </div>
              {/if}
            </div>
          </Card>
        </div>
      {/if}
    </div>

    <!-- Legend -->
    <div class="flex items-center gap-6 px-4 py-2">
      {#each Object.entries(NODE_COLORS) as [type, color]}
        <div class="flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 rounded-full" style="background: {color}"></span>
          <span class="text-xs text-zinc-500 capitalize">{type}</span>
        </div>
      {/each}
      <div class="flex items-center gap-1.5 ml-4 border-l border-zinc-800 pl-4">
        <span class="w-2.5 h-2.5 rounded-full border-2 border-red-400 bg-transparent"></span>
        <span class="text-xs text-zinc-500">Fragile file (7+)</span>
      </div>
    </div>
  {/if}
</div>
