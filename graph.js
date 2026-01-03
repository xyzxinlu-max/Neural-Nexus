// Graph rendering script for iframe
let graph = null;
let graphData = null;
let scriptLoaded = false;
let loading = null;

// Wait for DOM to be ready
function init() {
  loading = document.getElementById('loading');
  
  // Load 3d-force-graph.js dynamically
  const script = document.createElement('script');
  script.src = '3d-force-graph.js';
  script.onload = () => {
    console.log('3d-force-graph.js loaded successfully');
    scriptLoaded = true;
    if (loading) {
      loading.textContent = 'Library loaded, waiting for data...';
    }
    // If we already have data, render it now
    if (graphData) {
      const demoToggle = document.getElementById('demoModeToggle');
      const isDemoMode = demoToggle ? demoToggle.checked : false;
      renderGraph(graphData, isDemoMode);
    }
  };
  script.onerror = () => {
    console.error('Failed to load 3d-force-graph.js');
    if (loading) {
      loading.textContent = 'Error: Failed to load 3d-force-graph.js library';
      loading.style.color = '#ff6b6b';
    }
  };
  document.head.appendChild(script);
  
  // Close button handler
  const closeButton = document.getElementById('close-button');
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      // Send close message to parent
      window.parent.postMessage({ action: 'CLOSE_OVERLAY' }, '*');
    });
  }
  
  // Demo Mode toggle handler
  const demoToggle = document.getElementById('demoModeToggle');
  const demoStatus = document.getElementById('demoStatus');
  
  if (demoToggle) {
    demoToggle.addEventListener('change', (e) => {
      const isDemoMode = e.target.checked;
      demoStatus.textContent = isDemoMode ? 'On' : 'Off';
      
      // Re-render graph with/without ghost nodes
      if (graphData) {
        renderGraph(graphData, isDemoMode);
      }
    });
  }
  
  console.log('Graph iframe initialized');
  if (loading) {
    loading.textContent = 'Waiting for graph data...';
  }
}

// Listen for messages from the content script
window.addEventListener('message', (event) => {
  console.log('Graph iframe received message:', event.data);
  // Security: Only accept messages from the extension origin
  if (event.data && event.data.action === 'RENDER_GRAPH') {
    console.log('RENDER_GRAPH action received, data:', event.data.data);
    graphData = event.data.data;
    if (scriptLoaded) {
      const demoToggle = document.getElementById('demoModeToggle');
      const isDemoMode = demoToggle ? demoToggle.checked : false;
      renderGraph(graphData, isDemoMode);
    } else {
      if (loading) {
        loading.textContent = 'Library loading, data received...';
      }
    }
  }
});

// Generate ghost nodes for demo mode
function generateGhostNodes(realNodes, realLinks, count = 75) {
  const ghostNodes = [];
  const ghostLinks = [];
  const ghostNames = [
    'Neural Link', 'Concept A', 'System B', 'Data Stream', 'Node X',
    'Connection Point', 'Synapse', 'Network Hub', 'Core Module', 'Interface',
    'Protocol Layer', 'Signal Path', 'Data Node', 'Link Matrix', 'Flow Channel',
    'Quantum Bridge', 'Info Gateway', 'Memory Core', 'Logic Unit', 'Process Node',
    'Transfer Point', 'Sync Zone', 'Merge Point', 'Split Node', 'Filter Gate',
    'Transform Unit', 'Cache Layer', 'Buffer Zone', 'Queue Node', 'Stack Point',
    'Heap Space', 'Thread Link', 'Event Stream', 'Message Queue', 'State Node',
    'Context Switch', 'Pipeline Stage', 'Branch Point', 'Merge Junction', 'Fork Node'
  ];
  
  // Generate ghost nodes
  for (let i = 0; i < count; i++) {
    const nameIndex = i % ghostNames.length;
    const suffix = Math.floor(i / ghostNames.length);
    const name = suffix > 0 ? `${ghostNames[nameIndex]} ${suffix + 1}` : ghostNames[nameIndex];
    
    ghostNodes.push({
      id: `ghost-${i}`,
      name: name,
      href: null,
      isGhost: true,
      isRoot: false
    });
  }
  
  // Connect ghost nodes to real nodes
  realNodes.forEach((realNode, index) => {
    // Each real node gets 2-4 ghost connections
    const numConnections = 2 + Math.floor(Math.random() * 3);
    
    for (let j = 0; j < numConnections; j++) {
      const ghostIndex = Math.floor(Math.random() * ghostNodes.length);
      const ghostNode = ghostNodes[ghostIndex];
      
      // Create link from real node to ghost node
      ghostLinks.push({
        source: realNode.id,
        target: ghostNode.id,
        sourceName: realNode.name,
        targetName: ghostNode.name,
        isGhost: true
      });
      
      // Sometimes create reverse link (ghost to real)
      if (Math.random() > 0.7) {
        ghostLinks.push({
          source: ghostNode.id,
          target: realNode.id,
          sourceName: ghostNode.name,
          targetName: realNode.name,
          isGhost: true
        });
      }
    }
  });
  
  // Connect ghost nodes to each other (sparse connections)
  for (let i = 0; i < ghostNodes.length; i++) {
    if (Math.random() > 0.85) { // 15% chance to connect to another ghost
      const targetIndex = Math.floor(Math.random() * ghostNodes.length);
      if (targetIndex !== i) {
        ghostLinks.push({
          source: ghostNodes[i].id,
          target: ghostNodes[targetIndex].id,
          sourceName: ghostNodes[i].name,
          targetName: ghostNodes[targetIndex].name,
          isGhost: true
        });
      }
    }
  }
  
  return { nodes: ghostNodes, links: ghostLinks };
}

