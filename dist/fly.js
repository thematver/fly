import * as THREE from './assets/three.module.js?v=7';

// Low-poly Drosophila with a small rig.
// root  – sits on the desk; feet are planted in root space (y = FOOT_Y).
// body  – leans, rises, pitches and squashes; carries thorax, head, abdomen, wings.
// legs  – six two-bone IK chains solved in root space every frame, so the body
//         can move while the feet stay put. Knees bend outwards and up; the
//         solver also swings a knee around the head if it would enter an eye.
// Local axes: +X forward (head), +Y up, +Z the fly's right side.
export const FOOT_Y = -0.72;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

const LEGS = {
  // hip in body space, lengths (femur, tibia, tarsus), rest tip in root space, knee pole in body space, rest tarsus direction
  fore: { hip: [.34, -.3, .17], len: [.62, .66, .26], tip: [1.02, FOOT_Y, .5], pole: [.15, .32, .94], dir: [.85, -.2, .45] },
  mid: { hip: [.08, -.34, .2], len: [.5, .56, .26], tip: [.1, FOOT_Y, 1.0], pole: [0, .45, .9], dir: [.3, -.2, .93] },
  hind: { hip: [-.16, -.33, .18], len: [.56, .62, .28], tip: [-.8, FOOT_Y, .88], pole: [-.2, .45, .87], dir: [-.62, -.2, .76] },
};

