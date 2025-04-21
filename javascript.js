// ─── STATE ────────────────────────────────────────────────────────
const canvas      = document.getElementById('canvas');
const svg         = document.getElementById('connections');
const connections = [];   // store completed wires
let nodesData     = {};
let drawing       = false;
let currPath      = null;
let startConn     = null;
let snapConn      = null;
let canvasRect    = null;

// ─── LOAD TOOLBOX JSONS ───────────────────────────────────────────
['data-sources','agents','tools'].forEach(tab => {
  fetch(`nodes/${tab}.json`)
    .then(r => r.json())
    .then(data => {
      nodesData[tab] = data;
      renderToolbox(tab, data);
    });
});

function renderToolbox(tab, items) {
  const cont = document.getElementById(tab);
  items.forEach(item => {
    const d = document.createElement('div');
    d.className    = 'toolbox-node';
    d.draggable    = true;
    d.innerText    = item.name;
    d.dataset.tab  = tab;
    d.addEventListener('dragstart', onToolboxDrag);
    cont.appendChild(d);
  });
}

function onToolboxDrag(ev) {
  ev.dataTransfer.setData(
    'text/plain',
    `${ev.target.dataset.tab}::${ev.target.innerText}`
  );
}

canvas.addEventListener('dragover', e => e.preventDefault());
canvas.addEventListener('drop',    onCanvasDrop);

function onCanvasDrop(ev) {
  ev.preventDefault();
  const [tab, name] = ev.dataTransfer.getData('text/plain').split('::');
  if (!tab) return;
  createNode(tab, name, ev.offsetX, ev.offsetY);
}

// ─── NODE FACTORY ─────────────────────────────────────────────────
let nodeCounter = 0;
function createNode(tab, name, x, y) {
  const nd = document.createElement('div');
  nd.className  = 'canvas-node';
  nd.style.left = x + 'px';
  nd.style.top  = y + 'px';
  nd.dataset.tab = tab;
  nd.dataset.id  = 'node-' + (++nodeCounter);

  // Title
  const h = document.createElement('div');
  h.className = 'title';
  h.innerText = name;
  nd.appendChild(h);

  // Params
  const p = document.createElement('div');
  p.className = 'params';
  p.innerHTML = `DummyParameter: <input type="number" value="1" style="width:40px;">`;
  nd.appendChild(p);

  // Input & Output containers
  const inC  = document.createElement('div');
  const outC = document.createElement('div');
  inC .className = 'input-container';
  outC.className = 'output-container';
  nd.appendChild(inC);
  nd.appendChild(outC);

  // Make connectors
  if (tab === 'data-sources') {
    mkConn(outC, 'output', 'source');
  } else if (tab === 'agents') {
    mkConn(inC,  'input',  'source');
    mkConn(outC, 'output', 'agent');
  } else { // tools
    mkConn(inC,  'input', 'agent');
  }

  nd.addEventListener('mousedown', nodeMouseDown);
  canvas.appendChild(nd);
}

function mkConn(container, dir, type) {
  const wrapper = document.createElement('div');
  wrapper.className   = `connector ${dir}`;
  wrapper.dataset.dir  = dir;
  wrapper.dataset.type = type;

  // set connector color
  const col = (type === 'source' ? '#3498db' : '#e67e22');
  wrapper.style.setProperty('--connColor', col);

  // the draggable ball
  const ball = document.createElement('div');
  ball.className = 'ball';
  wrapper.appendChild(ball);

  // start drag on both wrapper (for semicircle) and ball
  wrapper.addEventListener('mousedown', startConnection);
  ball   .addEventListener('mousedown', startConnection);

  container.appendChild(wrapper);
}

// ─── NODE DRAG ────────────────────────────────────────────────────
let dragNode   = null;
let dragOffset = { x: 0, y: 0 };

function nodeMouseDown(ev) {
  // ignore connector clicks
  if (ev.target.classList.contains('connector')) return;
  if (ev.target.classList.contains('ball'))      return;
  dragNode   = ev.currentTarget;
  canvasRect = canvas.getBoundingClientRect();

  const r = dragNode.getBoundingClientRect();
  dragOffset.x = ev.clientX - r.left;
  dragOffset.y = ev.clientY - r.top;

  document.addEventListener('mousemove', nodeMouseMove);
  document.addEventListener('mouseup',   nodeMouseUp);
}

function nodeMouseMove(ev) {
  const cx = ev.clientX - canvasRect.left - dragOffset.x;
  const cy = ev.clientY - canvasRect.top  - dragOffset.y;
  dragNode.style.left = cx + 'px';
  dragNode.style.top  = cy + 'px';
  refreshAllPaths();
}

function nodeMouseUp() {
  document.removeEventListener('mousemove', nodeMouseMove);
  document.removeEventListener('mouseup',   nodeMouseUp);
  dragNode = null;
}

