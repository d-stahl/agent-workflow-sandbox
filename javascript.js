// ─── STATE ────────────────────────────────────────────────────────
const canvas            = document.getElementById('canvas');
const svg               = document.getElementById('connections');
const panEl             = document.getElementById('pan-container');
const ws                = document.getElementById('workspace');
const connTypes         = {};
const connCurveRigidity = 200;
let connections         = [];
let nodesData           = {};
let drawing             = false;
let currPath            = null;
let startConn           = null;
let snapConn            = null;
let canvasRect          = null;
let currentHoveredPath  = null;
let panX                = 0;
let panY                = 0;
let isPanning           = false;
let panStart            = {x:0,y:0};

const nodeResizeObserver = new ResizeObserver(() => {
  // update canvas metrics, then re-layout every path
  canvasRect = canvas.getBoundingClientRect();
  refreshAllPaths();
});

// LOAD CONNECTION TYPES
fetch('nodes/connections.json')
  .then(r => r.json())
  .then(arr => {
    arr.forEach(def => {
      connTypes[def.id] = def;
    });
  })
  .catch(err => {
    console.error('Failed to load connection types:', err);
  });

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

ws.addEventListener('dragover', e => e.preventDefault());
ws.addEventListener('drop',      onCanvasDrop);

function onCanvasDrop(ev) {
  ev.preventDefault();

  // decode the item
  const [tab, disp] = ev.dataTransfer.getData('text/plain').split('::');
  if (!tab) return;
  const item = (nodesData[tab]||[]).find(i => 
       i['display-text']===disp || i.displayText===disp || i.name===disp
  );
  if (!item) return;

  // figure out where in panEl the drop happened
  const panRect = panEl.getBoundingClientRect();
  const clientX = ev.clientX - panRect.left;
  const clientY = ev.clientY - panRect.top;

  // finally create the node at our transformed coords
  createNode(tab, item, clientX, clientY);
}

// ─── NODE FACTORY ─────────────────────────────────────────────────
let nodeCounter = 0;
function createNode(tab, item, x, y) {
  const nd = document.createElement('div');
  nd.className  = 'canvas-node';
  nd.style.left = x + 'px';
  nd.style.top  = y + 'px';
  nd.dataset.tab = tab;
  nd.dataset.id  = 'node-' + (++nodeCounter);

  // Icon badge (unchanged)
  if (item.icon) {
    const icon = document.createElement('img');
    icon.className = 'node-icon';
    icon.src       = `images/${item.icon}`;
    nd.appendChild(icon);
  }

  // Title (unchanged)
  const h = document.createElement('div');
  h.className = 'title';
  h.innerText = item.displayText;
  nd.appendChild(h);

  // ─── BODY FLEX ROW ───────────────────────────────────
  const body = document.createElement('div');
  body.className = 'node-body';   // will be flex-row
  nd.appendChild(body);

  // 1) INPUTS COLUMN
  const colIn = document.createElement('div');
  colIn.className = 'col-inputs';
  body.appendChild(colIn);
  (item.inputs || []).forEach(type => {
    mkConn(colIn, 'input', type, tab);
  });

  // ─── PARAMETERS COLUMN ────────────────────────────────────────────
  const colParams = document.createElement('div');
  colParams.className = 'col-params';
  body.appendChild(colParams);

  (item.parameters || []).forEach((param, idx) => {
    // Row wrapper
    const row = document.createElement('div');
    row.className = 'param-row';

    // Label
    const lbl = document.createElement('label');
    lbl.className = 'param-label';
    lbl.innerText = param.displayText + ':';

    // Param field
    const field = createFieldForParam(param);
    field.className = 'param-field';

    // Assemble
    row.appendChild(lbl);
    row.appendChild(field);
    colParams.appendChild(row);
  });

  // 3) OUTPUTS COLUMN
  const colOut = document.createElement('div');
  colOut.className = 'col-outputs';
  body.appendChild(colOut);
  (item.outputs || []).forEach(type => {
    mkConn(colOut, 'output', type, tab);
  });

  // ─── TRIGGER SECTION ───────────────────────────────────────────
  if (item.trigger) {
    // container for adder + all trigger rows
    const trgSec = document.createElement('div');
    trgSec.className = 'trigger-section';
    nd.appendChild(trgSec);

    // a separator line
    const sep = document.createElement('div');
    sep.className = 'separator';
    trgSec.appendChild(sep);

    // the “Add new trigger” button
    const adder = document.createElement('div');
    adder.className = 'trigger-adder';
    adder.innerHTML = `<span class="trigger-adder-text">Add new trigger +</span>`;
    trgSec.appendChild(adder);

    // container for the actual trigger instances
    const trgList = document.createElement('div');
    trgList.className = 'trigger-list';
    trgSec.appendChild(trgList);

    // when clicked, instantiate one more trigger row
    adder.addEventListener('click', () => {
      addTriggerRow(trgList, item.trigger, tab);
    });
  }

  // ─── FOOTER: delete‑node button ───────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'node-footer';
  // button
  const btn = document.createElement('img');
  btn.className = 'node-delete-btn';
  btn.src       = 'images/delete.png';
  btn.alt       = 'Delete node';
  btn.title     = 'Delete this node';
  footer.appendChild(btn);
  nd.appendChild(footer);

  // delete logic
  btn.addEventListener('click', () => {
    // remove any connections to/from this node
    connections = connections.filter(c => {
      const keep = c.from.closest('.canvas-node') !== nd
                && c.to  .closest('.canvas-node') !== nd;
      if (!keep) c.path.remove();
      return keep;
    });
    // remove the node itself
    nd.remove();
  });

  // finally, mouse‑drag handler & attach
  nd.addEventListener('mousedown', nodeMouseDown);
  canvas.appendChild(nd);
  // watch for any size change (e.g. textarea resize) and refresh wires
  nodeResizeObserver.observe(nd);  
}