export function createFly() {
  const mats = {
    thorax: new THREE.MeshStandardMaterial({ color: '#5a7d82', roughness: .7, metalness: .05, flatShading: true }),
    head: new THREE.MeshStandardMaterial({ color: '#4d6f73', roughness: .7, flatShading: true }),
    abdomen: new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: .5, metalness: .15, flatShading: true }),
    eye: new THREE.MeshStandardMaterial({ color: '#d8263e', emissive: '#3d0410', roughness: .26, metalness: .1, flatShading: true }),
    bristle: new THREE.MeshBasicMaterial({ color: '#05070c' }),
    leg: new THREE.MeshStandardMaterial({ color: '#7f99a3', roughness: .5, metalness: .2, flatShading: true }),
    foot: new THREE.MeshStandardMaterial({ color: '#141a22', roughness: .5 }),
    haltere: new THREE.MeshBasicMaterial({ color: '#eef6f8' }),
    wing: new THREE.MeshStandardMaterial({
      color: '#aad6e8', emissive: '#15313d', transparent: true, opacity: .5, roughness: .35, metalness: .1,
      side: THREE.DoubleSide, depthWrite: false, map: wingTexture(),
    }),
    edge: new THREE.LineBasicMaterial({ color: '#d5f6ff', transparent: true, opacity: .55 }),
    vein: new THREE.LineBasicMaterial({ color: '#9fe3ec', transparent: true, opacity: .75 }),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const orb = (r, pos, scale, mat, detail, parent) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat);
    m.position.copy(pos); m.scale.set(...scale); parent.add(m); return m;
  };
  const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
  const rod = (a, b, r, mat, parent) => {
    const m = new THREE.Mesh(rodGeo, mat);
    m.userData.r = r; poseRod(m, a, b); parent.add(m); return m;
  };

  // Thorax and scutellum.
  orb(.5, V(0, 0, 0), [1.12, .95, .92], mats.thorax, 1, body);
  orb(.2, V(-.42, .26, 0), [1.2, .55, 1.1], mats.thorax, 1, body);

  // Abdomen: its own pivot so it can lag behind the body (follow-through).
  const abdomen = new THREE.Group();
  abdomen.position.set(-.34, -.06, 0); abdomen.rotation.z = .14; body.add(abdomen);
  const belly = new THREE.Mesh(abdomenGeometry(), mats.abdomen);
  abdomen.add(belly);

  // Head with two bulging compound eyes and twitchy antennae.
  const head = new THREE.Group();
  head.position.set(.6, .14, 0); body.add(head);
  orb(.3, V(.02, 0, 0), [.8, .95, 1], mats.head, 1, head);
  const antennae = [];
  for (const side of [-1, 1]) {
    orb(.26, V(.12, .05, side * .2), [.8, 1.08, .72], mats.eye, 2, head);
    const ant = new THREE.Group();
    ant.position.set(.3, .12, side * .06); head.add(ant);
    rod(V(), V(.1, .18, side * .04), .018, mats.leg, ant);
    rod(V(.1, .18, side * .04), V(.06, .4, side * .1), .006, mats.bristle, ant);
    antennae.push(ant);
  }
  // Proboscis on its own pivot so it can extend (the "tasting" reflex).
  const proboscis = new THREE.Group();
  proboscis.position.set(.2, -.2, 0); proboscis.rotation.z = .62; head.add(proboscis);
  rod(V(), V(0, -.17, 0), .03, mats.leg, proboscis);
  orb(.045, V(0, -.19, 0), [1.3, .7, 1.1], mats.leg, 0, proboscis);

  // Macrochaetae on the thorax, halteres behind the wing roots.
  const halteres = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = .32 - i * .14, z = side * (.12 + (i % 2) * .1);
      const r0 = V(x, .44 - Math.abs(x) * .18, z);
      rod(r0, V(x - .26, r0.y + .2, z * 1.25), .01, mats.bristle, body);
    }
    rod(V(-.44, .34, side * .08), V(-.8, .5, side * .12), .009, mats.bristle, body);
    const hal = new THREE.Group();
    hal.position.set(-.28, .12, side * .38); body.add(hal);
    rod(V(), V(-.14, -.02, side * .12), .012, mats.haltere, hal);
    orb(.05, V(-.16, -.02, side * .14), [1, 1, 1], mats.haltere, 1, hal);
    halteres.push({ pivot: hal, side });
  }

  // Wings folded back over the abdomen in a shallow V.
  const wings = [];
  const wingGeo = wingGeometry(), veins = veinGeometry(), outline = outlineGeometry();
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(-.1, .5, side * .18);
    body.add(pivot);
    const wing = new THREE.Group();
    wing.rotation.y = Math.PI + side * .3;
    wing.rotation.x = side > 0 ? -.3 : .08; // roof-like; the far wing flatter so it never goes edge-on
    wing.rotation.z = -.035;
    pivot.add(wing);
    for (const [geo, mat, Kind] of [[wingGeo, mats.wing, THREE.Mesh], [veins, mats.vein, THREE.LineSegments], [outline, mats.edge, THREE.LineLoop]]) {
      const o = new Kind(geo, mat);
      o.scale.z = side; o.renderOrder = 2;
      wing.add(o);
    }
    wings.push({ pivot, side });
  }

  // Legs: meshes live in root space and are posed by the solver.
  const legs = {};
  for (const [kind, cfg] of Object.entries(LEGS)) {
    for (const side of [-1, 1]) {
      const f = a => V(a[0], a[1], a[2] * side);
      const thick = kind === 'fore' ? 1.25 : 1;
      const leg = {
        kind, side, len: [...cfg.len], hip: f(cfg.hip), pole: f(cfg.pole).normalize(), poleBase: f(cfg.pole).normalize(),
        restTip: f(cfg.tip), restDir: f(cfg.dir).normalize(),
        femur: rod(V(), UP, .032 * thick, mats.leg, root),
        tibia: rod(V(), UP, .025 * thick, mats.leg, root),
        tarsus: rod(V(), UP, .017 * thick, mats.foot, root),
        knee: orb(.034 * thick, V(), [1, 1, 1], mats.leg, 0, root),
        tip: V(), dir: V(), reached: V(),
      };
      leg.tip.copy(leg.restTip); leg.dir.copy(leg.restDir);
      legs[(side > 0 ? 'R' : 'L') + kind] = leg;
    }
  }

  const hipW = V(), poleW = V(), ankle = V(), knee = V(), d = V(), bend = V(), end = V(), mid = V(), away = V(), tmpA = V();
  const kneeAt = (out, a, h) => out.copy(hipW).addScaledVector(d, a).addScaledVector(bend, h);
  // How deep a point sits inside the avoid spheres (0 = clear); fills `away` with the push direction.
  function intrusion(p, avoid, worst = 0) {
    for (const s of avoid) {
      tmpA.subVectors(p, s.c);
      const dd = tmpA.length(), pen = s.r - dd;
      if (pen > worst) { worst = pen; away.copy(tmpA).multiplyScalar(1 / (dd || 1e-4)); }
    }
    return worst;
  }
  // Solve every leg towards leg.tip / leg.dir (both in root space).
  // avoid: optional [{c: Vector3 (root space), r}] – knees and shins swing around these (the eyes).
  function solveLegs(avoid) {
    body.updateMatrix();
    for (const leg of Object.values(legs)) {
      const [L1, L2, L3] = leg.len;
      hipW.copy(leg.hip).applyMatrix4(body.matrix);
      poleW.copy(leg.pole).applyQuaternion(body.quaternion);
      ankle.copy(leg.tip).addScaledVector(leg.dir, -L3);
      d.subVectors(ankle, hipW);
      let len = d.length();
      const max = (L1 + L2) * .999;
      if (len > max) { d.multiplyScalar(max / len); len = max; ankle.copy(hipW).add(d); }
      len = Math.max(len, Math.abs(L1 - L2) + .02);
      const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      d.normalize();
      bend.copy(poleW).addScaledVector(d, -poleW.dot(d)).normalize();
      kneeAt(knee, a, h);
      if (avoid && leg.kind === 'fore') {
        // Rotate the knee around the hip-ankle axis until the knee and both
        // segment midpoints are outside the eyes (small steps, keeps continuity).
        for (let i = 0; i < 8; i++) {
          let pen = intrusion(knee, avoid);
          mid.addVectors(hipW, knee).multiplyScalar(.5); pen = intrusion(mid, avoid, pen);
          mid.addVectors(knee, ankle).multiplyScalar(.5); pen = intrusion(mid, avoid, pen);
          if (pen <= 0) break;
          away.addScaledVector(d, -away.dot(d));
          bend.addScaledVector(away.normalize(), .45).addScaledVector(d, -bend.dot(d)).normalize();
          kneeAt(knee, a, h);
        }
      }
      end.copy(ankle).addScaledVector(leg.dir, L3);
      poseRod(leg.femur, hipW, knee);
      poseRod(leg.tibia, knee, ankle);
      poseRod(leg.tarsus, ankle, end);
      leg.knee.position.copy(knee);
      leg.kneeAt = leg.kneeAt || V(); leg.kneeAt.copy(knee);
      leg.ankleAt = leg.ankleAt || V(); leg.ankleAt.copy(ankle);
      leg.hipAt = leg.hipAt || V(); leg.hipAt.copy(hipW);
      leg.reached.copy(end); // where the tip really is after clamping
    }
  }

  return { group: root, body, head, abdomen, belly, antennae, wings, halteres, proboscis, legs, solveLegs, mats };
}