// ─── CONNECTION DRAWING ───────────────────────────────────────────
function startConnection(ev) {
  ev.stopPropagation(); ev.preventDefault();
  drawing    = true;
  // either wrapper or ball
  startConn  = ev.currentTarget.classList.contains('connector')
               ? ev.currentTarget
               : ev.currentTarget.parentNode;
  canvasRect = canvas.getBoundingClientRect();

  // if dragging from an input, keep its ball visible
  if (startConn.dataset.dir === 'input') {
    startConn.classList.add('connected');
  }

  svg.setAttribute('viewBox', `0 0 ${canvasRect.width} ${canvasRect.height}`);
  snapConn   = null;

  svg.style.zIndex = 4;   // above everything while you draw
  document.querySelectorAll('.canvas-node')
    .forEach(n => n.style.opacity = 1);

  currPath = document.createElementNS('http://www.w3.org/2000/svg','path');
  currPath.setAttribute('stroke',
    startConn.dataset.type==='source'?'#3498db':'#e67e22');
  currPath.setAttribute('fill','none');
  currPath.setAttribute('stroke-width','2');
  svg.appendChild(currPath);

  document.addEventListener('mousemove', drawConnection);
  document.addEventListener('mouseup',   endConnection);
}

function drawConnection(ev) {
  const start = getCenter(startConn);
  const rawEnd = {
    x: ev.clientX - canvasRect.left,
    y: ev.clientY - canvasRect.top
  };

  // snapping
  snapConn = null;
  document.querySelectorAll('.connector').forEach(c => {
    if (c===startConn) return;
    if (c.dataset.type!==startConn.dataset.type) return;
    if (c.dataset.dir ===startConn.dataset.dir) return;
    const ctr = getCenter(c);
    if (Math.hypot(ctr.x-rawEnd.x, ctr.y-rawEnd.y) < 15) {
      snapConn = c;
    }
  });

  const end = snapConn ? getCenter(snapConn) : rawEnd;
  const H   = 40;
  const cp1x = start.x + (startConn.dataset.dir==='output'? H : -H);
  const cp2x = end.x   + (startConn.dataset.dir==='output'?-H:  H);

  currPath.setAttribute('d',
    `M${start.x},${start.y}` +
    ` C${cp1x},${start.y} ${cp2x},${end.y} ${end.x},${end.y}`
  );

  // highlight input when snapping
  document.querySelectorAll('.connector.input')
    .forEach(c=>c.classList.remove('snapping'));
  if (snapConn && snapConn.classList.contains('input')) {
    snapConn.classList.add('snapping');
  }
}

function endConnection(ev) {
  document.removeEventListener('mousemove', drawConnection);
  document.removeEventListener('mouseup',   endConnection);

  svg.style.zIndex = 2;   // back under the nodes, but above the canvas
  document.querySelectorAll('.canvas-node')
    .forEach(n => n.style.opacity = 0.85);

  document.querySelectorAll('.connector.input')
    .forEach(c=>c.classList.remove('snapping'));

  let dropEl = snapConn;
  if (!dropEl) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (el &&
        el.classList.contains('connector') &&
        el.dataset.type===startConn.dataset.type &&
        el.dataset.dir !== startConn.dataset.dir) {
      dropEl = el;
    }
  }

  if (dropEl) {
    if (dropEl.classList.contains('input')) {
      dropEl.classList.add('connected');
    }
    const start = getCenter(startConn);
    const end   = getCenter(dropEl);
    const H     = 40;
    const cp1x  = start.x + (startConn.dataset.dir==='output'? H : -H);
    const cp2x  = end.x   + (startConn.dataset.dir==='output'?-H:  H);

    currPath.setAttribute('d',
      `M${start.x},${start.y}` +
      ` C${cp1x},${start.y} ${cp2x},${end.y} ${end.x},${end.y}`
    );

    connections.push({ path: currPath, from: startConn, to: dropEl });
  } else {
    svg.removeChild(currPath);
  }

  currPath  = null;
  startConn = null;
  snapConn  = null;
}

// ─── KEEP WIRES GLUED ─────────────────────────────────────────────
function refreshAllPaths() {
  canvasRect = canvas.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${canvasRect.width} ${canvasRect.height}`);
  connections.forEach(conn => {
    const s = getCenter(conn.from);
    const e = getCenter(conn.to);
    const H = 40;
    const cp1x = s.x + (conn.from.dataset.dir==='output'? H : -H);
    const cp2x = e.x   + (conn.from.dataset.dir==='output'?-H:  H);

    conn.path.setAttribute('d',
      `M${s.x},${s.y}` +
      ` C${cp1x},${s.y} ${cp2x},${e.y} ${e.x},${e.y}`
    );
  });
}

// ─── UTILITY ──────────────────────────────────────────────────────
function getCenter(el) {
  const r = el.getBoundingClientRect();
  return {
    x: r.left - canvasRect.left + r.width/2,
    y: r.top  - canvasRect.top  + r.height/2
  };
}

// ─── TAB SWITCHING ─────────────────────────────────────────────────
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button')
      .forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content')
      .forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.remove('hidden');
  });
});