/**
 * Given a parameter definition, return the appropriate HTML input element,
 * with default/checked value applied.
 */
function createFieldForParam(param) {
  let field;
  switch (param.type) {
    case 'string':
      field = document.createElement('input');
      field.type = 'text';
      field.value = param.default != null ? param.default : '';
      break;

    case 'textfield':
      field = document.createElement('textarea');
      field.value = param.default != null ? param.default : '';
      break;

    case 'int':
      field = document.createElement('input');
      field.type = 'number';
      field.step = '1';
      if (param.min != null) field.min = param.min;
      if (param.max != null) field.max = param.max;
      field.value = param.default != null ? param.default : '';
      break;

    case 'boolean':
      field = document.createElement('input');
      field.type = 'checkbox';
      field.checked = Boolean(param.default);
      break;

    case 'dropdown':
      field = document.createElement('select');
      // build <option> for each value
      (param.options || []).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.innerText = opt;
        if (param.default === opt) {
          o.selected = true;
        }
        field.appendChild(o);
      });
      break;

    default:
      field = document.createElement('input');
      field.type = 'text';
      field.value = param.default != null ? param.default : '';
  }
  return field;
}

/**
 * container    – the <div class="trigger-list">
 * triggerDef   – the `item.trigger` object from JSON
 * category     – the node’s category so mkConn can color the output
 */
