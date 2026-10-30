// Layered (Sugiyama-style) layout for Hasse diagrams.
//
//   layered(nodes, edges) where nodes = [{w, h}], edges = [[u, v]] with u
//   stronger than v (u is drawn above v). Returns centers for every node and a
//   polyline for every edge (routed through dummy vertices on long edges).
//
// Steps: longest-path layering (strength reads vertically), dummy vertices,
// barycentric crossing reduction with best-of sweeps, then x-coordinates by
// iterated neighbour averaging under non-overlap constraints.

export function layered(nodes, edges, opt = {}) {
  const hgap = opt.hgap ?? 26;
  const vgap = opt.vgap ?? 64;
  const sweeps = opt.sweeps ?? 24;
  const n = nodes.length;
  if (!n) return { nodes: [], edges: [], width: 0, height: 0 };

  const succ = nodes.map(() => []);
  const pred = nodes.map(() => []);
  for (const [u, v] of edges) { succ[u].push(v); pred[v].push(u); }

  // --- layering ------------------------------------------------------------
  const indeg = pred.map((p) => p.length);
  const topo = [];
  const stack = nodes.map((_, i) => i).filter((i) => indeg[i] === 0);
  while (stack.length) {
    const v = stack.shift();
    topo.push(v);
    for (const w of succ[v]) if (--indeg[w] === 0) stack.push(w);
  }
  if (topo.length < n) throw new Error('layout: graph has a cycle');
  const layer = new Array(n).fill(0);
  for (const v of topo) for (const w of succ[v]) layer[w] = Math.max(layer[w], layer[v] + 1);
  // pull sources down next to their highest successor (shorter edges)
  for (let k = topo.length - 1; k >= 0; k--) {
    const v = topo[k];
    if (pred[v].length === 0 && succ[v].length) layer[v] = Math.min(...succ[v].map((w) => layer[w])) - 1;
  }
  const minL = Math.min(...layer);
  for (let i = 0; i < n; i++) layer[i] -= minL;
  const L = Math.max(...layer) + 1;

  // --- virtual graph with dummies -----------------------------------------
  const V = nodes.map((nd, i) => ({ w: nd.w, h: nd.h, layer: layer[i], real: i }));
  const up = V.map(() => []);   // neighbours in layer - 1
  const down = V.map(() => []); // neighbours in layer + 1
  const chains = edges.map(([u, v]) => {
    const chain = [u];
    let prev = u;
    for (let l = layer[u] + 1; l < layer[v]; l++) {
      const d = V.length;
      V.push({ w: 6, h: 0, layer: l, real: -1 });
      up.push([]); down.push([]);
      down[prev].push(d); up[d].push(prev);
      chain.push(d);
      prev = d;
    }
    down[prev].push(v); up[v].push(prev);
    chain.push(v);
    return chain;
  });

  // --- ordering ------------------------------------------------------------
  const layers = Array.from({ length: L }, () => []);
  // initial: DFS order from the top so that related nodes start together
  const seen = new Set();
  const visit = (v) => {
    if (seen.has(v)) return;
    seen.add(v);
    layers[V[v].layer].push(v);
    for (const w of down[v]) visit(w);
  };
  topo.forEach(visit);
  for (let v = 0; v < V.length; v++) if (!seen.has(v)) visit(v);

  const pos = new Array(V.length);
  const setPos = () => layers.forEach((ly) => ly.forEach((v, i) => (pos[v] = i)));
  setPos();

  const crossings = () => {
    let c = 0;
    for (let l = 0; l < L - 1; l++) {
      const es = [];
      for (const v of layers[l]) for (const w of down[v]) es.push([pos[v], pos[w]]);
      for (let i = 0; i < es.length; i++)
        for (let j = i + 1; j < es.length; j++)
          if ((es[i][0] - es[j][0]) * (es[i][1] - es[j][1]) < 0) c++;
    }
    return c;
  };

  let best = layers.map((ly) => [...ly]);
  let bestC = crossings();
  for (let it = 0; it < sweeps && bestC > 0; it++) {
    const goingDown = it % 2 === 0;
    const range = goingDown ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].reverse().slice(1);
    for (const l of range) {
      const nb = goingDown ? up : down;
      const bc = new Map();
      for (const v of layers[l]) {
        const ps = nb[v].map((w) => pos[w]);
        bc.set(v, ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos[v]);
      }
      layers[l].sort((a, b) => bc.get(a) - bc.get(b) || pos[a] - pos[b]);
      layers[l].forEach((v, i) => (pos[v] = i));
    }
    const c = crossings();
    if (c < bestC) { bestC = c; best = layers.map((ly) => [...ly]); }
  }
  for (let l = 0; l < L; l++) layers[l] = best[l];
  setPos();

  // --- x coordinates -------------------------------------------------------
  const x = new Array(V.length).fill(0);
  const sep = (a, b) => (V[a].w + V[b].w) / 2 + (V[a].real < 0 && V[b].real < 0 ? 8 : hgap);
  for (const ly of layers) {
    let cur = 0;
    ly.forEach((v, i) => { if (i) cur += sep(ly[i - 1], v); x[v] = cur; });
    const mid = cur / 2;
    ly.forEach((v) => (x[v] -= mid));
  }
  const place = (ly, desired) => {
    const k = ly.length;
    const f = new Array(k), b = new Array(k);
    for (let i = 0; i < k; i++) f[i] = i ? Math.max(desired[i], f[i - 1] + sep(ly[i - 1], ly[i])) : desired[i];
    for (let i = k - 1; i >= 0; i--) b[i] = i < k - 1 ? Math.min(desired[i], b[i + 1] - sep(ly[i], ly[i + 1])) : desired[i];
    ly.forEach((v, i) => (x[v] = (f[i] + b[i]) / 2));
  };
  for (let it = 0; it < 40; it++) {
    const order = it % 2 === 0 ? [...Array(L).keys()] : [...Array(L).keys()].reverse();
    for (const l of order) {
      const ly = layers[l];
      const desired = ly.map((v) => {
        const nb = [...up[v], ...down[v]];
        if (!nb.length) return x[v];
        // dummies pull harder so that long edges straighten
        let s = 0, wsum = 0;
        for (const w of nb) { const wt = V[w].real < 0 || V[v].real < 0 ? 2 : 1; s += x[w] * wt; wsum += wt; }
        return s / wsum;
      });
      place(ly, desired);
    }
  }

  // --- y coordinates -------------------------------------------------------
  const lh = layers.map((ly) => Math.max(0, ...ly.map((v) => V[v].h)));
  const ly0 = [];
  let yc = 0;
  for (let l = 0; l < L; l++) { ly0.push(yc + lh[l] / 2); yc += lh[l] + vgap; }
  const y = V.map((v) => ly0[v.layer]);

  let minX = Infinity, maxX = -Infinity;
  V.forEach((v, i) => { minX = Math.min(minX, x[i] - v.w / 2); maxX = Math.max(maxX, x[i] + v.w / 2); });
  const dx = -minX;

  return {
    nodes: nodes.map((nd, i) => ({ x: x[i] + dx, y: y[i], w: nd.w, h: nd.h, layer: layer[i] })),
    edges: chains.map((chain) => {
      const pts = chain.map((v) => [x[v] + dx, y[v]]);
      const u = chain[0], v = chain[chain.length - 1];
      pts[0] = [pts[0][0], pts[0][1] + V[u].h / 2];
      pts[pts.length - 1] = [pts[pts.length - 1][0], pts[pts.length - 1][1] - V[v].h / 2];
      return pts;
    }),
    width: maxX - minX,
    height: yc - vgap,
  };
}

// Smooth path through points with vertical tangents at each point.
export function verticalSpline(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const dy = (y1 - y0) * 0.5;
    d += ` C${x0.toFixed(1)},${(y0 + dy).toFixed(1)} ${x1.toFixed(1)},${(y1 - dy).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}
