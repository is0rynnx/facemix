"use strict";
var FaceMixFitting = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/engine/fitting.ts
  var fitting_exports = {};
  __export(fitting_exports, {
    CALIBRATION_VERSION: () => CALIBRATION_VERSION,
    FIT_VERSION: () => FIT_VERSION,
    fitLandmarks: () => fitLandmarks,
    headBoundary: () => headBoundary,
    observe: () => observe,
    oval: () => oval,
    point: () => point,
    reviewHeadBoundaries: () => reviewHeadBoundaries,
    semanticPoint: () => semanticPoint,
    semanticVertices: () => semanticVertices,
    transfer: () => transfer
  });

  // src/engine/contour-evidence.ts
  var adjacent = { p18: [162, 234], p19: [389, 454], p28: [127, 93], p29: [356, 323], p21: [93, 58], p61: [132, 172], p22: [58, 136], p24: [136, 148], p15: [148, 377], p25: [365, 400], p23: [288, 365], p20: [323, 288] };
  var upperFaceControls = /* @__PURE__ */ new Set(["p18", "p19", "p28", "p29"]);
  function sampleMask(mask, x, y) {
    if (!mask || x < 0 || y < 0 || x > 1 || y > 1) return 0;
    const px = x * mask.width - 0.5, py = y * mask.height - 0.5, ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    let sum = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) sum += mask.data[Math.max(0, Math.min(mask.height - 1, iy + j)) * mask.width + Math.max(0, Math.min(mask.width - 1, ix + i))] * (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
    return sum / 255;
  }
  function reviewFeatureEvidence(point2, region, masks) {
    if (!masks?.face || !["eyes", "brows", "nose", "mouth"].includes(region)) return point2;
    const face = sampleMask(masks.face, point2.x, point2.y), cover = Math.max(sampleMask(masks.hair, point2.x, point2.y), sampleMask(masks.clothing, point2.x, point2.y), sampleMask(masks.accessories, point2.x, point2.y));
    return face < 0.3 && cover > 0.65 ? { ...point2, confidence: Math.min(point2.confidence, 0.4), review: "Hair, clothing or an accessory may cover this feature. Check its position." } : point2;
  }
  function reviewFaceContour(point2, current, width, height, masks) {
    const indices = adjacent[point2.id];
    if (!point2.enabled || !masks?.face || !indices || !current[1] || indices.some((i) => !current[i])) return point2;
    const a = current[indices[0]], b = current[indices[1]], tx = (b.x - a.x) * width, ty = (b.y - a.y) * height, length = Math.hypot(tx, ty);
    const eyeA = current[33], eyeB = current[263];
    if (!eyeA || !eyeB || length < 1e-6) return point2;
    const span = Math.hypot((eyeA.x - eyeB.x) * width, (eyeA.y - eyeB.y) * height);
    let nx = -ty / length, ny = tx / length;
    if (nx * (point2.x - current[1].x) * width + ny * (point2.y - current[1].y) * height < 0) {
      nx = -nx;
      ny = -ny;
    }
    const radius = Math.max(2, Math.min(span * 0.24, Math.min(width, height) * 0.14)), texel = 1 / Math.hypot(nx * masks.face.width / width, ny * masks.face.height / height), probe = Math.max(span * 0.02, texel * 1.5), step = Math.min(texel * 0.5, radius / 8), sideWidth = Math.max(span * 6e-3, texel * 0.4);
    const face = sampleMask(masks.face, point2.x, point2.y), cover = Math.max(sampleMask(masks.hair, point2.x, point2.y), sampleMask(masks.body, point2.x, point2.y), sampleMask(masks.clothing, point2.x, point2.y), sampleMask(masks.accessories, point2.x, point2.y));
    if (face < 0.3 && cover > 0.5) return { ...point2, enabled: false, autoDisabled: true, confidence: 0.2, review: "Face boundary is covered. Place this control manually to use it." };
    const at = (distance) => {
      let value = 0;
      for (const side of [-sideWidth, 0, sideWidth]) value += sampleMask(masks.face, point2.x + (nx * distance + tx / length * side) / width, point2.y + (ny * distance + ty / length * side) / height);
      return value / 3;
    };
    const candidates = [];
    const start = face > 0.65 ? 0 : -radius;
    let previous = at(start);
    for (let d = start + step; d <= radius + 1e-9; d += step) {
      const value = at(d);
      if (previous >= 0.5 && value < 0.5) {
        const distance = d - step + step * (previous - 0.5) / Math.max(1e-9, previous - value), strength = at(distance - probe) - at(distance + probe);
        if (strength > 0.25 && at(distance - probe) > 0.55 && at(distance + probe) < 0.4) candidates.push({ distance, strength });
      }
      previous = value;
    }
    const best = candidates.sort((a2, b2) => Math.abs(a2.distance) - Math.abs(b2.distance))[0];
    if (!best) return { ...point2, confidence: Math.min(point2.confidence, 0.55), review: "Face boundary has weak image support. Check this control." };
    if (upperFaceControls.has(point2.id) && best.distance > Math.max(span * 0.012, texel * 0.75)) return { ...point2, confidence: Math.min(point2.confidence, 0.55), review: "Skin selection extends beyond the face contour. Detector position kept; check this control." };
    const xy = [point2.x + nx * best.distance / width, point2.y + ny * best.distance / height];
    if (xy.some((v) => v < 0 || v > 1)) return point2;
    return { ...point2, x: xy[0], y: xy[1], confidence: Math.min(0.9, 0.7 + best.strength * 0.2), review: void 0 };
  }
  function reviewContourShape(baseline, proposed, width, height) {
    const before = new Map(baseline.map((p) => [p.id, p])), after = new Map(proposed.map((p) => [p.id, p]));
    let rejected = false;
    const turn = (a, b, c) => {
      const u = [(b.x - a.x) * width, (b.y - a.y) * height], v = [(c.x - b.x) * width, (c.y - b.y) * height], length = Math.hypot(...u) * Math.hypot(...v);
      return length > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / length))) : 0;
    };
    const neighbors = { p28: ["p18", "p21"], p29: ["p20", "p19"] };
    const reviewed = proposed.map((p) => {
      const pair = neighbors[p.id], original = before.get(p.id);
      if (!pair || !original || !p.enabled || p.authored || p.locked || p.x === original.x && p.y === original.y) return p;
      const [a, c] = pair.map((id) => before.get(id)), [A, C] = pair.map((id) => after.get(id));
      if (!a || !c || !A || !C) return p;
      if (turn(A, p, C) <= Math.max(0.6, turn(a, original, c) + 0.35)) return p;
      rejected = true;
      return { ...p, x: original.x, y: original.y, confidence: Math.min(p.confidence, 0.55), review: "Skin selection has an abrupt upper-cheek bend. Detector position kept; check this control." };
    });
    return rejected ? reviewed : proposed;
  }

  // src/engine/head-evidence.ts
  function headMaskFromAnalysis(masks) {
    const layers = [masks?.face, masks?.hair, masks?.accessories].filter((m) => !!m);
    if (!masks?.face || !masks.hair || !layers.length) return;
    const { width, height } = masks.face;
    return { width, height, data: Uint8Array.from({ length: width * height }, (_, i) => Math.round(255 * Math.min(1, layers.reduce((sum, m) => sum + (m.width === width && m.height === height ? m.data[i] / 255 : sampleMask(m, (i % width + 0.5) / width, (Math.floor(i / width) + 0.5) / height)), 0)))) };
  }
  function reviewFrontOpening(seed, current, width, height, masks) {
    const face = masks.face, a = current[33], b = current[263], nose = current[1];
    if (!face || !a || !b || !nose || [a, b, nose].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { point: seed, supported: false };
    const span = Math.hypot((b.x - a.x) * width, (b.y - a.y) * height), dx = (seed[0] - nose.x) * width, dy = (seed[1] - nose.y) * height, length = Math.hypot(dx, dy);
    if (span < 4 || length < span * 0.25) return { point: seed, supported: false };
    const nx = dx / length, ny = dy / length, texel = 1 / Math.hypot(nx * face.width / width, ny * face.height / height), step = Math.max(0.5, texel * 0.5), side = Math.max(span * 0.025, texel);
    const at = (d) => {
      let sum = 0;
      for (const s of [-side, 0, side]) sum += sampleMask(face, nose.x + (nx * d - ny * s) / width, nose.y + (ny * d + nx * s) / height);
      return sum / 3;
    };
    let previous = at(length * 0.55);
    for (let d = length * 0.55 + step; d <= length + span * 0.25; d += step) {
      const value = at(d);
      if (previous >= 0.5 && value < 0.5) {
        const distance = d - step + step * (previous - 0.5) / Math.max(1e-9, previous - value), probe = Math.max(texel * 1.5, span * 0.025), p = [nose.x + nx * distance / width, nose.y + ny * distance / height];
        const cover = Math.max(sampleMask(masks.hair, p[0] + nx * probe / width, p[1] + ny * probe / height), sampleMask(masks.clothing, p[0] + nx * probe / width, p[1] + ny * probe / height), sampleMask(masks.accessories, p[0] + nx * probe / width, p[1] + ny * probe / height));
        if (p.every((v) => v > 0 && v < 1) && at(distance - probe) > 0.65 && at(distance + probe) < 0.35 && cover > 0.5) return { point: p, supported: true };
      }
      previous = value;
    }
    return { point: seed, supported: false };
  }

  // src/engine/quadratic-minima.ts
  function quadraticMinima(cost, scale) {
    const n = cost.length, result = new Uint8Array(n), vertices = new Uint8Array(n), limits = new Float64Array(n + 1);
    let top = 0;
    limits[0] = -Infinity;
    limits[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let p = vertices[top], cross = (cost[q] - cost[p]) / (2 * scale * (q - p)) + (q + p) / 2;
      while (top > 0 && cross <= limits[top]) {
        p = vertices[--top];
        cross = (cost[q] - cost[p]) / (2 * scale * (q - p)) + (q + p) / 2;
      }
      vertices[++top] = q;
      limits[top] = cross;
      limits[top + 1] = Infinity;
    }
    top = 0;
    for (let j = 0; j < n; j++) {
      while (limits[top + 1] < j) top++;
      result[j] = vertices[top];
    }
    return result;
  }

  // src/engine/visible-contour.ts
  var chain = [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356];
  var controls = { p18: [127], p28: [234], p21: [132], p61: [58], p22: [172], p24: [150, 149], p15: [152], p25: [379, 378], p23: [397], p20: [361], p29: [454], p19: [356] };
  var clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  var mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function reviewVisibleContour(landmarks, current, width, height, masks) {
    const face = masks?.face;
    if (!face || face.width < 16 || face.height < 16 || width <= 0 || height <= 0 || [...chain, 1, 33, 263].some((i) => !current[i] || !Number.isFinite(current[i].x) || !Number.isFinite(current[i].y))) return landmarks;
    const px = (i) => [current[i].x * width, current[i].y * height], left2 = px(33), right2 = px(263), span = Math.hypot(right2[0] - left2[0], right2[1] - left2[1]);
    if (span < 2) return landmarks;
    const eye = [(right2[0] - left2[0]) / span, (right2[1] - left2[1]) / span], down = [-eye[1], eye[0]], center = mix(left2, right2, 0.5), nose = px(1), chin = px(152), chinLevel = (chin[0] - center[0]) * down[0] + (chin[1] - center[1]) * down[1];
    if (chinLevel < span * 0.1) return landmarks;
    const seed = chain.map(px), lengths = [0];
    for (let i = 1; i < seed.length; i++) lengths.push(lengths[i - 1] + Math.hypot(seed[i][0] - seed[i - 1][0], seed[i][1] - seed[i - 1][1]));
    const total = lengths.at(-1);
    if (total < span * 0.2) return landmarks;
    const rows = 129, columns = 97, radius = span * 0.24, at = (i) => i * total / (rows - 1), sample = (p) => sampleMask(face, p[0] / width, p[1] / height);
    const base = Array.from({ length: rows }, (_, i) => {
      const t = at(i);
      let j = 1;
      while (j < lengths.length - 1 && lengths[j] < t) j++;
      return mix(seed[j - 1], seed[j], (t - lengths[j - 1]) / Math.max(1e-9, lengths[j] - lengths[j - 1]));
    });
    const covered = (p) => sample(p) < 0.3 && Math.max(...["hair", "body", "clothing", "accessories"].map((k) => sampleMask(masks?.[k], p[0] / width, p[1] / height))) > 0.5;
    const normals = [], support = [], usable = [], unary = [];
    const offsets = Float64Array.from({ length: columns }, (_, j) => -radius + j * 2 * radius / (columns - 1));
    for (let i = 0; i < rows; i++) {
      const a = base[Math.max(0, i - 1)], b = base[Math.min(rows - 1, i + 1)], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-9) return landmarks;
      let normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      if (normal[0] * (base[i][0] - nose[0]) + normal[1] * (base[i][1] - nose[1]) < 0) normal = [-normal[0], -normal[1]];
      const level = ((base[i][0] - center[0]) * down[0] + (base[i][1] - center[1]) * down[1]) / chinLevel, t = clamp((level - 0.5) / 0.45, 0, 1), blend = t * t * (3 - 2 * t), side = at(i) <= lengths[chain.indexOf(152)] ? -1 : 1;
      normal = [normal[0] * blend + side * eye[0] * (1 - blend), normal[1] * blend + side * eye[1] * (1 - blend)];
      const n = Math.hypot(...normal);
      if (n < 1e-6) return landmarks;
      normal = [normal[0] / n, normal[1] / n];
      normals.push(normal);
      const probe = Math.max(width / face.width, height / face.height, span * 0.012) * 1.5, row = new Float64Array(columns), strengths = new Float64Array(columns);
      for (let j = 0; j < columns; j++) {
        const d = offsets[j], point2 = [base[i][0] + normal[0] * d, base[i][1] + normal[1] * d], inside = sample([point2[0] - normal[0] * probe, point2[1] - normal[1] * probe]), outside = sample([point2[0] + normal[0] * probe, point2[1] + normal[1] * probe]);
        strengths[j] = Math.max(0, inside - outside);
        row[j] = 0.6 * Math.abs(sample(point2) - 0.5) - 0.8 * strengths[j] + 0.12 * (d / radius) ** 2;
      }
      const valid = Math.max(...strengths) > 0.22 && !covered(base[i]);
      usable.push(valid);
      if (!valid) for (let j = 0; j < columns; j++) row[j] = 0.5 * (offsets[j] / radius) ** 2;
      support.push(strengths);
      unary.push(row);
    }
    const transitionScale = 0.8 * (2 * radius / (columns - 1) / Math.max(span * 0.025, 1)) ** 2;
    let cost = unary[0];
    const back = [];
    for (let i = 1; i < rows; i++) {
      const indices = quadraticMinima(cost, transitionScale), next = Float64Array.from(indices, (k, j) => cost[k] + transitionScale * (j - k) ** 2 + unary[i][j]);
      back.push(indices);
      cost = next;
    }
    let index = 0;
    for (let j = 1; j < columns; j++) if (cost[j] < cost[index]) index = j;
    const path = new Uint8Array(rows);
    path[rows - 1] = index;
    for (let i = rows - 2; i >= 0; i--) path[i] = back[i][path[i + 1]];
    const supported = base.map((_, i) => usable[i] && support[i][path[i]] > 0.18), chosen = base.map((p, i) => supported[i] ? [p[0] + normals[i][0] * offsets[path[i]], p[1] + normals[i][1] * offsets[path[i]]] : p);
    return landmarks.map((p) => {
      const vertices = controls[p.id];
      if (!vertices || p.authored || p.locked || !p.enabled) return p;
      if (covered([p.x * width, p.y * height])) return { ...p, enabled: false, autoDisabled: true, confidence: 0.2, review: "Face boundary is covered. Place this control manually to use it." };
      const parameter = vertices.reduce((sum, v) => sum + lengths[chain.indexOf(v)], 0) / vertices.length / total * (rows - 1), nearest = Math.round(parameter), a = Math.min(rows - 2, Math.floor(parameter)), t = parameter - a;
      if (!supported[nearest]) return { ...p, confidence: Math.min(p.confidence, 0.55), review: "Face boundary has weak image support. Check this control." };
      const point2 = mix(chosen[a], chosen[a + 1], t), x = point2[0] / width, y = point2[1] / height;
      if (x < 0 || y < 0 || x > 1 || y > 1) return p;
      if (upperFaceControls.has(p.id)) {
        const seed2 = mix(base[a], base[a + 1], t), side = p.id === "p18" || p.id === "p28" ? -1 : 1, outward = side * ((point2[0] - seed2[0]) * eye[0] + (point2[1] - seed2[1]) * eye[1]), texel = 1 / Math.hypot(eye[0] * face.width / width, eye[1] * face.height / height);
        if (outward > Math.max(span * 0.012, texel * 0.75)) return { ...p, confidence: Math.min(p.confidence, 0.55), review: "Skin selection extends beyond the face contour. Detector position kept; check this control." };
      }
      return { ...p, x, y, confidence: Math.min(0.9, 0.7 + support[nearest][path[nearest]] * 0.2), review: void 0 };
    });
  }

  // src/engine/fitting.ts
  var FIT_VERSION = 10;
  var CALIBRATION_VERSION = "reference-478-v1";
  var finite = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  var semanticVertices = { p01: 133, p02: 362, p03: 263, p04: 33, p11: 2, p12: 6, p13: 327, p14: 98, p15: 152, p16: 61, p17: 291, p18: 127, p19: 356, p20: 361, p21: 132, p22: 172, p23: 397, p26: 54, p27: 284, p28: 234, p29: 454, p30: 468, p31: 473, p38: 37, p39: 267, p40: 17, p46: 200, p55: 1, p61: 58 };
  var browPairs = { p05: [336, 285], p06: [300, 276], p07: [107, 55], p08: [70, 46], p09: [105, 52], p10: [334, 282] };
  var contourPairs = { p24: [150, 149], p25: [379, 378] };
  var estimateFrames = { p42: [356, 454], p43: [454, 361], p44: [234, 132], p45: [127, 234], p58: [172, 150], p59: [397, 379] };
  var irisGuides = { p32: [473, -Math.SQRT1_2, Math.SQRT1_2], p33: [473, Math.SQRT1_2, Math.SQRT1_2], p34: [468, -Math.SQRT1_2, Math.SQRT1_2], p35: [468, Math.SQRT1_2, Math.SQRT1_2], p36: [468, 0, -1], p37: [473, 0, -1] };
  function semanticPoint(def, current, reference, aspect = 0.8) {
    const index = def.detectorIndex ?? semanticVertices[def.id];
    if (index !== void 0 && finite(current[index])) return [current[index].x, current[index].y];
    const pair = browPairs[def.id] ?? contourPairs[def.id];
    if (pair && pair.every((i) => finite(current[i]))) return [(current[pair[0]].x + current[pair[1]].x) / 2, (current[pair[0]].y + current[pair[1]].y) / 2];
    const frame = estimateFrames[def.id];
    if (frame && frame.every((i) => finite(current[i]) && finite(reference[i]))) {
      const [a, b] = frame.map((i) => reference[i]), [A, B] = frame.map((i) => current[i]), vx = (b.x - a.x) * 0.8, vy = b.y - a.y, dx = (def.reference[0] - a.x) * 0.8, dy = def.reference[1] - a.y, length = vx * vx + vy * vy;
      if (length > 1e-12 && aspect > 0) {
        const t = (dx * vx + dy * vy) / length, u = (vx * dy - vy * dx) / length, x = (B.x - A.x) * aspect, y = B.y - A.y;
        return [A.x + (t * x - u * y) / aspect, A.y + t * y + u * x];
      }
    }
    const iris = irisGuides[def.id];
    if (iris && [iris[0], iris[0] + 1, iris[0] + 2, iris[0] + 3, iris[0] + 4].every((i) => finite(current[i]))) {
      const [i, u, v] = iris, c = current[i], a = current[i + 1], b = current[i + 3], top = current[i + 2], bottom = current[i + 4];
      return [c.x + u * (a.x - b.x) / 2 + v * (bottom.x - top.x) / 2, c.y + u * (a.y - b.y) / 2 + v * (bottom.y - top.y) / 2];
    }
    return transfer(reference, current, def.reference);
  }
  function observe(current, width, height) {
    if (![1, 33, 133, 159, 145, 234, 454, 13, 14, 61, 291, 468, 263].every((i) => finite(current[i])) || width <= 0 || height <= 0) return;
    const px = (i) => [current[i].x * width, current[i].y * height], a = px(33), b = px(263), span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (span < 1e-6) return;
    const ex = [(b[0] - a[0]) / span, (b[1] - a[1]) / span], ey = [-ex[1], ex[0]], dot = (p, axis) => p[0] * axis[0] + p[1] * axis[1], distance = (i, j) => Math.hypot(...px(i).map((v, k) => v - px(j)[k]));
    const l = dot(px(234), ex), r = dot(px(454), ex), nose = dot(px(1), ex), iris = px(468), inner = px(133), upper = px(159), lower = px(145), eyeSpan = Math.max(1e-6, distance(33, 133));
    return { turn: (2 * nose - l - r) / Math.max(1e-6, r - l), mouthOpen: distance(13, 14) / Math.max(1e-6, distance(61, 291)), gaze: [dot([iris[0] - (a[0] + inner[0]) / 2, iris[1] - (a[1] + inner[1]) / 2], ex) / eyeSpan, dot([iris[0] - (upper[0] + lower[0]) / 2, iris[1] - (upper[1] + lower[1]) / 2], ey) / eyeSpan] };
  }
  function headBoundary(mask, center, p) {
    const dx = p[0] - center[0], dy = p[1] - center[1], length = Math.hypot(dx * mask.width, dy * mask.height);
    if (length < 2) return { point: p, reason: "Head boundary is weak" };
    const step = Math.min(0.01, 0.5 / length);
    let seen = false, previous = 0, gaps = 0;
    for (let t = 0.15; t <= 1.75; t += step) {
      const x = center[0] + dx * t, y = center[1] + dy * t;
      if (x <= 0 || y <= 0 || x >= 1 || y >= 1) return { point: p, reason: "Head boundary reaches the crop" };
      if (sampleMask(mask, x, y) > 0.5) {
        seen = true;
        previous = t;
        gaps = 0;
      } else if (seen && (gaps += step * length) >= 1.5) {
        if (previous < 0.3) return { point: p, reason: "Head boundary is weak" };
        const edge = previous + step / 2;
        return { point: [center[0] + dx * edge, center[1] + dy * edge] };
      }
    }
    return { point: p, reason: "Head boundary is not clear" };
  }
  var headIds = ["p50", "p51", "p48", "p47", "p54", "p49", "p53", "p52"];
  var headInnerEdges = { p50: ["p26", "p18"], p51: ["p26", "p41"], p48: ["p26", "p41"], p47: ["p26", "p27"], p54: ["p26", "p27"], p49: ["p41", "p27"], p53: ["p41", "p27"], p52: ["p27", "p19"] };
  function reviewHeadBoundaries(baseline, proposed, width, height) {
    const before = new Map(baseline.map((p) => [p.id, p])), after = new Map(proposed.map((p) => [p.id, p])), heads = new Set(headIds);
    const changed = headIds.some((id) => {
      const a = before.get(id), b = after.get(id);
      return a && b && (a.x !== b.x || a.y !== b.y);
    });
    if (!changed) return { landmarks: proposed, rejected: false };
    const px = (p) => [p.x * width, p.y * height], area = (a, b, c) => {
      const A = px(a), B = px(b), C = px(c);
      return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    };
    const eyeA = before.get("p04"), eyeB = before.get("p03"), span = eyeA && eyeB ? Math.hypot((eyeA.x - eyeB.x) * width, (eyeA.y - eyeB.y) * height) : Math.min(width, height) * 0.25, minArea = Math.max(0.25, span * span * 1e-4), separation = Math.max(1, span * 0.02);
    let rejected = false;
    for (const id of headIds) {
      const a = before.get(id), A = after.get(id);
      if (!a || !A) continue;
      for (const other of proposed) {
        if (other.id === id) continue;
        const b = before.get(other.id);
        if (b && Math.hypot((A.x - other.x) * width, (A.y - other.y) * height) < separation && Math.hypot((a.x - b.x) * width, (a.y - b.y) * height) >= separation) rejected = true;
      }
      const pair = headInnerEdges[id];
      if (pair.every((id2) => before.has(id2) && after.has(id2))) {
        const oldArea = area(a, before.get(pair[0]), before.get(pair[1])), newArea = area(A, after.get(pair[0]), after.get(pair[1]));
        if (Math.abs(oldArea) > minArea && (oldArea * newArea <= 0 || Math.abs(newArea) < Math.abs(oldArea) * 0.05)) rejected = true;
      }
    }
    const edges = (ids) => ids.slice(1).map((id, i) => [ids[i], id]), outer = edges(headIds.filter((id) => before.has(id) && after.has(id))), inner = edges(["p18", "p26", "p41", "p27", "p19"].filter((id) => before.has(id) && after.has(id)));
    const crosses = (map, a, b) => area(map.get(a[0]), map.get(a[1]), map.get(b[0])) * area(map.get(a[0]), map.get(a[1]), map.get(b[1])) < 0 && area(map.get(b[0]), map.get(b[1]), map.get(a[0])) * area(map.get(b[0]), map.get(b[1]), map.get(a[1])) < 0;
    for (let i = 0; i < outer.length; i++) for (const edge of [...outer.slice(i + 2), ...inner]) if (!outer[i].some((id) => edge.includes(id)) && crosses(after, outer[i], edge) && !crosses(before, outer[i], edge)) rejected = true;
    return { landmarks: rejected ? proposed.map((p) => heads.has(p.id) ? before.get(p.id) ?? p : p) : proposed, rejected };
  }
  function fitLandmarks(template, current, reference, width, height, headMask, analysisMasks) {
    headMask ??= headMaskFromAnalysis(analysisMasks);
    const observation = observe(current, width, height), reasons = /* @__PURE__ */ new Set(), unadjusted = /* @__PURE__ */ new Map();
    let landmarks = template.points.map((def) => {
      let xy = semanticPoint(def, current, reference, width / height), confidence = 0.85;
      if (!observation) {
        confidence = 0.3;
        reasons.add("Face frame is incomplete or degenerate");
      }
      const required = def.detectorIndex ?? semanticVertices[def.id], pair = browPairs[def.id] ?? contourPairs[def.id];
      if (required !== void 0 && !finite(current[required]) || pair && !pair.every((i) => finite(current[i]))) {
        confidence = 0.3;
        reasons.add("Incomplete face detection");
      }
      if (!xy.every(Number.isFinite)) {
        xy = [...def.reference];
        confidence = 0.2;
        reasons.add("Incomplete face detection");
      }
      unadjusted.set(def.id, xy);
      if (["hair", "ears", "neck", "clothing"].includes(def.region) || ["p57", "p58", "p59"].includes(def.id)) {
        confidence = 0.4;
        reasons.add("Hair, ears, forehead and neck need review");
      }
      if (/^p(47|48|49|50|51|52|53|54)$/.test(def.id) && headMask && finite(current[1])) {
        const boundary = headBoundary(headMask, [current[1].x, current[1].y], xy);
        xy = boundary.point;
        if (boundary.reason) reasons.add(boundary.reason);
        else confidence = 0.6;
      }
      if (def.id === "p41" && analysisMasks?.face) {
        const opening = reviewFrontOpening(xy, current, width, height, analysisMasks);
        xy = opening.point;
        if (opening.supported) confidence = 0.75;
        else reasons.add("Front hair opening needs review");
      }
      if (def.region === "brows") confidence = 0.65;
      if (observation && Math.abs(observation.turn) > 0.32 && ["outline", "eyes", "brows"].includes(def.region)) {
        confidence = Math.min(confidence, 0.6);
        reasons.add("Turned face: check the far eye and outline");
      }
      if (def.region === "eyes") {
        const i = def.id === "p31" || ["p02", "p03", "p32", "p33", "p37"].includes(def.id) ? 473 : 468, a = current[i + 1], b = current[i + 3], c = current[i + 2], d = current[i + 4];
        if (![a, b, c, d].every(finite) || Math.abs((a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x)) < 1e-10) {
          confidence = 0.3;
          reasons.add("Iris geometry is weak");
        }
        const upper = current[i === 468 ? 159 : 386], lower = current[i === 468 ? 145 : 374];
        if (finite(upper) && finite(lower) && Math.hypot((upper.x - lower.x) * width, (upper.y - lower.y) * height) < Math.max(2, width * 2e-3)) {
          confidence = Math.min(confidence, 0.5);
          reasons.add("Small or closed eye: check eye controls");
        }
      }
      if (def.region === "mouth" && observation && observation.mouthOpen < 0.04) {
        confidence = Math.min(confidence, 0.65);
        reasons.add("Closed mouth: check the lip seam");
      }
      const enabled = xy[0] >= 0 && xy[0] <= 1 && xy[1] >= 0 && xy[1] <= 1;
      if (!enabled) {
        confidence = 0.15;
        reasons.add("Outside-photo controls are disabled in all-source correspondence");
      }
      const reviewed = reviewFaceContour({ id: def.id, x: xy[0], y: xy[1], enabled, locked: false, authored: false, confidence }, current, width, height, analysisMasks);
      if (reviewed.autoDisabled) reasons.add("Covered face-boundary controls are excluded until reviewed");
      return reviewFeatureEvidence(reviewed, def.region, analysisMasks);
    });
    const contourBaseline = landmarks.map((p) => {
      const xy = unadjusted.get(p.id);
      return { ...p, x: xy[0], y: xy[1] };
    }), shaped = reviewContourShape(contourBaseline, landmarks, width, height);
    if (shaped !== landmarks) reasons.add("Ambiguous upper-cheek boundaries keep detector estimates for review");
    landmarks = shaped;
    landmarks = reviewContourShape(contourBaseline, reviewVisibleContour(landmarks, current, width, height, analysisMasks), width, height);
    if (landmarks.some((p) => p.autoDisabled)) reasons.add("Covered face-boundary controls are excluded until reviewed");
    if (headMask) {
      const baseline = landmarks.map((p) => {
        const xy = unadjusted.get(p.id);
        return { ...p, x: xy[0], y: xy[1], enabled: xy[0] >= 0 && xy[0] <= 1 && xy[1] >= 0 && xy[1] <= 1, confidence: headIds.includes(p.id) ? 0.4 : p.confidence };
      }), review = reviewHeadBoundaries(baseline, landmarks, width, height);
      landmarks = review.landmarks;
      if (review.rejected) reasons.add("Head boundary conflicts with face controls; estimated positions kept");
    }
    if (landmarks.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) reasons.add("Outside-photo controls are disabled in all-source correspondence");
    return { landmarks, observation, note: reasons.size ? [...reasons].join(". ") + ". Left and Right mean image side." : void 0 };
  }
  var oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  var jaw = /* @__PURE__ */ new Set(["p15", "p20", "p21", "p22", "p23", "p24", "p25", "p61"]);
  var left = /* @__PURE__ */ new Set(["p30", "p34", "p35", "p36"]);
  var right = /* @__PURE__ */ new Set(["p31", "p32", "p33", "p37"]);
  function point(def, current, reference, template, fallback) {
    if (def.detectorIndex !== void 0 && current[def.detectorIndex]) return [current[def.detectorIndex].x, current[def.detectorIndex].y];
    if (left.has(def.id) || right.has(def.id)) {
      const isLeft = left.has(def.id), i = isLeft ? 468 : 473, center = template.points.find((p) => p.id === (isLeft ? "p30" : "p31"))?.reference ?? [reference[i].x, reference[i].y];
      const a = reference[i + 1], b = reference[i + 3], c = reference[i + 2], d = reference[i + 4], hx = (a.x - b.x) / 2, hy = (a.y - b.y) / 2, vx = (c.x - d.x) / 2, vy = (c.y - d.y) / 2, det = hx * vy - hy * vx;
      if (Math.abs(det) > 1e-10) {
        const dx = def.reference[0] - center[0], dy = def.reference[1] - center[1], u = (dx * vy - dy * vx) / det, v = (dy * hx - dx * hy) / det, A = current[i + 1], B = current[i + 3], C = current[i + 2], D = current[i + 4];
        return [current[i].x + u * (A.x - B.x) / 2 + v * (C.x - D.x) / 2, current[i].y + u * (A.y - B.y) / 2 + v * (C.y - D.y) / 2];
      }
    }
    if (def.id === "p56") {
      const A = template.points.find((p) => p.id === "p20"), B = template.points.find((p) => p.id === "p23");
      if (A && B) {
        const a = point(A, reference, reference, template, fallback), b = point(B, reference, reference, template, fallback), c = [reference[1].x, reference[1].y], p = def.reference, den = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(den) > 1e-10) {
          const u = ((b[0] - p[0]) * (c[1] - p[1]) - (b[1] - p[1]) * (c[0] - p[0])) / den, v = ((c[0] - p[0]) * (a[1] - p[1]) - (c[1] - p[1]) * (a[0] - p[0])) / den, w = 1 - u - v, ww = [u, v, w].map((v2) => Math.max(0.02, v2)), sum = ww.reduce((a2, b2) => a2 + b2, 0), aa = point(A, current, reference, template, fallback), bb = point(B, current, reference, template, fallback), cc = [current[1].x, current[1].y];
          return [(ww[0] * aa[0] + ww[1] * bb[0] + ww[2] * cc[0]) / sum, (ww[0] * aa[1] + ww[1] * bb[1] + ww[2] * cc[1]) / sum];
        }
      }
    }
    if (jaw.has(def.id)) {
      let best = Infinity, result;
      for (let i = 0; i < oval.length; i++) {
        const ai = oval[i], bi = oval[(i + 1) % oval.length], a = reference[ai], b = reference[bi], dx = (b.x - a.x) * 0.8, dy = b.y - a.y, px = (def.reference[0] - a.x) * 0.8, py = def.reference[1] - a.y, t = Math.max(0, Math.min(1, (px * dx + py * dy) / Math.max(1e-12, dx * dx + dy * dy))), dist = (px - t * dx) ** 2 + (py - t * dy) ** 2;
        if (dist < best) {
          best = dist;
          const A = current[ai], B = current[bi];
          result = [A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t];
        }
      }
      if (result) return result;
    }
    return fallback(def.reference, current);
  }
  function transfer(reference, current, p) {
    if (!reference.length || !current.length) return [...p];
    const valid = reference.map((r, i) => finite(r) && finite(current[i]) ? i : -1).filter((i) => i >= 0 && i < 478);
    if (valid.length < 3) return [...p];
    if (valid.length !== Math.min(reference.length, current.length, 478)) return transfer(valid.map((i) => reference[i]), valid.map((i) => current[i]), p);
    const n = Math.min(reference.length, current.length, 478), weights = [];
    let sum = 0, rx = 0, ry = 0, tx = 0, ty = 0;
    for (let i = 0; i < n; i++) {
      const dx = (reference[i].x - p[0]) * 0.8, dy = reference[i].y - p[1], d = dx * dx + dy * dy;
      if (d < 1e-12) return [current[i].x, current[i].y];
      const w = 1 / d;
      weights.push(w);
      sum += w;
      rx += w * reference[i].x * 0.8;
      ry += w * reference[i].y;
      tx += w * current[i].x;
      ty += w * current[i].y;
    }
    rx /= sum;
    ry /= sum;
    tx /= sum;
    ty /= sum;
    let xx = 0, xy = 0, yy = 0, mxx = 0, mxy = 0, myx = 0, myy = 0;
    for (let i = 0; i < n; i++) {
      const x2 = reference[i].x * 0.8 - rx, y2 = reference[i].y - ry, u = current[i].x - tx, v = current[i].y - ty, w = weights[i];
      xx += w * x2 * x2;
      xy += w * x2 * y2;
      yy += w * y2 * y2;
      mxx += w * x2 * u;
      mxy += w * x2 * v;
      myx += w * y2 * u;
      myy += w * y2 * v;
    }
    const det = xx * yy - xy * xy;
    if (Math.abs(det) < 1e-12) return [tx, ty];
    const x = p[0] * 0.8 - rx, y = p[1] - ry, a = (x * yy - y * xy) / det, b = (y * xx - x * xy) / det;
    return [tx + a * mxx + b * myx, ty + a * mxy + b * myy];
  }
  return __toCommonJS(fitting_exports);
})();