function addTriggerRow(container, triggerDef, category) {
  // separator above each row
  const sep = document.createElement('div');
  sep.className = 'separator';
  container.appendChild(sep);

  // the row
  const row = document.createElement('div');
  row.className = 'trigger-row';

  // left col: delete button
  const inC = document.createElement('div');
  inC.className = 'col-inputs';
  const delBtn = document.createElement('img');
  delBtn.className = 'trigger-delete-btn';
  delBtn.src       = 'images/delete.png';
  delBtn.alt       = 'Delete trigger';
  inC.appendChild(delBtn);
  row.appendChild(inC);

  // middle col: trigger parameters
  const pC = document.createElement('div');
  pC.className = 'col-params';
  (triggerDef.parameters || []).forEach(param => {
    const r = document.createElement('div');
    r.className = 'param-row';
    const lbl = document.createElement('label');
    lbl.className = 'param-label';
    lbl.innerText = param.displayText + ':';
    const f = createFieldForParam(param);
    f.className = 'param-field';
    r.appendChild(lbl);
    r.appendChild(f);
    pC.appendChild(r);
  });
  row.appendChild(pC);

  // right col: trigger output connector
  const outC = document.createElement('div');
  outC.className = 'col-outputs';
  const outConn = mkConn(outC, 'output', 'trigger', category);
  row.appendChild(outC);

  // deletion logic:
  delBtn.addEventListener('click', () => {
    // 1) remove any connections to/from this trigger output
    for (let i = connections.length - 1; i >= 0; i--) {
      const c = connections[i];
      if (c.from === outConn || c.to === outConn) {
        // if c.to was an input ball, clear its 'connected'
        if (c.to && c.to.dataset.dir === 'input') {
          c.to.classList.remove('connected');
        }
        // remove the SVG path
        c.path.remove();
        connections.splice(i,1);
      }
    }
    // 2) remove this separator and row
    sep.remove();
    row.remove();

    // 3) reflow all remaining wires
    refreshAllPaths();
  });

  container.appendChild(row);
}
function mkConn(container, dir, type) {
  const wrapper = document.createElement('div');
  wrapper.className   = `connector ${dir}`;
  wrapper.dataset.dir  = dir;
  wrapper.dataset.type = type;

  // set connector color
  const def = connTypes[type];
  const col = def ? def.color : '#888';        // fallback gray if missing
  wrapper.style.setProperty('--connColor', col);  wrapper.style.setProperty('--connColor', col);

  // the draggable ball
  const ball = document.createElement('div');
  ball.className = 'ball';
  wrapper.appendChild(ball);

  // start drag on both wrapper (for semicircle) and ball
  wrapper.addEventListener('mousedown', startConnection);
  ball   .addEventListener('mousedown', startConnection);

  container.appendChild(wrapper);
  return wrapper;
}

// ─── NODE DRAG ────────────────────────────────────────────────────
let dragNode   = null;
let dragOffset = { x: 0, y: 0 };

function nodeMouseDown(ev) {
    // don’t start a node‐drag if the user is clicking an input or textarea
    const tag = ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      return;
    }
  
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

  svg.style.zIndex = 4;

  // stroke color based on category
  const def = connTypes[startConn.dataset.type];
  const color = def ? def.color : '#555';

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
  const cp1x = start.x + (startConn.dataset.dir==='output' ?  connCurveRigidity : -connCurveRigidity);
  const cp2x = end.x   + (startConn.dataset.dir==='output' ? -connCurveRigidity :  connCurveRigidity);

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
    const cp1x  = start.x + (startConn.dataset.dir==='output' ?  connCurveRigidity : -connCurveRigidity);
    const cp2x  = end.x   + (startConn.dataset.dir==='output' ? -connCurveRigidity :  connCurveRigidity);

    currPath.setAttribute('d',
      `M${start.x},${start.y}` +
      ` C${cp1x},${start.y} ${cp2x},${end.y} ${end.x},${end.y}`
    );

    connections.push({ path: currPath, from: startConn, to: dropEl });
  } else {
    // no valid drop: toss the path
    svg.removeChild(currPath);
  }

  // give the path a CSS hook and remember its type
  currPath.classList.add('connection');
  currPath.dataset.type = startConn.dataset.type;

  // hover highlighting + popup
  currPath.addEventListener('mouseenter', onConnectionMouseEnter);
  currPath.addEventListener('mouseleave', onConnectionMouseLeave);

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
    const cp1x = s.x + (conn.from.dataset.dir==='output'? connCurveRigidity : -connCurveRigidity);
    const cp2x = e.x   + (conn.from.dataset.dir==='output'?-connCurveRigidity:  connCurveRigidity);

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

let connPopup = null;

