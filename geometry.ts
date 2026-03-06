
import { Point } from './types';

export const getDistance = (p1: Point, p2: Point) => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

export const getPolygonArea = (points: Point[]): number => {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += (p1.x * p2.y) - (p2.x * p1.y);
  }
  return Math.abs(area) / 2;
};

// Check if a point is inside a polygon
export const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Find horizontal segments inside the polygon at a specific Y coordinate
export const getRowSegments = (y: number, points: Point[]): { start: number, end: number }[] => {
  const intersections: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    
    if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
      const x = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
      intersections.push(x);
    }
  }
  
  intersections.sort((a, b) => a - b);
  const segments: { start: number, end: number }[] = [];
  for (let i = 0; i < intersections.length; i += 2) {
    if (i + 1 < intersections.length) {
      segments.push({ start: intersections[i], end: intersections[i+1] });
    }
  }
  return segments;
};

/**
 * Ensures full coverage for a row of height H by finding segments at multiple Y levels 
 * and taking the union (the bounding span). This prevents gaps at angled walls.
 */
export const getWideRowSegments = (yStart: number, yEnd: number, points: Point[]): { start: number, end: number }[] => {
  const steps = 3; // Check top, middle, bottom
  const allSegments: { start: number, end: number }[][] = [];
  
  for (let i = 0; i <= steps; i++) {
    const y = yStart + (yEnd - yStart) * (i / steps);
    allSegments.push(getRowSegments(y, points));
  }

  if (allSegments.flat().length === 0) return [];

  const flattened = allSegments.flat().sort((a, b) => a.start - b.start);
  const merged: { start: number, end: number }[] = [];
  
  if (flattened.length > 0) {
    let current = { ...flattened[0] };
    for (let i = 1; i < flattened.length; i++) {
      if (flattened[i].start <= current.end + 1) { // 1mm overlap tolerance
        current.end = Math.max(current.end, flattened[i].end);
        current.start = Math.min(current.start, flattened[i].start);
      } else {
        merged.push(current);
        current = { ...flattened[i] };
      }
    }
    merged.push(current);
  }

  return merged;
};

/**
 * Geometric Constraint Logic:
 * A polygon with side lengths s1, s2, ..., sn can exist if and only if
 * the longest side is strictly less than the sum of all other sides.
 */
export const isGeometricallyPossible = (lengths: number[]): boolean => {
  if (lengths.length < 3) return true;
  const sumAll = lengths.reduce((a, b) => a + b, 0);
  const maxSide = Math.max(...lengths);
  return maxSide < (sumAll - maxSide);
};

/**
 * Adjusts points by changing the length of edge i (from p[i] to p[i+1]).
 * It "pushes" the subsequent point in the same direction.
 */
export const movePointByLength = (points: Point[], edgeIndex: number, newLength: number): Point[] => {
  const newPoints = [...points];
  const p1 = points[edgeIndex];
  const nextIdx = (edgeIndex + 1) % points.length;
  const p2 = points[nextIdx];

  const currentDist = getDistance(p1, p2);
  if (currentDist === 0) return points;

  const dx = (p2.x - p1.x) / currentDist;
  const dy = (p2.y - p1.y) / currentDist;

  newPoints[nextIdx] = {
    x: p1.x + dx * newLength,
    y: p1.y + dy * newLength
  };

  return newPoints;
};

export const getBoundingBox = (points: Point[]) => {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
};

/**
 * Get distance from a point p to a line segment defined by a and b.
 */
export const getDistanceToSegment = (p: Point, a: Point, b: Point): number => {
  const l2 = Math.pow(getDistance(a, b), 2);
  if (l2 === 0) return getDistance(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return getDistance(p, {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y)
  });
};

export const projectPointOntoSegment = (p: Point, a: Point, b: Point): Point => {
  const l2 = Math.pow(getDistance(a, b), 2);
  if (l2 === 0) return { ...a };
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
};

export const findClosestEdge = (p: Point, points: Point[]): { index: number, distance: number } => {
  let minDistance = Infinity;
  let minIndex = -1;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dist = getDistanceToSegment(p, p1, p2);
    if (dist < minDistance) {
      minDistance = dist;
      minIndex = i;
    }
  }
  return { index: minIndex, distance: minDistance };
};