export function poseRod(mesh, a, b) {
  const delta = V().subVectors(b, a);
  const len = delta.length() || 1e-4;
  const r = mesh.userData.r || .02;
  mesh.position.copy(a).addScaledVector(delta, .5);
  mesh.scale.set(r, len, r);
  mesh.quaternion.setFromUnitVectors(UP, delta.multiplyScalar(1 / len));
}

// Wing outline in its own plane: x runs from the root (0) to the tip (2.05),
// y is the chord. The leading edge is straighter, the trailing edge fuller.
const WING = [[0, 0], [0, .03], [.25, .1], [.7, .2], [1.2, .27], [1.62, .29], [1.9, .22], [2.05, .08],
  [2.04, -.1], [1.9, -.25], [1.6, -.35], [1.15, -.36], [.7, -.28], [.35, -.16], [.08, -.05]];

function outlineGeometry() {
  return new THREE.BufferGeometry().setFromPoints(WING.map(([x, y]) => V(x, .006, -y)));
}

function wingGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (const [x, y] of WING.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // lie flat: shape y becomes -z
  return geo;
}

function veinGeometry() {
  const lines = [
    [[0, .02], [.7, .19], [1.25, .27], [1.7, .27], [1.98, .16]],
    [[.05, 0], [.8, .1], [1.5, .15], [2.0, .06]],
    [[.05, -.01], [.9, -.03], [1.6, -.04], [2.04, -.06]],
    [[.05, -.03], [.8, -.14], [1.4, -.22], [1.88, -.25]],
    [[.06, -.04], [.6, -.2], [1.1, -.31], [1.45, -.35]],
    [[.9, -.03], [.92, -.15]], [[1.28, -.21], [1.3, -.31]],
  ];
  const pts = [];
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      pts.push(V(line[i][0], .004, -line[i][1]), V(line[i + 1][0], .004, -line[i + 1][1]));
    }
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function wingTexture() {
  // Microtrichia: a fine dot grid that survives the pixel post-process as shimmer.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#9bb9c4';
  for (let y = 0; y < 64; y += 4) for (let x = (y / 4) % 2 * 2; x < 64; x += 4) g.fillRect(x, y, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
  t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function abdomenGeometry() {
  // Tapered, slightly drooping abdomen turned so it trails behind the thorax (-X).
  const profile = [[0, 0], [.2, .03], [.3, .12], [.36, .3], [.37, .5], [.33, .7], [.24, .88], [.12, .98], [0, 1.02]];
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * 1.2, y * 1.12)), 9);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 1; c.height = 8;
  const g = c.getContext('2d');
  ['#1a1624', '#1a1624', '#3d3350', '#1a1624', '#3d3350', '#1a1624', '#3d3350', '#221d2e'].forEach((col, i) => {
    g.fillStyle = col; g.fillRect(0, i, 1, 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