function onConnectionMouseEnter(ev) {
  const path = ev.currentTarget;

  // show info popup beneath cursor
  const { clientX: x, clientY: y } = ev;
  showConnectionPopup(path, x, y);

  // highlight the path
  currentHoveredPath = path;
  currentHoveredPath.classList.add('hovered');
}

function onConnectionMouseLeave(ev) {
  const path = ev.currentTarget;
  // if we’re moving into the popup, do nothing
  if (connPopup && ev.relatedTarget && connPopup.contains(ev.relatedTarget)) {
    return;
  }
  path.classList.remove('hovered');
  hideConnectionPopup();
}

function showConnectionPopup(path, x, y) {
  hideConnectionPopup();  // only one at a time

  // lookup its human title
  const type = path.dataset.type;
  const info = connTypes[type] || { displayText: type };

  // build the popup container
  connPopup = document.createElement('div');
  connPopup.className = 'connection-popup';

  // 1) icon badge
  const icon = document.createElement('img');
  icon.className = 'node-icon';
  icon.src       = 'images/connection.png';
  icon.alt       = '';
  connPopup.appendChild(icon);

  // 2) title
  const title = document.createElement('div');
  title.className = 'title';
  title.innerText = info.displayText;
  connPopup.appendChild(title);

  // 3) delete button
  const del = document.createElement('img');
  del.className = 'delete-btn';
  del.src       = 'images/delete.png';
  del.alt       = 'Delete';
  del.addEventListener('click', () => {
    removeConnection(path);
    hideConnectionPopup();
  });
  connPopup.appendChild(del);

  // disappear when you leave the popup itself
  connPopup.addEventListener('mouseleave', hideConnectionPopup);

  const wsRect = ws.getBoundingClientRect();
  ws.appendChild(connPopup);

  // center horizontally: put left at cursor X, then shift back by 50%
  connPopup.style.left = `${x - wsRect.left}px`;
  connPopup.style.top  = `${y - wsRect.top + 12}px`;    // 12px below the cursor
  connPopup.style.transform = 'translateX(-50%)';
}

function hideConnectionPopup() {
  if (connPopup) {
    connPopup.remove();
    connPopup = null;
  }

  if(currentHoveredPath) {
    currentHoveredPath.classList.remove('hovered');
    currentHoveredPath = null;
  }
}

/**
 * Completely un‑hooks a connection:
 *  1. Remove the “connected” ball on the input endpoint
 *  2. Remove the SVG path from the canvas
 *  3. Remove the entry from our connections[] array
 */
function removeConnection(path) {
  // 1) find the stored connection object
  const idx = connections.findIndex(c => c.path === path);
  if (idx !== -1) {
    const conn = connections[idx];

    // 2) if its 'to' end is an input, clear the permanent marker
    if (conn.to && conn.to.dataset.dir === 'input') {
      conn.to.classList.remove('connected');
    }

    // 3) remove from our list
    connections.splice(idx, 1);
  }

  // 4) remove the visual line
  path.remove();
}

window.addEventListener('resize', () => {
  // update canvasRect in case workspace moved/grew
  canvasRect = canvas.getBoundingClientRect();
  refreshAllPaths();
});

// start pan when dragging on empty workspace
document.getElementById('workspace').addEventListener('mousedown', ev => {
  // ignore clicks on nodes, connectors, or popup
  if (ev.target.closest('.canvas-node, .connector, path.connection, .connection-popup')) {
    return;
  }
  isPanning = true;
  panStart.x = ev.clientX - panX;
  panStart.y = ev.clientY - panY;
  panEl.classList.add('panning');
  document.addEventListener('mousemove', onPanMove);
  document.addEventListener('mouseup',   onPanEnd);
});

function onPanMove(ev) {
  if (!isPanning) return;
  panX = ev.clientX - panStart.x;
  panY = ev.clientY - panStart.y;
  panEl.style.transform = `translate(${panX}px, ${panY}px)`;
}

function onPanEnd(ev) {
  isPanning = false;
  panEl.classList.remove('panning');
  document.removeEventListener('mousemove', onPanMove);
  document.removeEventListener('mouseup',   onPanEnd);
}