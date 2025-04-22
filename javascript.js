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
['data-sources','agents','tools','utilities'].forEach(tab => {
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
    d.innerText    = item['displayText'];
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
  const [tab, disp] = ev.dataTransfer.getData('text/plain').split('::');
  if (!tab) return;
  // lookup the JSON item by its display-text
  const item = (nodesData[tab]||[]).find(i => i['displayText'] === disp);
  if (!item) return;
  createNode(tab, item, ev.offsetX, ev.offsetY);}

// ─── NODE FACTORY ─────────────────────────────────────────────────
let nodeCounter = 0;
function createNode(tab, item, x, y) {
  const nd = document.createElement('div');
  nd.className  = 'canvas-node';
  nd.style.left = x + 'px';
  nd.style.top  = y + 'px';
  nd.dataset.tab = tab;
  nd.dataset.id  = 'node-' + (++nodeCounter);

  // Title
  const h = document.createElement('div');
  h.className = 'title';
  h.innerText = item['displayText'];
  nd.appendChild(h);

  // Params
  if (Array.isArray(item.parameters) && item.parameters.length) {
    item.parameters.forEach(param => {
      const p = document.createElement('div');
      p.className = 'params';
      let inputHTML = '';
      if (param.type === 'string') {
        inputHTML = `<input type="text" value="${param.default||''}" />`;
      } else if (param.type === 'textfield') {
        inputHTML = `<textarea>${param.default||''}</textarea>`;
      }
      p.innerHTML = `${param.displayText}: ${inputHTML}`;
      nd.appendChild(p);
    });
  }

  // Input & Output containers
  const inC  = document.createElement('div');
  const outC = document.createElement('div');
  inC .className = 'input-container';
  outC.className = 'output-container';
  nd.appendChild(inC);
  nd.appendChild(outC);

  // Make connectors per JSON inputs/outputs
  (item.inputs||[]).forEach(type => {
    mkConn(inC, 'input', type);
  });
  (item.outputs||[]).forEach(type => {
    mkConn(outC,'output',type);
  });

  nd.addEventListener('mousedown', nodeMouseDown);
  canvas.appendChild(nd);
}

function mkConn(container, dir, type) {
  const wrapper = document.createElement('div');
  wrapper.className   = `connector ${dir}`;
  wrapper.dataset.dir  = dir;
  wrapper.dataset.type = type;

  // set connector color
  const col = (type === 'data' ? '#3498db' : '#e67e22');
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
  ev.stopPropagation();
  ev.preventDefault();
  drawing    = true;
  // pick the connector element itself
  startConn  = ev.currentTarget.classList.contains('connector')
               ? ev.currentTarget
               : ev.currentTarget.parentNode;
  canvasRect = canvas.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${canvasRect.width} ${canvasRect.height}`);
  snapConn   = null;

  // keep the origin input “lit up”
  if (startConn.dataset.dir === 'input') {
    startConn.classList.add('snapping');
  }

  // bring SVG forward & fade nodes
  svg.style.zIndex = 4;
  document.querySelectorAll('.canvas-node')
          .forEach(n => n.style.opacity = 1);

  // stroke color based on category
  const color = startConn.dataset.type === 'data'
              ? '#3498db'
              : '#e67e22';

  currPath = document.createElementNS('http://www.w3.org/2000/svg','path');
  currPath.setAttribute('stroke', color);
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

  // find a compatible snap target
  snapConn = null;
  document.querySelectorAll('.connector').forEach(c => {
    if (c === startConn) return;
    if (c.dataset.type  !== startConn.dataset.type) return;
    if (c.dataset.dir   === startConn.dataset.dir) return;
    const ctr = getCenter(c);
    if (Math.hypot(ctr.x - rawEnd.x, ctr.y - rawEnd.y) < 15) {
      snapConn = c;
    }
  });

  const end = snapConn ? getCenter(snapConn) : rawEnd;
  const H   = 40;
  const cp1x = start.x + (startConn.dataset.dir==='output' ?  H : -H);
  const cp2x = end.x   + (startConn.dataset.dir==='output' ? -H :  H);

  currPath.setAttribute('d',
    `M${start.x},${start.y}` +
    ` C${cp1x},${start.y} ${cp2x},${end.y} ${end.x},${end.y}`
  );

  // clear snapping on all *other* inputs
  document.querySelectorAll('.connector.input').forEach(c => {
    if (c !== startConn) c.classList.remove('snapping');
  });

  // highlight the target if it’s an input
  if (snapConn && snapConn.dataset.dir === 'input') {
    snapConn.classList.add('snapping');
  }
}

function endConnection(ev) {
  document.removeEventListener('mousemove', drawConnection);
  document.removeEventListener('mouseup',   endConnection);

  // restore layering & opacity
  svg.style.zIndex = 1;
  document.querySelectorAll('.canvas-node')
          .forEach(n => n.style.opacity = 0.85);

  // clear any snapping highlight on others
  document.querySelectorAll('.connector.input').forEach(c => {
    if (c !== startConn) c.classList.remove('snapping');
  });

  // figure out where we dropped
  let dropEl = snapConn;
  if (!dropEl) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (el &&
        el.classList.contains('connector') &&
        el.dataset.type === startConn.dataset.type &&
        el.dataset.dir  !== startConn.dataset.dir) {
      dropEl = el;
    }
  }

  if (dropEl) {
    dropEl.classList.add('connected');
    startConn.classList.add('connected');

    // redraw final path
    const start = getCenter(startConn);
    const end   = getCenter(dropEl);
    const H     = 40;
    const cp1x  = start.x + (startConn.dataset.dir==='output' ?  H : -H);
    const cp2x  = end.x   + (startConn.dataset.dir==='output' ? -H :  H);

    currPath.setAttribute('d',
      `M${start.x},${start.y}` +
      ` C${cp1x},${start.y} ${cp2x},${end.y} ${end.x},${end.y}`
    );

    connections.push({ path: currPath, from: startConn, to: dropEl });
  } else {
    // no valid drop: toss the path
    svg.removeChild(currPath);
  }

  // finally, always clear the origin’s temporary snapping
  if (startConn.dataset.dir === 'input') {
    startConn.classList.remove('snapping');
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
