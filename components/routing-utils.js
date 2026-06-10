const GRID_SIZE = 0.000045;

export function getDistanceMeters(p1, p2) {
  const R = 6371000;
  const lat1 = (p1[1] * Math.PI) / 180;
  const lat2 = (p2[1] * Math.PI) / 180;
  const dlat = lat2 - lat1;
  const dlng = ((p2[0] - p1[0]) * Math.PI) / 180;
  const x = dlng * Math.cos((lat1 + lat2) / 2);
  return R * Math.sqrt(x * x + dlat * dlat);
}

function segmentIntersection(a1, a2, b1, b2) {
  const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
  const denom = dy2 * dx1 - dx2 * dy1;
  if (Math.abs(denom) < 1e-12) return null;
  const dx3 = b1[0] - a1[0], dy3 = b1[1] - a1[1];
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;
  // Allow inclusive bounds to capture T-junctions and endpoint touching
  if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
    return [a1[0] + t * dx1, a1[1] + t * dy1];
  }
  return null;
}

function coordDistSq(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/* ===== Min-Heap for Dijkstra ===== */
class MinHeap {
  constructor() { this.data = []; }
  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }
  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }
  get size() { return this.data.length; }
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].dist <= this.data[i].dist) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }
  _sinkDown(i) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1, right = 2 * i + 2;
      if (left < n && this.data[left].dist < this.data[smallest].dist) smallest = left;
      if (right < n && this.data[right].dist < this.data[smallest].dist) smallest = right;
      if (smallest === i) break;
      [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
      i = smallest;
    }
  }
}

/**
 * Build a routing graph from GeoJSON LineStrings and Polygon boundaries.
 * Returns junction nodes (intersections, endpoints) and direct segments between them.
 */