function renderGraph(data, demoMode = false) {
  console.log('renderGraph called with:', data, 'demoMode:', demoMode);
  const container = document.getElementById('graph-container');
  
  if (!container) {
    console.error('Graph container not found');
    return;
  }
  
  if (!data || !data.nodes || data.nodes.length === 0) {
    if (loading) {
      loading.textContent = 'No graph data available (0 nodes found)';
      loading.style.display = 'block';
    }
    console.warn('No graph data or empty nodes array');
    return;
  }
  
  // Check if ForceGraph3D is available
  if (typeof ForceGraph3D === 'undefined') {
    if (loading) {
      loading.textContent = 'Error: ForceGraph3D not available';
      loading.style.display = 'block';
      loading.style.color = '#ff6b6b';
    }
    console.error('ForceGraph3D is not defined. Make sure 3d-force-graph.js is loaded.');
    return;
  }
  
  try {
    // Hide loading
    if (loading) {
      loading.style.display = 'none';
    }
    
    // Prepare graph data (with or without ghost nodes)
    let finalData = { ...data };
    
    if (demoMode) {
      console.log('Demo Mode: Generating ghost nodes...');
      const ghostData = generateGhostNodes(data.nodes, data.links);
      finalData = {
        nodes: [...data.nodes, ...ghostData.nodes],
        links: [...data.links, ...ghostData.links]
      };
      console.log(`Demo Mode: Added ${ghostData.nodes.length} ghost nodes and ${ghostData.links.length} ghost links`);
    }
    
    console.log('Initializing ForceGraph3D with', finalData.nodes.length, 'nodes and', finalData.links.length, 'links');
    
    // Destroy existing graph if it exists
    if (graph) {
      try {
        graph._destructor();
      } catch (e) {
        // Ignore errors
      }
      graph = null;
    }
    
    console.log('Rendering graph with:', {
      totalNodes: finalData.nodes.length,
      totalLinks: finalData.links.length,
      realNodes: data.nodes.length,
      realLinks: data.links.length,
      ghostNodes: demoMode ? finalData.nodes.length - data.nodes.length : 0,
      ghostLinks: demoMode ? finalData.links.length - data.links.length : 0,
      demoMode: demoMode
    });
    
    // Initialize the graph
    graph = ForceGraph3D()(container)
      .nodeLabel(node => node.name) // Show name
      .nodeColor(node => {
        if (node.isGhost) {
          return '#9696ff'; // Ghost nodes: visible blue-purple
        }
        return node.isRoot ? '#ff6b6b' : '#4ecdc4'; // Real nodes: red (root) or cyan
      })
      .nodeVal(node => {
        // Make ghost nodes slightly smaller
        if (node.isGhost) {
          return 3;
        }
        return node.isRoot ? 5 : 4;
      })
      .linkColor(link => {
        // Check if link has isGhost property
        const isGhostLink = link && (link.isGhost === true);
        if (isGhostLink) {
          return 'rgba(150, 150, 255, 0.5)'; // Ghost links: visible blue with transparency
        }
        return 'rgba(255, 255, 255, 0.8)'; // Real links: white with high opacity
      })
      .linkWidth(link => {
        const isGhostLink = link && (link.isGhost === true);
        if (isGhostLink) {
          return 1.0; // Ghost links: normal width
        }
        return 2.0; // Real links: thicker for visibility
      })
      .linkDirectionalParticles(link => {
        const isGhostLink = link && (link.isGhost === true);
        if (isGhostLink) {
          return 1; // Fewer particles on ghost links
        }
        return 2; // Normal particles on real links
      })
      .linkDirectionalParticleSpeed(0.01)
      .onNodeHover(node => {
        if (node) {
          container.style.cursor = node.isGhost ? 'default' : 'pointer';
        } else {
          container.style.cursor = 'default';
        }
      })
      .onNodeClick(node => {
        // Only real nodes are clickable
        if (!node.isGhost && node.href) {
          window.parent.postMessage({ 
            action: 'NAVIGATE', 
            url: node.href 
          }, '*');
        }
      });
    
    // Set graph data
    graph.graphData(finalData);
    
    console.log('Graph rendered! Final stats:', {
      nodes: finalData.nodes.length,
      links: finalData.links.length
    });
    
    console.log('Graph rendered successfully!', demoMode ? '(Demo Mode ON)' : '(Demo Mode OFF)');
  } catch (error) {
    console.error('Error rendering graph:', error);
    if (loading) {
      loading.textContent = 'Error: ' + error.message;
      loading.style.display = 'block';
      loading.style.color = '#ff6b6b';
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // DOM is already ready
  init();
}

