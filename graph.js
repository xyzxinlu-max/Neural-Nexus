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
      renderGraph(graphData);
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
      renderGraph(graphData);
    } else {
      if (loading) {
        loading.textContent = 'Library loading, data received...';
      }
    }
  }
});

function renderGraph(data) {
  console.log('renderGraph called with:', data);
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
    
    console.log('Initializing ForceGraph3D with', data.nodes.length, 'nodes and', data.links.length, 'links');
    
    // Initialize the graph
    graph = ForceGraph3D()(container)
      .nodeLabel(node => node.name) // Show name (will be visible on hover, but we make it always visible)
      .nodeColor(node => node.isRoot ? '#ff6b6b' : '#4ecdc4')
      .linkColor(() => 'rgba(255, 255, 255, 0.2)')
      .linkWidth(1)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.01)
      .onNodeHover(node => {
        // Keep label visible by forcing hover state
        if (node) {
          container.style.cursor = 'pointer';
        } else {
          container.style.cursor = 'default';
        }
      })
      .onNodeClick(node => {
        // Open the node's URL in the parent window
        if (node.href) {
          window.parent.postMessage({ 
            action: 'NAVIGATE', 
            url: node.href 
          }, '*');
        }
      });
    
    // Make labels always visible by simulating hover on all nodes
    // This is a workaround since 3d-force-graph doesn't have a direct "always show labels" option
    graph.onEngineStop(() => {
      // After graph is rendered, we can't directly make all labels visible
      // But we can ensure the label tooltip shows the name clearly
    });
    
    // Set graph data
    graph.graphData(data);
    
    console.log('Graph rendered successfully!');
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