export const computeEdgeNormal = (points: Point[], edgeIdx: number): Point => {
  const n = points.length;
  const A = points[edgeIdx];
  const B = points[(edgeIdx + 1) % n];
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.0001) return { x: 0, y: 1 };
  return { x: -dy / len, y: dx / len };
};

/**
 * Translates edge i purely along its own normal by `amount`.
 * The dragged edge keeps its exact original length and angle.
 * Each adjacent edge chain propagates the displacement while maintaining its original direction
 * (only scaling in length). A single "free" edge opposite the dragged edge absorbs any residual.
 */
export const translateEdgeInPolygon = (points: Point[], edgeIdx: number, amount: number): Point[] => {
  const n = points.length;
  if (n < 3) return points;
  const A = points[edgeIdx];
  const B = points[(edgeIdx + 1) % n];
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.0001) return points;
  const normal = { x: -dy / len, y: dx / len };
  const delta = { x: amount * normal.x, y: amount * normal.y };

  const newPoints = [...points];
  newPoints[edgeIdx] = { x: A.x + delta.x, y: A.y + delta.y };
  newPoints[(edgeIdx + 1) % n] = { x: B.x + delta.x, y: B.y + delta.y };

  const backwardSteps = Math.floor((n - 2) / 2);
  const forwardSteps = n - 2 - backwardSteps;

  // Forward chain: from p[edgeIdx+2] going forward — run first to get fwdEndDelta
  let cur = { ...delta };
  for (let step = 1; step <= forwardSteps; step++) {
    const j = (edgeIdx + 1 + step) % n;
    const jPrev = (j - 1 + n) % n;
    const ex = points[j].x - points[jPrev].x;
    const ey = points[j].y - points[jPrev].y;
    const elen = Math.sqrt(ex * ex + ey * ey);
    if (elen < 0.0001) continue;
    const along = (cur.x * ex + cur.y * ey) / elen;
    cur = { x: cur.x - along * ex / elen, y: cur.y - along * ey / elen };
    newPoints[j] = { x: points[j].x + cur.x, y: points[j].y + cur.y };
  }
  const fwdEndDelta = { ...cur };

  // Backward chain: from p[edgeIdx-1] going backward, using 2x2 solve per vertex
  cur = { ...delta };
  for (let step = 1; step <= backwardSteps; step++) {
    const j = ((edgeIdx - step) + n) % n;
    const jNext = (j + 1) % n;
    const jPrev = (j - 1 + n) % n;

    // n_right: normal of edge (j → j+1)
    const erx = points[jNext].x - points[j].x;
    const ery = points[jNext].y - points[j].y;
    const erLen = Math.sqrt(erx * erx + ery * ery);
    if (erLen < 0.0001) continue;
    const nrx = -ery / erLen, nry = erx / erLen;

    // n_left: normal of edge (j-1 → j)
    const elx = points[j].x - points[jPrev].x;
    const ely = points[j].y - points[jPrev].y;
    const elLen = Math.sqrt(elx * elx + ely * ely);
    if (elLen < 0.0001) continue;
    const nlx = -ely / elLen, nly = elx / elLen;

    // rhs: [known_right · n_right, known_left · n_left]
    // known_right = cur (delta of j+1), known_left = fwdEndDelta (forward chain endpoint)
    const r1 = cur.x * nrx + cur.y * nry;
    const r2 = fwdEndDelta.x * nlx + fwdEndDelta.y * nly;

    // Solve [[nrx, nry], [nlx, nly]] * [dx, dy] = [r1, r2]
    const det = nrx * nly - nry * nlx;
    if (Math.abs(det) < 0.0001) continue;
    cur = {
      x: (r1 * nly - r2 * nry) / det,
      y: (nrx * r2 - nlx * r1) / det,
    };
    newPoints[j] = { x: points[j].x + cur.x, y: points[j].y + cur.y };
  }

  return newPoints;
};

/**
 * Snaps a point to 45 or 90 degree increments relative to a reference point.
 */
export const snapToAngle = (p: Point, ref: Point): Point => {
  const dx = p.x - ref.x;
  const dy = p.y - ref.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return p;

  const angle = Math.atan2(dy, dx);
  const snapIncrement = Math.PI / 4; // 45 degrees
  const snappedAngle = Math.round(angle / snapIncrement) * snapIncrement;

  return {
    x: ref.x + Math.cos(snappedAngle) * dist,
    y: ref.y + Math.sin(snappedAngle) * dist
  };
};