export function buildRoadGraph(geojson) {
  if (!geojson || !geojson.features) return null;

  const lineStrings = geojson.features.filter(
    (f) => f.geometry?.type === "LineString"
  );
  if (lineStrings.length === 0) return null;

  // Also collect polygon boundary segments for intersection detection
  const polygons = geojson.features.filter(
    (f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon"
  );

  // --- Phase 1: Build line segments ---
  const lineSegments = [];
  lineStrings.forEach((ls, lineIdx) => {
    const coords = ls.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      lineSegments.push({ p1: coords[i], p2: coords[i + 1], lineIdx, isLine: true });
    }
  });

  // Build polygon boundary segments (for intersection only, not for routing edges)
  const polySegments = [];
  polygons.forEach((poly, polyIdx) => {
    const rings = poly.geometry.type === "Polygon"
      ? poly.geometry.coordinates
      : poly.geometry.coordinates.flat(1); // MultiPolygon → flatten one level
    rings.forEach((ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        polySegments.push({ p1: ring[i], p2: ring[i + 1], polyIdx, isLine: false });
      }
    });
  });

  // --- Phase 2: Find intersections between Line-Line and Line-Polygon ---
  const CELL = 0.0005; // ~55m grid

  // Grid for line segments
  const lineGrid = {};
  lineSegments.forEach((seg, idx) => {
    const minX = Math.min(seg.p1[0], seg.p2[0]);
    const maxX = Math.max(seg.p1[0], seg.p2[0]);
    const minY = Math.min(seg.p1[1], seg.p2[1]);
    const maxY = Math.max(seg.p1[1], seg.p2[1]);

    const startCx = Math.floor(minX / CELL);
    const endCx = Math.floor(maxX / CELL);
    const startCy = Math.floor(minY / CELL);
    const endCy = Math.floor(maxY / CELL);

    for (let cx = startCx; cx <= endCx; cx++) {
      for (let cy = startCy; cy <= endCy; cy++) {
        const key = `${cx},${cy}`;
        if (!lineGrid[key]) lineGrid[key] = [];
        lineGrid[key].push(idx);
      }
    }
  });

  // Grid for polygon segments
  const polyGrid = {};
  polySegments.forEach((seg, idx) => {
    const minX = Math.min(seg.p1[0], seg.p2[0]);
    const maxX = Math.max(seg.p1[0], seg.p2[0]);
    const minY = Math.min(seg.p1[1], seg.p2[1]);
    const maxY = Math.max(seg.p1[1], seg.p2[1]);

    const startCx = Math.floor(minX / CELL);
    const endCx = Math.floor(maxX / CELL);
    const startCy = Math.floor(minY / CELL);
    const endCy = Math.floor(maxY / CELL);

    for (let cx = startCx; cx <= endCx; cx++) {
      for (let cy = startCy; cy <= endCy; cy++) {
        const key = `${cx},${cy}`;
        if (!polyGrid[key]) polyGrid[key] = [];
        polyGrid[key].push(idx);
      }
    }
  });

  const splitPoints = lineSegments.map(() => []);
  const checkedLineLine = new Set();

  // Line-Line intersections (only between different lines)
  for (const key in lineGrid) {
    const cell = lineGrid[key];
    if (cell.length < 2) continue;
    for (let i = 0; i < cell.length; i++) {
      for (let j = i + 1; j < cell.length; j++) {
        const idxA = cell[i], idxB = cell[j];
        const minIdx = Math.min(idxA, idxB);
        const maxIdx = Math.max(idxA, idxB);
        const pairKey = minIdx * 1000000 + maxIdx;
        if (checkedLineLine.has(pairKey)) continue;
        checkedLineLine.add(pairKey);

        const sA = lineSegments[idxA], sB = lineSegments[idxB];
        if (sA.lineIdx === sB.lineIdx) continue;
        const pt = segmentIntersection(sA.p1, sA.p2, sB.p1, sB.p2);
        if (!pt) continue;

        // Only split sA if the intersection point is not too close to its endpoints
        if (coordDistSq(pt, sA.p1) > 1e-10 && coordDistSq(pt, sA.p2) > 1e-10) {
          if (!splitPoints[idxA].some((sp) => coordDistSq(sp, pt) < 1e-10))
            splitPoints[idxA].push(pt);
        }
        // Only split sB if the intersection point is not too close to its endpoints
        if (coordDistSq(pt, sB.p1) > 1e-10 && coordDistSq(pt, sB.p2) > 1e-10) {
          if (!splitPoints[idxB].some((sp) => coordDistSq(sp, pt) < 1e-10))
            splitPoints[idxB].push(pt);
        }
      }
    }
  }

  const checkedLinePoly = new Set();

  // Line-Polygon intersections (add split points only to line segments)
  for (const key in lineGrid) {
    const lineCellIdxs = lineGrid[key] || [];
    const polyCellIdxs = polyGrid[key] || [];
    if (lineCellIdxs.length === 0 || polyCellIdxs.length === 0) continue;

    for (const lineIdx of lineCellIdxs) {
      const sLine = lineSegments[lineIdx];
      for (const polyIdx of polyCellIdxs) {
        const pairKey = lineIdx * 1000000 + polyIdx;
        if (checkedLinePoly.has(pairKey)) continue;
        checkedLinePoly.add(pairKey);

        const sPoly = polySegments[polyIdx];
        const pt = segmentIntersection(sLine.p1, sLine.p2, sPoly.p1, sPoly.p2);
        if (!pt) continue;

        // Only split sLine if it's not too close to its endpoints
        if (coordDistSq(pt, sLine.p1) > 1e-10 && coordDistSq(pt, sLine.p2) > 1e-10) {
          if (!splitPoints[lineIdx].some((sp) => coordDistSq(sp, pt) < 1e-10))
            splitPoints[lineIdx].push(pt);
        }
      }
    }
  }

  // --- Phase 3: Rebuild line coordinates with split points ---
  const expandedCoords = [];
  let segOffset = 0;
  lineStrings.forEach((ls) => {
    const coords = ls.geometry.coordinates;
    const result = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const segIdx = segOffset + i;
      result.push(coords[i]);
      if (splitPoints[segIdx].length > 0) {
        const sorted = splitPoints[segIdx].slice().sort(
          (a, b) => coordDistSq(a, coords[i]) - coordDistSq(b, coords[i])
        );
        result.push(...sorted);
      }
    }
    result.push(coords[coords.length - 1]);
    expandedCoords.push(result);
    segOffset += coords.length - 1;
  });

  // --- Phase 4: Find Nodes (Junctions and Endpoints) ---
  const nodeGrid = {};
  const nodes = [];
  const nodeToLines = {};
  const nodeToFeatureIds = {};
  const nodeIsEndpoint = {};

  const getGridCell = (p) => [
    Math.floor(p[0] / GRID_SIZE),
    Math.floor(p[1] / GRID_SIZE),
  ];

  const getOrCreateNode = (p, lineIdx, featureId, isEnd) => {
    const cell = getGridCell(p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cell[0] + dx},${cell[1] + dy}`;
        if (nodeGrid[key]) {
          for (const nIdx of nodeGrid[key]) {
            if (getDistanceMeters(p, nodes[nIdx]) < 5.0) {
              nodeToLines[nIdx].add(lineIdx);
              nodeToFeatureIds[nIdx].add(featureId);
              if (isEnd) nodeIsEndpoint[nIdx] = true;
              return nIdx;
            }
          }
        }
      }
    }
    const nIdx = nodes.length;
    nodes.push(p);
    nodeToLines[nIdx] = new Set([lineIdx]);
    nodeToFeatureIds[nIdx] = new Set([featureId]);
    nodeIsEndpoint[nIdx] = isEnd;
    const key = `${cell[0]},${cell[1]}`;
    if (!nodeGrid[key]) nodeGrid[key] = [];
    nodeGrid[key].push(nIdx);
    return nIdx;
  };

  const lineNodeLists = expandedCoords.map((coords, lIdx) => {
    const featureId = lineStrings[lIdx].id;
    return coords.map((c, cIdx) => {
      const isEnd = cIdx === 0 || cIdx === coords.length - 1;
      return getOrCreateNode(c, lIdx, featureId, isEnd);
    });
  });

  const isJunctionNode = new Array(nodes.length).fill(false);
  for (let i = 0; i < nodes.length; i++) {
    if (nodeToLines[i].size >= 2 || nodeIsEndpoint[i]) {
      isJunctionNode[i] = true;
    }
  }

  // --- Phase 5: Build Junction Graph (Segments between Junctions) ---
  const adj = {};
  for (let i = 0; i < nodes.length; i++) {
    if (isJunctionNode[i]) {
      adj[i] = [];
    }
  }

  lineNodeLists.forEach((nodeList, lIdx) => {
    const featureId = lineStrings[lIdx].id;
    const coords = expandedCoords[lIdx];
    
    let lastJunctionIdx = -1;
    let currentSegmentCoords = [];

    nodeList.forEach((nIdx, cIdx) => {
      const pt = coords[cIdx];
      
      if (lastJunctionIdx === -1) {
        if (isJunctionNode[nIdx]) {
          lastJunctionIdx = nIdx;
          currentSegmentCoords = [[pt[1], pt[0]]]; // [lat, lng]
        }
      } else {
        currentSegmentCoords.push([pt[1], pt[0]]);
        if (isJunctionNode[nIdx]) {
          let length = 0;
          for (let k = 0; k < currentSegmentCoords.length - 1; k++) {
            const pA = [currentSegmentCoords[k][1], currentSegmentCoords[k][0]];
            const pB = [currentSegmentCoords[k+1][1], currentSegmentCoords[k+1][0]];
            length += getDistanceMeters(pA, pB);
          }

          adj[lastJunctionIdx].push({
            to: nIdx,
            featureId,
            coords: [...currentSegmentCoords],
            length,
          });
          adj[nIdx].push({
            to: lastJunctionIdx,
            featureId,
            coords: [...currentSegmentCoords].reverse(),
            length,
          });

          lastJunctionIdx = nIdx;
          currentSegmentCoords = [[pt[1], pt[0]]];
        }
      }
    });
  });

  const junctionNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    if (isJunctionNode[i]) {
      junctionNodes.push({
        idx: i,
        position: [nodes[i][1], nodes[i][0]],
        isJunction: nodeToLines[i].size >= 2,
        lineCount: nodeToLines[i].size,
        featureIds: [...nodeToFeatureIds[i]],
      });
    }
  }

  return { nodes, junctionNodes, adj };
}

/**
 * Find the shortest path between two junction nodes using Dijkstra with MinHeap.
 */
export function findShortestPath(startJunctionIdx, endJunctionIdx, graph) {
  if (!graph || !graph.adj) return { distance: Infinity, segments: [] };

  const adj = graph.adj;
  const dist = {};
  const prev = {};
  const visited = new Set();
  const heap = new MinHeap();

  // Only initialize start node
  dist[startJunctionIdx] = 0;
  heap.push({ node: startJunctionIdx, dist: 0 });

  while (heap.size > 0) {
    const { node: u, dist: d } = heap.pop();

    if (visited.has(u)) continue;
    visited.add(u);

    if (u === endJunctionIdx) break;

    // Skip if we found a better path already
    if (d > (dist[u] ?? Infinity)) continue;

    const neighbors = adj[u] || [];
    for (const edge of neighbors) {
      const v = edge.to;
      if (visited.has(v)) continue;
      const alt = dist[u] + edge.length;
      if (alt < (dist[v] ?? Infinity)) {
        dist[v] = alt;
        prev[v] = { from: u, edge };
        heap.push({ node: v, dist: alt });
      }
    }
  }

  if ((dist[endJunctionIdx] ?? Infinity) === Infinity) {
    return { distance: Infinity, segments: [] };
  }

  const segments = [];
  let curr = endJunctionIdx;
  while (prev[curr]) {
    const { from, edge } = prev[curr];
    segments.push({
      featureId: edge.featureId,
      coords: edge.coords,
    });
    curr = from;
  }
  segments.reverse();

  return { distance: dist[endJunctionIdx], segments };
}

/**
 * Calculate the center coordinate [lat, lng] of a GeoJSON feature
 */
export function getFeatureCenter(feature) {
  if (!feature || !feature.geometry) return null;
  const geom = feature.geometry;
  if (geom.type === "Point") return [geom.coordinates[1], geom.coordinates[0]];
  if (geom.type === "LineString") {
    const c = geom.coordinates, m = Math.floor(c.length / 2);
    return [c[m][1], c[m][0]];
  }
  if (geom.type === "Polygon") {
    const coords = geom.coordinates[0];
    if (!coords || !coords.length) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    coords.forEach(([lng, lat]) => {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    });
    return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  }
  if (geom.type === "MultiPolygon") {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    let has = false;
    geom.coordinates.forEach((p) => { if (p[0]) p[0].forEach(([lng, lat]) => {
      has = true;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    }); });
    if (!has) return null;
    return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  }
  return null;
}
