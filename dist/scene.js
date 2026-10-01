import * as THREE from './assets/three.module.js?v=8';
import { createFly, FOOT_Y } from './fly.js?v=8';
import { THOUGHTS } from './thoughts.js?v=8';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const smooth = t => t * t * (3 - 2 * t);
const DESK_Y = 1.065;
const FLY_SCALE = 1.3;

// Monitor and the presave page drawn on it. The button rect is in canvas pixels.
const MON = { x: 1.55, y: 2.62, z: -.83, w: 2.5, h: 1.72 };
const SCREEN_Z = -.714;
// Layout of a BandLink presave page (desktop half-block: services left, release right).
const PAGE = { w: 384, h: 264, button: [124, 216, 52, 18], cover: [214, 28, 132, 132] };
const SERVICES = [
  ['Spotify', '#1ed760', 'S', '#0b3d1f'], ['Apple Music', '#fa2d48', '♪', '#fff'], ['VK Музыка', '#0077ff', 'VK', '#fff'],
  ['КИОН Музыка', '#e30611', 'K', '#fff'], ['Яндекс Музыка', '#ffcc00', 'Я', '#1a1a1a'],
];

export async function init(world, S) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'default' });
  renderer.setPixelRatio(1);
  world.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType,
  });
  const post = createPost(target);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#100c26');
  scene.fog = new THREE.FogExp2('#1a1438', .028);
  const camera = new THREE.PerspectiveCamera(38, 1, .05, 120);

  const room = buildRoom(scene);
  const screen = buildScreen(scene, S);
  const rain = buildRain(scene);
  const city = buildCity(scene);

  // The fly stands on the desk, facing the monitor.
  const fly = createFly();
  const F = fly.group;
  F.scale.setScalar(FLY_SCALE);
  F.position.set(-.98, DESK_Y - FOOT_Y * FLY_SCALE, .24);
  F.rotation.y = .36;
  scene.add(F);
  F.updateMatrixWorld(true);
  const buttonWorld = screen.buttonWorld;

  // Freeze matrices of everything static; only the fly and a few lights move.
  scene.traverse(o => { if (!o.userData.live && !isInside(o, F)) { o.updateMatrix(); o.matrixAutoUpdate = false; } });

  const mind = new Mind(S);
  const cam = createCameraRig(camera, F, screen, S);
  const anim = createFlyAnimator(fly, screen, S);

  // Pointer: drag orbits the camera, a tap starts the sound or dives into the head.
  const ray = new THREE.Raycaster();
  const headMeshes = [];
  fly.head.traverse(o => { if (o.isMesh) headMeshes.push(o); });
  let drag = null;
  world.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    S.dragged = false;
    world.setPointerCapture?.(e.pointerId);
  });
  world.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 6) S.dragged = true;
    cam.nudge(dx, dy);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = () => { drag = null; };
  world.addEventListener('pointerup', endDrag);
  world.addEventListener('pointercancel', endDrag);
  world.addEventListener('click', e => {
    if (S.dragged) return;
    const r = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / world.clientWidth) * 2 - 1, -((e.clientY - r.top) / world.clientHeight) * 2 + 1);
    let head = false;
    if (!S.peek && cam.mode === 'room') {
      ray.setFromCamera(p, camera);
      // A generous hit area: the head plus a little margin around it.
      head = ray.intersectObjects(headMeshes, false).length > 0 || nearHead(ray, fly.head);
    }
    S.onTap?.({ head });
  });

  // Sizing: whole device pixels per render cell, so the pixel grid never beats.
  let width = 0, height = 0, cell = 3, frameGap = 0;
  function resize() {
    width = world.clientWidth; height = world.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    S.mobile = width < 801;
    const lines = S.poster ? 315 : S.mobile ? 540 : 380;
    cell = Math.max(2, Math.round(height * dpr / lines));
    const rw = Math.ceil(width * dpr / cell), rh = Math.ceil(height * dpr / cell);
    renderer.setSize(rw, rh, false);
    target.setSize(rw, rh);
    canvas.style.width = (rw * cell / dpr) + 'px';
    canvas.style.height = (rh * cell / dpr) + 'px';
    document.documentElement.style.setProperty('--cell', (cell / dpr) + 'px');
    post.uniforms.res.value.set(rw, rh);
    frameGap = S.mobile ? 1000 / 30 - 2 : 1000 / 60 - 2;
    cam.resize(width, height);
    mind.resize(width / height);
  }
  new ResizeObserver(resize).observe(world);
  S.onLayout = () => cam.resize(width, height);
  resize();

  // Peek: dive into the head and back.
  S.setPeek = on => cam.dive(on, mind);

  let last = performance.now(), lastDraw = 0, worldT = 0, failed = false;
  post.uniforms.mono.value = S.dead ? 1 : 0; // dead: a black-and-white picture
  function frame(now) {
    if (failed) return;
    requestAnimationFrame(frame);
    if (document.hidden || !width) { last = now; return; }
    if (now - lastDraw < frameGap) return;
    lastDraw = now;
    const dt = Math.min((now - last) / 1000, .1);
    last = now;
    try {
      worldT += dt;
      anim.update(dt, worldT);
      screen.update(dt, anim.touch, anim.near);
      rain.material.uniforms.time.value = S.reduced ? worldT * .3 : worldT;
      city.update(dt, S);
      room.update(worldT, screen.glow, S);
      cam.update(dt, worldT, anim);
      post.uniforms.time.value = worldT;
      post.uniforms.exposure.value = 1.3 + anim.tail * .55;
      if ((S.state === 'lost' || (S.dead && !S.reduced)) && !S.poster && Math.random() < dt * .35) S.glitch(.3);
      post.uniforms.glitch.value = Math.max(0, post.uniforms.glitch.value - dt * 1.6);
      post.uniforms.fade.value = cam.fade;
      post.uniforms.inside.value = cam.inside;
      // The black-and-white filter clicks on as the fly hits the desk; the colour comes back as it gets up.
      const monoTo = S.dead && anim.die > .6 ? 1 : 0;
      if (monoTo && post.uniforms.mono.value < .5 && !S.reduced) S.glitch(.8);
      post.uniforms.mono.value += (monoTo - post.uniforms.mono.value) * (1 - Math.exp(-dt * (monoTo ? 16 : 2.5)));

      renderer.setRenderTarget(target);
      if (cam.showMind) { mind.update(dt, worldT); renderer.render(mind.scene, mind.camera); }
      else renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(post.scene, post.camera);
      if (!world.classList.contains('ready')) world.classList.add('ready');
    } catch (err) {
      failed = true;
      console.error(err);
      world.classList.add('fallback');
    }
  }
  requestAnimationFrame(frame);

  S.glitch = (v = 1) => { post.uniforms.glitch.value = Math.max(post.uniforms.glitch.value, v); };
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); world.classList.add('ctx-lost'); });
  canvas.addEventListener('webglcontextrestored', () => { world.classList.remove('ctx-lost'); screen.dirty = true; });

  // Hand the snapshot helper to the page (used to render the share image).
  S.snapshot = () => {
    renderer.setRenderTarget(target);
    if (cam.showMind) renderer.render(mind.scene, mind.camera); else renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post.scene, post.camera);
    return canvas;
  };
}

function isInside(o, group) { for (let p = o; p; p = p.parent) if (p === group) return true; return false; }

function nearHead(ray, head) {
  const c = head.getWorldPosition(V());
  return ray.ray.distanceSqToPoint(c) < .45 * .45;
}

/* ---------------------------------------------------------------- post */

// Light cues on the music clock, shared by the room, the screen, the rain, the city,
// the camera and this pass. updateCues() runs once per frame from city.update (the first
// scene update after the fly); everything else only reads FX. No allocations per frame.
//   kick   decaying pulse on each beat, gated by the low band (the build drops the kick)
//   build  bar 7, the held breath before the last hit
//   flash  lightning on the last hit (cut - 0.18 s), two strikes
//   hush   the dry cut: 1 from S.cut until the replay ends
//   tail   the reverb swell, 0 -> 1 from S.cut to S.dur
//   lost   the frozen "signal lost" screen
//   speed  time scale for the world outside (rain): slow motion in the reverb tail
const FX = { kick: 0, gate: 0, build: 0, flash: 0, bolt: 0, hush: 0, tail: 0, lost: 0, speed: 1, time: 0 };
const BEAT_S = 60 / 125;
function updateCues(S, dt) {
  const st = S.state, t = S.t || 0, e = S.env || {}, cut = S.cut || 14.1, dur = S.dur || 16.3, hit = cut - .18;
  const playing = st === 'playing', calm = S.reduced ? .35 : 1, k = x => 1 - Math.exp(-dt * x);
  const g = clamp(((e.low || 0) - .3) / .22, 0, 1);
  FX.gate += (g - FX.gate) * (g > FX.gate ? k(40) : k(5));
  FX.kick = playing && t >= BEAT_S && t < cut + .05 ? Math.exp(-((t / BEAT_S) % 1) * 6) * FX.gate * calm : 0;
  const b = playing && t < cut ? smooth(clamp((t - 12) / (hit - 12), 0, 1)) : 0;
  FX.build += (b - FX.build) * k(b > FX.build ? 30 : 4);
  const d = t - hit, strike = !playing || d < 0 ? 0 : Math.exp(-d * 16) + (d > .12 ? .55 * Math.exp(-(d - .12) * 13) : 0);
  FX.flash = strike * (S.reduced ? .2 : 1);
  FX.bolt = S.reduced || !playing ? 0 : (d >= 0 && d < .07) || (d > .12 && d < .17) ? 1 : 0;
  FX.hush = playing && t >= cut ? 1 : 0;
  FX.tail = playing && t >= cut ? clamp((t - cut) / Math.max(.1, dur - cut), 0, 1) : 0;
  FX.lost += ((st === 'lost' ? 1 : 0) - FX.lost) * k(3);
  const sp = FX.hush ? .12 : 1 + .45 * FX.build;
  FX.speed += (sp - FX.speed) * k(FX.hush ? 9 : 3);
  FX.time += dt * FX.speed * (S.reduced ? .3 : 1);
}

function createPost(target) {
  const uniforms = {
    map: { value: target.texture }, res: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 }, glitch: { value: 0 }, fade: { value: 1 }, inside: { value: 0 }, mono: { value: 0 },
    levels: { value: 12 }, exposure: { value: 1.3 },
    tint: { value: new THREE.Vector3(1, 1, 1) }, lift: { value: new THREE.Vector3() }, vig: { value: .22 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec2 res; uniform float time, glitch, fade, inside, levels, exposure, vig, mono;
      uniform vec3 tint, lift;
      varying vec2 vUv;
      float b2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
      float b4(vec2 a){return b2(.5*a)*.25+b2(a);}
      float hash(float n){return fract(sin(n)*43758.5453);}
      vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
      void main(){
        vec2 uv=vUv;
        if(glitch>0.){
          float band=floor(uv.y*res.y/4.);
          float r=hash(band*1.7+floor(time*24.));
          uv.x+=(r>.8?(r-.9)*.35:0.)*glitch;
        }
        vec3 c=texture2D(map,uv).rgb;
        if(glitch>0.) c.r=mix(c.r,texture2D(map,uv+vec2(.012*glitch,0.)).r,.8);
        c=aces(c*exposure);
        c=pow(c,vec3(1./2.2));
        c=c*tint+lift;
        vec2 q=vUv*2.-1.;
        c*=1.-vig*dot(q,q);
        if(inside>0.){
          vec2 h=gl_FragCoord.xy/vec2(5.,4.4);
          h.x+=mod(floor(h.y),2.)*.5;
          vec2 f=fract(h)-.5;
          c*=1.-inside*.22*smoothstep(.2,.52,length(f*vec2(1.,1.15)));
          q.x*=res.x/res.y;
          float rr=length(q)/min(1.,res.x/res.y);
          c*=mix(1.,smoothstep(1.45,1.18,rr),inside);
        }
        if(mono>0.){float y=dot(c,vec3(.299,.587,.114));c=mix(c,vec3(clamp((y-.5)*1.12+.5,0.,1.)),mono);}
        c=floor(c*levels+b4(gl_FragCoord.xy))/levels;
        gl_FragColor=vec4(c*fade,1.);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  // Grade from the cues, right before the pass draws: the reverb tail sinks the room into
  // violet and closes the vignette, lightning lifts the blacks a little (never a white frame),
  // "signal lost" stays slightly dimmer than idle. Inside the head the grade is neutral.
  quad.onBeforeRender = () => {
    const room = 1 - uniforms.inside.value, tl = FX.tail, h = FX.hush * room, l = FX.lost * room, f = FX.flash * room;
    uniforms.tint.value.set(1 - .06 * h - .05 * l, 1 - .16 * h - .1 * tl * room - .06 * l, 1 + .05 * h - .02 * l);
    uniforms.lift.value.set(.018 * f + .012 * h, .016 * f, .045 * f + .03 * h);
    uniforms.vig.value = .22 + (.16 * h + .1 * tl * room + .08 * l);
  };
  scene.add(quad);
  return { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), uniforms };
}

/* ---------------------------------------------------------------- room */

function buildRoom(scene) {
  const hemi = new THREE.HemisphereLight('#b6c8ff', '#1a0b32', 1.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#a8c8ff', 2.4);
  key.position.set(-3, 8, 6); scene.add(key);
  const pink = new THREE.PointLight('#ff3d8b', 30, 12, 2);
  pink.position.set(-3.3, 3, -1.1); pink.userData.live = true; scene.add(pink);
  const teal = new THREE.PointLight('#30ffdb', 16, 14, 2);
  teal.position.set(3.4, 3, 1.9); teal.userData.live = true; scene.add(teal);
  const violet = new THREE.PointLight('#7461ff', 26, 15, 2);
  violet.position.set(1, 5, -4); scene.add(violet);
  const screenLight = new THREE.PointLight('#8fb2ff', 7, 5, 2);
  screenLight.position.set(1.1, 2.5, -.15); screenLight.userData.live = true; scene.add(screenLight);
  // Rim light from the rainy window behind the fly: separates the silhouette from the city.
  const rim = new THREE.PointLight('#8feeff', 10, 4.6, 2);
  rim.position.set(-1.7, 2.95, -1.35); rim.userData.live = true; scene.add(rim);

  const mats = {
    desk: new THREE.MeshStandardMaterial({ color: '#2a2d52', roughness: .75 }),
    edge: new THREE.MeshBasicMaterial({ color: '#52e6dc' }),
    pink: new THREE.MeshBasicMaterial({ color: '#ff4f9a' }),
    black: new THREE.MeshStandardMaterial({ color: '#0b0c1a', roughness: .42, metalness: .4 }),
    shell: new THREE.MeshStandardMaterial({ color: '#1b1d38', roughness: .6 }),
    floor: new THREE.MeshStandardMaterial({ color: '#0d0b1e', roughness: .9 }),
  };
  const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); scene.add(m); return m; };

  // Desk with neon edges and legs.
  box(7.8, .23, 4.1, 0, .95, .2, mats.desk);
  box(7.8, .026, .03, 0, 1.078, 2.26, mats.edge);
  box(.025, .026, 4.1, -3.88, 1.078, .2, mats.edge);
  for (const x of [-3.45, 3.45]) { box(.18, 1.15, .18, x, .3, 1.7, mats.black); box(.18, 1.15, .18, x, .3, -1.35, mats.black); }
  box(.03, 1.15, .03, -3.36, .3, 1.8, mats.pink);
  box(60, .1, 60, 0, -.33, 0, mats.floor);

  // Floor grid as one draw call.
  const grid = [];
  for (let i = -12; i <= 12; i++) grid.push(i * 2, -.27, -22, i * 2, -.27, 10, -24, -.27, i * 2, 24, -.27, i * 2);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: '#1e1a40' })));

  // Monitor body and stand.
  box(MON.w + .15, MON.h + .24, .21, MON.x, MON.y, MON.z, mats.black);
  box(MON.w + .29, MON.h + .37, .2, MON.x, MON.y, MON.z - .13, mats.shell);
  box(.15, .66, .15, MON.x, 1.48, MON.z - .06, mats.black);
  box(1.15, .06, .64, MON.x, 1.12, MON.z + .03, mats.black);
  box(MON.w + .1, .025, .028, MON.x, MON.y - MON.h / 2 - .13, MON.z + .12, mats.edge);
  // Dashed LED strip on the desk in front of the monitor.
  const dash = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(-.4, DESK_Y + .02, -.36), V(3.3, DESK_Y + .02, -.36)]),
    new THREE.LineDashedMaterial({ color: '#52e6dc', dashSize: .06, gapSize: .06 }));
  dash.computeLineDistances(); scene.add(dash);

  // Keyboard: one instanced mesh for all keys.
  box(1.93, .1, .72, 1.75, 1.13, .38, mats.black);
  const keyMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.11, .026, .115), new THREE.MeshStandardMaterial({ roughness: .6 }), 52);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let k = 0;
  for (let row = 0; row < 4; row++) for (let c = 0; c < 13; c++) {
    keyMesh.setMatrixAt(k, m4.makeTranslation(.89 + c * .14, 1.2, .13 + row * .15));
    keyMesh.setColorAt(k++, col.set(row === 0 && c % 4 === 0 ? '#46a59f' : '#3a4262'));
  }
  scene.add(keyMesh);
  box(.68, .025, .11, 1.75, 1.205, .73, mats.shell);

  // Mouse, pad, mug, speakers, subwoofer, lamp.
  box(.75, .018, .82, 3.1, 1.077, .75, new THREE.MeshStandardMaterial({ color: '#16284a' }));
  const mouse = new THREE.Mesh(new THREE.IcosahedronGeometry(.18, 1), mats.black);
  mouse.position.set(3.1, 1.16, .78); mouse.scale.set(1, .48, 1.45); scene.add(mouse);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(.17, .15, .3, 12), new THREE.MeshStandardMaterial({ color: '#7a4a7a' }));
  mug.position.set(3.2, 1.22, -.25); scene.add(mug);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(.145, 16), mats.black);
  coffee.rotation.x = -Math.PI / 2; coffee.position.set(3.2, 1.375, -.25); scene.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.105, .032, 5, 12), mug.material);
  handle.position.set(3.39, 1.23, -.25); scene.add(handle);
  for (const x of [-.25, 2.85]) {
    box(.43, .77, .42, x, 1.45, -1.05, mats.black);
    for (const y of [1.31, 1.63]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.115, .012, 6, 18), mats.edge); ring.position.set(x, y, -.83); scene.add(ring); }
  }
  box(.68, 1.4, 1.1, 3.33, .19, 1.07, mats.black);
  for (const y of [-.13, .42]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.21, .016, 5, 24), mats.edge); ring.position.set(3.33, y, 1.63); scene.add(ring); }
  box(.06, 2.8, .06, -3.55, 2.1, -1.5, mats.pink);

  // Lights follow the cues (see FX in "post"): the kick pumps the monitor and the neon,
  // lightning on the last hit, the dry cut drops the room into the reverb, where only the
  // monitor and the rim keep glowing. The pink tube flickers now and then, like a cheap
  // neon tube; on "signal lost" more often.
  const PINK = mats.pink.color.clone(), EDGE = mats.edge.color.clone();
  const flick = (t, rate) => { const n = Math.floor(t * 14); return Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1 > rate ? .18 : 1; };
  return {
    update(t, glow, S) {
      const e = S.env || {}, on = S.state === 'playing', hush = FX.hush, lost = FX.lost, flash = FX.flash;
      const neon = S.reduced ? 1 - .5 * hush : on
        ? (hush ? .3 + .25 * flick(t * 1.7, .6) : .8 + .45 * FX.kick + .2 * FX.build)
        : flick(t, S.state === 'lost' || S.dead ? .95 : .985) * (1 - .15 * lost);
      mats.pink.color.copy(PINK).multiplyScalar(neon);
      mats.edge.color.copy(EDGE).multiplyScalar(.85 + .35 * FX.kick + .6 * flash - .35 * hush);
      screenLight.intensity = 5 + glow * 5 + (on ? FX.kick * 5 + FX.tail * 8 : Math.sin(t * 7) * .3);
      pink.intensity = (30 + (on ? (e.mid || 0) * 10 + FX.kick * 8 : 0)) * (1 - .6 * hush) * (.55 + .45 * neon);
      teal.intensity = (16 + (on ? (e.high || 0) * 10 : 0)) * (1 - .6 * hush) * (1 - .2 * lost);
      hemi.intensity = 1.9 * (1 - .4 * hush - .12 * lost) + 1.2 * flash;
      key.intensity = 2.4 * (1 - .55 * hush - .15 * lost) + 2.2 * flash;
      rim.intensity = 10 + (on ? (e.high || 0) * 6 + FX.kick * 4 : 0) + 8 * hush + 26 * flash;
    },
  };
}

/* ---------------------------------------------------------------- screen */

function buildScreen(scene, S) {
  const c = document.createElement('canvas');
  c.width = PAGE.w; c.height = PAGE.h;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  mat.color.setScalar(1.05);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(MON.w, MON.h), mat);
  plane.position.set(MON.x, MON.y, SCREEN_Z);
  scene.add(plane);

  // Cover, a pre-scaled copy and a blurred backdrop (tiny copy scaled up = blur in every browser).
  const cover = new Image();
  const coverSmall = document.createElement('canvas'), backdrop = document.createElement('canvas');
  coverSmall.width = PAGE.cover[2]; coverSmall.height = PAGE.cover[3];
  backdrop.width = backdrop.height = 10;
  let coverReady = false;
  cover.onload = () => {
    const cg = coverSmall.getContext('2d');
    cg.imageSmoothingQuality = 'high';
    cg.drawImage(cover, 0, 0, coverSmall.width, coverSmall.height);
    backdrop.getContext('2d').drawImage(cover, 0, 0, 10, 10);
    coverReady = true; api.dirty = true;
  };
  cover.src = new URL('./assets/cover.jpeg', import.meta.url).href;
  let fontReady = false;
  Promise.all(['400 10px Onest', '600 10px Onest', '700 17px Onest'].map(f => document.fonts?.load(f, 'пресейв'))).then(() => { fontReady = true; api.dirty = true; }).catch(() => {});

  const [bx, by, bw, bh] = PAGE.button;
  const toWorld = (x, y) => V(MON.x - MON.w / 2 + x / PAGE.w * MON.w, MON.y + MON.h / 2 - y / PAGE.h * MON.h, SCREEN_Z);
  const buttonWorld = toWorld(bx + bw / 2, by + bh / 2);
  const coverWorld = toWorld(PAGE.cover[0] + PAGE.cover[2] / 2, PAGE.cover[1] + PAGE.cover[3] / 2);

  const font = (w, size) => `${w} ${size}px Onest, "Helvetica Neue", Arial, sans-serif`;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  // The countdown on the page ticks every second, like the real BandLink page.
  const RELEASE_MS = Date.parse('2026-10-02T00:00:00+03:00'), p2 = n => (n < 10 ? '0' : '') + n;
  const clock = () => {
    const s = Math.max(0, Math.floor((RELEASE_MS - S.now()) / 1000)), d = Math.floor(s / 86400);
    return (d ? d + ' д ' : '') + p2(Math.floor(s / 3600) % 24) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60);
  };
  let lastKey = -1, lastSec = -1, acc = 0;
  function paint(touch, near) {
    const live = S.live;
    // Blurred cover backdrop under a light veil, like BandLink's light theme.
    if (coverReady) { g.imageSmoothingEnabled = true; g.drawImage(backdrop, -20, -20, PAGE.w + 40, PAGE.h + 40); }
    else { g.fillStyle = '#6b6f7a'; g.fillRect(0, 0, PAGE.w, PAGE.h); }
    g.fillStyle = 'rgba(245,246,250,.32)'; g.fillRect(0, 0, PAGE.w, PAGE.h);
    // Browser chrome.
    g.fillStyle = '#e9ebef'; g.fillRect(0, 0, PAGE.w, 16);
    [['#ff5f57', 8], ['#febc2e', 15], ['#28c840', 22]].forEach(([col, x]) => { g.fillStyle = col; g.beginPath(); g.arc(x, 8, 2.5, 0, 7); g.fill(); });
    g.fillStyle = '#ffffff'; rr(120, 3, 144, 11, 5); g.fill();
    g.fillStyle = '#3c3c43'; g.font = font(400, 8); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('band.link/startend', 192, 11.5);
    g.textAlign = 'left';

    // Services card.
    g.fillStyle = 'rgba(255,255,255,.96)'; rr(16, 26, 168, 220, 10); g.fill();
    g.fillStyle = '#8a8f98'; g.font = font(400, 9);
    g.fillText(live ? 'Уже вышел' : 'Выйдет через', 28, 44);
    g.fillStyle = '#111317'; g.font = font(700, 13);
    g.fillText(live ? 'Слушайте' : clock(), 28, 61);
    SERVICES.forEach(([name, col, mark, markCol], i) => {
      const y0 = 74 + i * 34;
      g.fillStyle = '#eef0f3'; g.fillRect(24, y0 - 3, 152, 1);
      g.fillStyle = col; g.beginPath(); g.arc(36, y0 + 15, 8, 0, 7); g.fill();
      g.fillStyle = markCol; g.font = font(700, mark.length > 1 ? 7 : 9); g.textAlign = 'center';
      g.fillText(mark, 36, y0 + 18.5); g.textAlign = 'left';
      g.fillStyle = '#16181d'; g.font = font(500, 10);
      g.fillText(name, 50, y0 + 19);
      const target = i === SERVICES.length - 1;
      const hot = target ? near : 0;
      const [px, py, pw, ph] = [124, y0 + 6, 52, 18];
      if (target && touch) { g.fillStyle = '#1fb45a'; rr(px, py, pw, ph, 9); g.fill(); }
      else if (hot > .05) {
        g.fillStyle = `rgba(17,19,23,${.25 + .75 * hot})`; rr(px, py, pw, ph, 9); g.fill();
        g.strokeStyle = `rgba(255,255,255,${.6 * hot})`; g.lineWidth = 2; rr(px - 2, py - 2, pw + 4, ph + 4, 11); g.stroke();
      } else { g.strokeStyle = '#16181d'; g.lineWidth = 1; rr(px + .5, py + .5, pw - 1, ph - 1, 9); g.stroke(); }
      g.fillStyle = (target && (touch || hot > .4)) ? '#ffffff' : '#16181d';
      g.font = font(600, 9); g.textAlign = 'center';
      g.fillText(target && touch ? '✓ готово' : live ? 'Слушать' : 'Пресейв', px + pw / 2, py + 12.5);
      g.textAlign = 'left';
    });

    // Release block.
    if (coverReady) { g.drawImage(coverSmall, PAGE.cover[0], PAGE.cover[1]); }
    g.fillStyle = '#ffffff'; g.font = font(500, 10);
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 3;
    g.fillText('аноматвер, полина рыженко', 214, 178);
    g.font = font(700, 17); g.fillText('начало конца', 214, 199);
    g.shadowBlur = 0;
    g.fillStyle = '#2d8cff'; g.beginPath(); g.arc(352, 175, 4, 0, 7); g.fill();
    ['#0077ff', '#25d366', '#8a5cf6', '#2aa3e0', '#9aa0aa'].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(220 + i * 17, 216, 6, 0, 7); g.fill(); });
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = font(400, 7);
    g.fillText('powered by BandLink', 296, 256);
    tex.needsUpdate = true;
  }

  const api = {
    buttonWorld, coverWorld, buttonHalfW: bw / PAGE.w * MON.w / 2, dirty: true, glow: 0,
    update(dt, touch, near) {
      acc += dt;
      api.glow = touch ? 1 : near * .6;
      // Numeric keys: no string building every frame.
      const key = (touch ? 1 : 0) + (S.live ? 2 : 0) + (coverReady ? 4 : 0) + (fontReady ? 8 : 0) + Math.round(near * 10) * 16;
      const sec = Math.floor(S.now() / 1000);
      if (api.dirty || ((key !== lastKey || sec !== lastSec) && acc > .08)) {
        paint(touch, near); api.dirty = false; lastKey = key; lastSec = sec; acc = 0;
      }
      // The page glows with the kick, and swells with the reverb it can't reach.
      mat.color.setScalar(1.05 + .1 * FX.kick + .05 * FX.build + .22 * FX.tail - .12 * FX.hush * (1 - FX.tail));
    },
  };
  return api;
}

function mix(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1)).getHexString(); }

/* ---------------------------------------------------------------- rain & city */

// The rain runs on its own clock (FX.time): faster and brighter through the build, lit
// white by the lightning, nearly frozen in the reverb tail (slow motion, with short drops
// instead of streaks), back to normal on "signal lost". city.update() drives both.
let rainU = null;
function buildRain(scene) {
  const N = 760;
  const pos = new Float32Array(N * 6), seed = new Float32Array(N * 8), color = new Float32Array(N * 6);
  const cols = ['#7fb3d9', '#ff5fa2', '#5ff2e0'].map(c => new THREE.Color(c));
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const x = (rnd() - .5) * 36, z = -2.3 - rnd() * 6.5, speed = 7 + rnd() * 6, phase = rnd() * 16, len = .16 + rnd() * .34;
    const cc = cols[rnd() < .12 ? 1 : rnd() < .2 ? 2 : 0];
    for (let e = 0; e < 2; e++) {
      pos.set([x - e * .03, e * len, z], (i * 2 + e) * 3);
      seed.set([speed, phase, 0, 0], (i * 2 + e) * 4);
      color.set([cc.r, cc.g, cc.b], (i * 2 + e) * 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  const material = new THREE.ShaderMaterial({
    // `time` is still set by the render loop; the shader runs on `rtime` (see city.update).
    uniforms: { time: { value: 0 }, rtime: { value: 0 }, bright: { value: 1 }, flash: { value: 0 }, stretch: { value: 1 }, beam: { value: 0 }, beamX: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec4 seed; attribute vec3 color; uniform float rtime, bright, flash, stretch, beam, beamX;
      varying vec3 vColor; varying float vA;
      void main(){
        vec3 p=position;
        p.y=p.y*stretch+mod(seed.y*1.3-rtime*seed.x,16.)-.4;
        float lit=beam*smoothstep(1.3,.1,abs(p.x-beamX+(p.y-2.)*.45));
        vColor=mix(color,vec3(.9,.94,1.),min(1.,flash*.9+lit*.7));
        vA=smoothstep(-.4,.6,p.y)*(.25+.2*fract(seed.y))*(bright+lit*2.2+flash*2.5);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,
    fragmentShader: 'varying vec3 vColor;varying float vA;void main(){gl_FragColor=vec4(vColor,vA);}',
  });
  rainU = material.uniforms;
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  scene.add(lines);
  return lines;
}

function buildCity(scene) {
  let seed = 93;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const PAL = ['#e0588f', '#58d3cc', '#4b6bd6', '#9a7ad8', '#c9d6ff'].map(c => new THREE.Color(c));
  const DARK = new THREE.Color('#15122c');
  const blocks = [], wins = [], edges = { pink: [], teal: [] };
  for (let i = 0; i < 31; i++) {
    const x = (i - 15) * 1.55, z = -6 - rand() * 6, h = 3 + rand() * 10, w = .7 + rand() * .7;
    blocks.push([x, h / 2 - .3, z, w, h]);
    for (let yy = .3; yy < h - .2; yy += .48) for (let xx = -.27; xx <= .28; xx += .27) {
      if (rand() > .5) wins.push([x + xx, yy, z + .436, Math.floor(rand() * 5)]);
    }
    if (rand() < .28) {
      const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, .85));
      e.translate(x, h / 2 - .3, z);
      (rand() < .3 ? edges.pink : edges.teal).push(...e.attributes.position.array);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V();
  const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, .85), new THREE.MeshStandardMaterial({ color: '#231e46', roughness: 1 }), blocks.length);
  blocks.forEach(([x, y, z, w, h], i) => bm.setMatrixAt(i, m4.compose(V(x, y, z), q, sc.set(w, h, 1))));
  scene.add(bm);
  const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(.064, .13, .015), new THREE.MeshBasicMaterial(), wins.length);
  wins.forEach(([x, y, z, c], i) => { wm.setMatrixAt(i, m4.makeTranslation(x, y, z)); wm.setColorAt(i, PAL[c]); });
  wm.userData.live = true;
  scene.add(wm);
  const edgeMats = [];
  for (const [name, color] of [['pink', '#ff4f9a'], ['teal', '#3fe0d4']]) {
    if (!edges[name].length) continue;
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edges[name], 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: .45 });
    edgeMats.push(mat);
    scene.add(new THREE.LineSegments(eg, mat));
  }

  // Lightning on the last hit: a jagged bolt with one branch far behind the towers,
  // plus the sky, the fog and the tower faces lifting a little (never a white frame).
  const bolt = [];
  let bx = 1.2, by = 15.5;
  const bz = -15.5, branchAt = 5;
  let brX = 0, brY = 0;
  for (let i = 0; i < 13; i++) {
    const nx = bx + (rand() - .45) * 1.1, ny = by - .75 - rand() * .35;
    bolt.push(bx, by, bz, nx, ny, bz);
    if (i === branchAt) { brX = nx; brY = ny; }
    bx = nx; by = ny;
  }
  for (let i = 0; i < 5; i++) {
    const nx = brX - .5 - rand() * .7, ny = brY - .4 - rand() * .5;
    bolt.push(brX, brY, bz, nx, ny, bz); brX = nx; brY = ny;
  }
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.Float32BufferAttribute(bolt, 3));
  const boltMesh = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({ color: '#f1ecff', fog: false }));
  boltMesh.visible = false; boltMesh.userData.live = true;
  scene.add(boltMesh);
  const SKY = scene.background.clone(), SKY_HI = new THREE.Color('#2c2466');
  const FOG = scene.fog.color.clone(), FOG_HI = new THREE.Color('#3a3175');
  const GLOW = new THREE.Color('#5b4bb8');

  let acc = 0;
  return {
    update(dt, S) {
      updateCues(S, dt);
      const f = FX.flash, h = FX.hush;
      // Rain.
      rainU.rtime.value = FX.time;
      rainU.bright.value = 1 + .6 * FX.build + .35 * h + .12 * FX.kick;
      rainU.flash.value = f;
      rainU.stretch.value = .35 + .65 * Math.min(1.5, FX.speed);
      rainU.beam.value = S.reduced ? 0 : FX.build * (1 - h);
      rainU.beamX.value = -7 + 14 * FX.build;
      // Sky and towers.
      scene.background.copy(SKY).lerp(SKY_HI, f * .6);
      scene.fog.color.copy(FOG).lerp(FOG_HI, f * .6);
      bm.material.emissive.copy(GLOW).multiplyScalar(f * .55);
      wm.material.color.setScalar(1 + .5 * f + .12 * FX.kick - .4 * h * (1 - FX.tail * .5) - .15 * FX.lost);
      for (const m of edgeMats) m.opacity = .45 + .25 * FX.kick + .15 * FX.build + .5 * f - .25 * h;
      boltMesh.visible = FX.bolt > 0;
      // Windows flip faster with the hi-hats and the build, freeze in the reverb, slow down after.
      acc += dt;
      if (h) return;
      if (acc < (S.state === 'playing' ? .15 - (S.env?.high || 0) * .11 - .03 * FX.build : S.state === 'lost' ? .3 : .15)) return;
      acc = 0;
      const i = Math.floor(Math.random() * wins.length);
      wm.setColorAt(i, Math.random() < .35 ? DARK : PAL[Math.floor(Math.random() * 5)]);
      wm.instanceColor.needsUpdate = true;
    },
  };
}

/* ---------------------------------------------------------------- camera */

function createCameraRig(camera, F, screen, S) {
  const flyPts = [[-2.1, .5, .82], [-2.1, .5, -.82], [-1.55, -.25, 0], [.62, .5, 0], [.74, .2, .32], [.7, FOOT_Y, .45], [-.62, FOOT_Y, .9], [.2, .5, 0]]
    .map(p => F.localToWorld(V(...p)));
  const monTL = V(MON.x - MON.w / 2 - .08, MON.y + MON.h / 2 + .12, MON.z + .1);
  const monTR = V(MON.x + MON.w / 2 + .08, MON.y + MON.h / 2 + .12, MON.z + .1);
  const monBR = V(MON.x + MON.w / 2 + .08, MON.y - MON.h / 2 - .1, MON.z + .1);
  const SHOTS = {
    wide: { az: .42, el: .3, fov: 36, sway: .07, keys: [...flyPts, monTL, monTR, monBR, screen.buttonWorld] },
    tall: { az: .3, el: .5, fov: 40, sway: .04, keys: [flyPts[3], flyPts[4], flyPts[5], F.localToWorld(V(-1.05, .1, 0)), F.localToWorld(V(-.5, .7, .3)), screen.buttonWorld.clone().add(V(screen.buttonHalfW + .08, 0, 0)), screen.coverWorld, monTL] },
  };
  const look = V(), tmp = V(), pos = V();
  let shot = SHOTS.wide, dist = 10, offY = 0, width = 1, height = 1;
  let theta = 0, elev = 0, tTheta = 0, tElev = 0;

  const rig = {
    mode: 'room', fade: 1, inside: 0, p: 0, want: false, mind: null,
    get showMind() { return rig.mode === 'mind' || rig.mode === 'leaving'; },
    resize(w, h) {
      width = w; height = h;
      const aspect = w / h;
      shot = aspect < .9 ? SHOTS.tall : SHOTS.wide;
      camera.aspect = aspect;
      camera.fov = shot.fov;
      look.set(0, 0, 0); shot.keys.forEach(p => look.add(p)); look.multiplyScalar(1 / shot.keys.length);
      // Keep the hero between the header and the HUD: fit the distance, then
      // re-centre the projected key points in that band, and fit again.
      const top = clamp(S.safe?.top ?? 0, 0, h * .45), bottom = clamp(S.safe?.bottom ?? h, h * .55, h);
      const yMax = 1 - 2 * top / h, yMin = 1 - 2 * bottom / h, yMid = (yMax + yMin) / 2, xLim = aspect < .9 ? .97 : .94;
      let offX = 0;
      offY = (h - top - bottom) / 2;
      const fits = (az, d) => {
        place(az, shot.el, d);
        return shot.keys.every(p => { tmp.copy(p).project(camera); return Math.abs(tmp.x) < xLim && tmp.y > yMin + .02 && tmp.y < yMax - .02; });
      };
      const fit = () => {
        camera.setViewOffset(w, h, offX, offY, w, h);
        camera.updateProjectionMatrix();
        let far = 0;
        for (const az of [shot.az - shot.sway, shot.az + shot.sway]) {
          let lo = 2, hi = 40;
          for (let i = 0; i < 18; i++) { const d = (lo + hi) / 2; if (fits(az, d)) hi = d; else lo = d; }
          far = Math.max(far, hi);
        }
        return far;
      };
      let best = 0;
      for (let pass = 0; pass < 3; pass++) {
        best = fit();
        place(shot.az, shot.el, best);
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        shot.keys.forEach(p => { tmp.copy(p).project(camera); x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y); });
        offX += (x0 + x1) / 2 * w / 2;
        offY += (yMid - (y0 + y1) / 2) * h / 2;
      }
      dist = fit();
    },
    nudge(dx, dy) {
      tTheta = clamp(tTheta - dx * .004, -.55, .55);
      tElev = clamp(tElev + dy * .002, -.18, .3);
    },
    update(dt, t, cine = {}) {
      const k = 1 - Math.exp(-dt * 3.5);
      theta += (tTheta - theta) * k; elev += (tElev - elev) * k;
      const sway = S.reduced || S.poster ? 0 : Math.sin(t * .16) * shot.sway;
      if (!rig.showMind) {
        place(shot.az + theta + sway, shot.el + elev, dist * (1 - (S.reduced ? 0 : cine.push || 0)));
        const sh = (cine.shake || 0) * (S.reduced ? 0 : .045);
        if (sh) { camera.position.x += Math.sin(t * 91) * sh; camera.position.y += Math.sin(t * 77 + 1) * sh; camera.updateMatrixWorld(); }
        // The reverb tail tilts the frame a couple of degrees: off balance, holding the breath.
        const roll = S.reduced || S.poster ? 0 : (cine.tail || 0) * .035;
        if (roll > .0005) { camera.rotateZ(roll); camera.updateMatrixWorld(); }
      }
      if (rig.mode !== 'room') step(dt);
    },
    dive(on, mind) {
      rig.want = on; rig.mind = mind;
      if (on && rig.mode === 'room') { rig.mode = 'diving'; rig.p = 0; }
      else if (on && rig.mode === 'surfacing') { rig.mode = 'diving'; rig.p = 1 - rig.p; }
      else if (!on && rig.mode === 'diving') { rig.mode = 'surfacing'; rig.p = 1 - rig.p; }
    },
  };

  function place(az, el, d) {
    pos.set(look.x + d * Math.cos(el) * Math.sin(az), look.y + d * Math.sin(el), look.z + d * Math.cos(el) * Math.cos(az));
    camera.position.copy(pos);
    camera.lookAt(look);
    camera.updateMatrixWorld();
  }

  // room -> diving (camera flies into the eye, fades out) -> mind -> leaving -> surfacing -> room
  const eye = V(), eyeLook = V();
  function step(dt) {
    rig.p = Math.min(1, rig.p + dt / (rig.mode === 'mind' ? .6 : 1.1));
    const p = smooth(rig.p);
    if (rig.mode === 'diving' || rig.mode === 'surfacing') {
      const zs = Math.cos(F.rotation.x) < 0 ? -1 : 1; // on its back the other eye faces the camera
      F.localToWorld(eye.set(.72, .2, .3 * zs));
      F.localToWorld(eyeLook.set(1.6, .05, .1 * zs));
      const into = rig.mode === 'diving' ? p : 1 - p;
      camera.position.lerp(eye, into * .97);
      camera.lookAt(tmp.copy(look).lerp(eyeLook, into));
      camera.updateMatrixWorld();
      rig.fade = rig.mode === 'diving' ? 1 - smooth(clamp((rig.p - .6) / .4, 0, 1)) : smooth(clamp(rig.p / .5, 0, 1));
      rig.inside = 0;
      if (rig.p >= 1) {
        if (rig.mode === 'diving') { rig.mode = 'mind'; rig.p = 0; rig.mind.enter(); }
        else { rig.mode = 'room'; rig.fade = 1; if (rig.want) rig.dive(true, rig.mind); }
      }
    } else if (rig.mode === 'mind') {
      rig.fade = p; rig.inside = p;
      if (!rig.want) { rig.mode = 'leaving'; rig.p = 1 - rig.p; }
    } else if (rig.mode === 'leaving') {
      rig.fade = 1 - p; rig.inside = rig.fade;
      if (rig.want) { rig.mode = 'mind'; rig.p = 1 - rig.p; }
      else if (rig.p >= 1) { rig.mode = 'surfacing'; rig.p = 0; rig.mind.leave(); }
    }
  }
  return rig;
}

/* ---------------------------------------------------------------- fly animation */

// The fly's performance. Uses from scene.js scope: THREE, V, clamp, FLY_SCALE, SCREEN_Z.
//
// 1. Choreography is keyed poses: PLAY on the music clock (S.t), IDLE and CONTENT as
//    loops, PRESS on the time since the click. A key says when a move starts, how long
//    it takes and with which ease. Every channel is interpolated on its own, so a quick
//    head twitch never hurries a slow weight shift. Flies are twitchy: fast moves, holds.
// 2. Every channel then goes through its own damped spring. Different stiffness per part
//    = overlapping action: head and legs snap, the thorax follows, abdomen, wings and
//    antennae lag and wobble (follow-through).
// 3. After the dry cut (S.cut) the reverb tail plays in slow motion while the leg creeps
//    the last millimetres; 'lost' freezes the frame a hair short of the button.
// 4. Legs: planted feet are pinned to the desk and re-planted by a tripod gait
//    (L1 R2 L3 / R1 L2 R3); a lifted foreleg follows procedural targets (reach arc,
//    searching loops, pawing, rubbing, head sweep). The IK swings knees around the eyes.

// Damped spring (semi-implicit Euler, sub-stepped at 240 Hz).
class Spring {
  constructor(k, zeta, x = 0) { this.k = k; this.d = 2 * zeta * Math.sqrt(k); this.x = x; this.v = 0; }
  to(target, dt) {
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (this.k * (target - this.x) - this.d * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}

const BEAT = 60 / 125, BAR = BEAT * 4;
const bt = (bar, beat = 1) => BEAT + (bar - 1) * BAR + (beat - 1) * BEAT; // bar 1 = 0.48 s … bar 8 = 13.92 s
const HIT = bt(8);                                                        // the last hit you hear
// Where the fly stands (fly units along its facing; 0 = where the scene placed it).
// Far enough that the throw needs the whole body and a straight leg.
const W_IDLE = -.58, W_UP = -.53, W_CLOSER = -.51, W_MARK = -.49, W_PRESS = -.22, W_DONE = -.4;
// The gap to the pill shrinks with every replay, never to zero (world units).
const gapFor = n => Math.max(.045, .18 * Math.pow(.62, n));

const EASE = {
  lin: x => x,
  io: x => x * x * (3 - 2 * x),                // weight shifts
  out: x => 1 - (1 - x) ** 3,                  // reaches: fast start, soft landing
  in: x => x * x * x,                          // giving up, dropping
  snap: x => 1 - (1 - x) ** 5,                 // twitches, head saccades
  back: x => { const c = 2.1, y = x - 1; return 1 + (c + 1) * y * y * y + c * y * y; }, // overshoot
};

// Channels. Body offsets in fly units (root space), angles in radians.
const REST = {
  lean: 0, rise: 0, side: 0, pitch: 0, roll: 0, yaw: 0, sq: 1,        // thorax: forward, up, sideways, nose-up, roll, yaw, stretch
  look: 1, hp: 0, hy: 0, hr: 0, an: 0,                              // head: tracking weight, pitch/yaw/roll offsets; antennae forward
  abd: 0, pump: 0, br: 1, wo: 0, wl: 0, wb: 0, prob: 0,             // abdomen lift, pumping, breathing; wings open/raise/buzz; proboscis
  walk: W_IDLE, mf: 0, hf: 0, ff: 0,                                // root travel; mid/hind stance; where the right foreleg lands
  fR: 0, rk: 0, ext: .8, rs: 0, rg: 0, rh: 0, rw: 0, rf: 0,         // right foreleg: lifted, reach path, aim fraction, search, rub, head sweep, paw, flick
  fL: 0, lk: 0, lext: .7, lg: 0, lh: 0, lw: 0,                      // left foreleg
  fH: 0, fHL: 0,                                                    // right hind cleans the wing / both hind legs rub
  rub: 1, paw: 1, ts: 1, push: 0, glow: 0, strain: 0,               // rub speed, paws per beat, time scale, camera push, tail glow, full stretch
  die: 0, kick: 0, curl: 0,                                         // dead: rolled onto its back; legs flailing; legs curled up
};
// [stiffness, damping ratio]; channels not listed are used raw.
const SPR = {
  lean: [300, .72], rise: [300, .72], side: [200, .8], pitch: [280, .7], roll: [180, .55], yaw: [220, .8], sq: [520, .36],
  look: [60, 1], an: [260, .45], abd: [70, .32], pump: [200, 1], br: [40, 1], wo: [280, .45], wl: [240, .5], wb: [120, 1], prob: [400, .6],
  walk: [150, 1], ff: [300, 1], fR: [480, .85], rk: [900, .72], ext: [650, .8], rs: [200, 1], rg: [300, 1], rh: [300, 1], rw: [260, 1], rf: [900, 1],
  fL: [480, .85], lk: [500, .75], lext: [500, .8], lg: [300, 1], lh: [300, 1], lw: [260, 1], fH: [400, .9], fHL: [400, .9],
  rub: [300, 1], paw: [60, 1],
  die: [110, .42], kick: [200, 1], curl: [40, 1],                   // the fall bounces and rocks on the back
};

// Keys: [time, duration, ease, {channels}]. Each channel gets its own track: a key moves
// the channels it names, starting from wherever that channel is at that moment.
function timeline(keys, loop = 0) {
  const ks = keys.map(([t, d, e, v]) => ({ t, d: Math.max(d, 1e-3), e: EASE[e], v })).sort((a, b) => a.t - b.t);
  const tracks = {};
  for (const k of ks) for (const c in k.v) {
    tracks[c] = tracks[c] || { c, segs: [], rest: REST[c] };
    tracks[c].segs.push({ t: k.t, d: k.d, e: k.e, a: 0, b: k.v[c] });
  }
  const tl = { tracks: Object.values(tracks), loop };
  enterTL(tl, REST);
  return tl;
}
// Start a (non-looping) timeline from the current pose, so its first keys move from there.
function enterTL(tl, start) {
  for (const tr of tl.tracks) {
    const s = tr.segs, n = s.length;
    tr.rest = s[0].a = tl.loop ? s[n - 1].b : start[tr.c];
    for (let i = 1; i < n; i++) { const p = s[i - 1]; s[i].a = p.a + (p.b - p.a) * p.e(Math.min(1, (s[i].t - p.t) / p.d)); }
  }
}
function sampleTL(tl, t, out) {
  if (tl.loop) t = ((t % tl.loop) + tl.loop) % tl.loop;
  for (const tr of tl.tracks) {
    const s = tr.segs;
    let i = s.length - 1;
    while (i >= 0 && s[i].t > t) i--;
    if (i < 0) { out[tr.c] = tr.rest; continue; }
    const k = s[i];
    out[tr.c] = k.a + (k.b - k.a) * k.e(Math.min(1, (t - k.t) / k.d));
  }
  return out;
}

/* The replay, beat by beat (music time, excerpt E). */
const PLAY = timeline([
  // pickup (quiet): the signal arrives. It freezes mid-groom, forelegs drop, antennae up, head to the screen.
  [0, .1, 'out', {
    fR: 0, fL: 0, rg: 0, lg: 0, rh: 0, lh: 0, rw: 0, lw: 0, rs: 0, rf: 0, fH: 0, fHL: 0, rk: 0, lk: 0, ext: .7, lext: .7,
    prob: 0, wo: 0, wl: 0, wb: 0, look: 1, hp: .05, hr: 0, hy: 0, sq: .97, rise: -.03, lean: -.015, side: 0, roll: 0, pitch: 0, yaw: 0,
    abd: .05, pump: 0, br: 1, an: .6, mf: 0, hf: 0, ff: 0, rub: 1, paw: 1, ts: 1, push: 0, glow: 0, strain: 0,
  }],
  [0, .4, 'io', { walk: W_IDLE }],                                          // (after a replay: backs up to its mark)
  [.14, .22, 'io', { sq: 1, rise: .012, lean: 0, abd: 0, hp: .1 }],
  [.3, .16, 'io', { an: .15 }],
  [.36, .12, 'io', { lean: -.025, pitch: .015 }],                           // weight back: about to go
  // bar 1: walks up to the screen (tripod steps on the eighths), stops, rocks back, cocks the head
  [bt(1), .9, 'io', { walk: W_UP }],
  [bt(1), .18, 'out', { lean: .035, pitch: -.025 }],
  [bt(1, 3) - .06, .1, 'out', { lean: -.035, pitch: .025 }],
  [bt(1, 3) + .04, .24, 'io', { lean: 0, pitch: 0 }],
  [bt(1, 3) + .1, .06, 'snap', { hr: .17, hp: .13 }],
  [bt(1, 4), .06, 'snap', { hr: -.04, hp: .08 }],
  // anticipation: weight onto the left legs, the right foreleg comes up in front of the face, rocks back
  [bt(1, 4) + .1, .12, 'io', { side: -.02, roll: -.035 }],
  [bt(1, 4.5), .2, 'io', { fR: 1, rk: 0, ext: .7, lean: -.035, rise: -.015, sq: .97, pitch: .04, hr: 0 }],
  // bar 2 — attempt 1, tentative: half way, hesitates, reaches, taps about, gives up, shakes the leg, rubs
  [bt(2), .22, 'out', { rk: .5, lean: .03, rise: .025, pitch: .05, sq: 1 }],
  [bt(2, 1.5), .06, 'snap', { hp: .15, hr: .06 }],
  [bt(2, 2), .16, 'out', { rk: 1, ext: .74, lean: .07, rise: .05, pitch: .07, sq: 1.03, abd: -.04, hr: 0, side: -.01, roll: -.02 }],
  [bt(2, 3), .1, 'out', { ext: .77, lean: .085, rs: .5 }],
  [bt(2, 3.5), .1, 'out', { ext: .79, lean: .09 }],
  [bt(2, 4), .14, 'in', { rk: 0, ext: .7, rs: 0, lean: -.01, rise: 0, pitch: .01, sq: .99, abd: 0, hr: .2, hp: -.02, side: 0, roll: 0 }],
  [bt(2, 4) + .14, .04, 'lin', { rf: 1 }], [bt(2, 4) + .3, .06, 'lin', { rf: 0 }],
  [bt(2, 4.5), .12, 'io', { fL: 1, rg: 1, lg: 1, hr: .05, hp: -.08, look: .5 }],
  // bar 3 — attempt 2: steps closer, a deeper wind-up, a bigger reach, the other foreleg leaves the desk; a wing flick
  [bt(3), .1, 'io', { fL: 0, rg: 0, lg: 0, look: 1, hp: .1, hr: 0 }],
  [bt(3) + .04, .4, 'io', { walk: W_CLOSER }],
  [bt(3, 2), .2, 'io', { sq: .95, rise: -.04, lean: -.06, pitch: .03, rk: -.3, ext: .84, hp: .15, side: -.015, roll: -.03 }],
  [bt(3, 2.5), .13, 'back', { rk: 1, ext: .85, lean: .14, rise: .08, pitch: .11, sq: 1.045, abd: -.08, wo: .12, push: .03, side: 0, roll: 0 }],
  [bt(3, 2.5) + .07, .12, 'io', { fL: 1, lk: .3, lext: .72 }],
  [bt(3, 3), .12, 'out', { ext: .87, lean: .15, rs: .6 }],
  [bt(3, 4), .12, 'out', { ext: .89, lean: .16, rise: .1, rs: .7 }],
  [bt(3, 4.5), .14, 'in', { rk: .1, ext: .8, lean: .02, rise: 0, pitch: .02, sq: .98, wo: 0, fL: 0, lk: 0, rs: 0, hp: -.06, hr: -.15, abd: 0 }],
  [bt(3, 4.5) + .08, .05, 'out', { wo: .55 }], [bt(3, 4.5) + .15, .09, 'io', { wo: 0 }],
  [bt(3, 4.5) + .08, .05, 'snap', { hy: .16 }], [bt(3, 4.5) + .15, .05, 'snap', { hy: -.1 }], [bt(3, 4.5) + .22, .1, 'io', { hy: 0 }],
  // bar 4 — attempt 3: a whole beat of wind-up, the full-body lunge on tiptoe, strains, wobbles, tips over, catches itself
  [bt(4), .44, 'io', { sq: .93, rise: -.06, lean: -.085, pitch: .05, rk: -.45, hp: .17, hr: 0, abd: .08, pump: .7, side: -.02, roll: -.035, wl: .08 }],
  [bt(4, 2), .12, 'back', { rk: 1, ext: .89, lean: .22, rise: .15, pitch: .17, sq: 1.06, abd: -.12, wo: .3, wl: .2, pump: 0, push: .05, side: 0, roll: 0 }],
  [bt(4, 2) + .05, .12, 'io', { fL: 1, lk: .5, lext: .75 }],
  [bt(4, 3), .1, 'out', { ext: .9, lean: .23, rs: .7, wb: .12 }],
  [bt(4, 3), .24, 'io', { roll: .05 }],
  [bt(4, 3.5), .1, 'out', { ext: .905, lean: .24, rise: .16 }],
  [bt(4, 3.5), .2, 'io', { roll: -.03 }],
  [bt(4, 4), .16, 'in', { lean: .31, rise: .1, pitch: -.03, roll: .15, side: .045, ext: .91, hr: .1 }],
  [bt(4, 4) + .16, .08, 'in', { fR: 0, rk: 0, fL: 0, lk: 0, rs: 0, ff: .16, wo: 0, wl: 0, wb: 0, rise: -.07, sq: .93, lean: .13, pitch: -.07, hp: -.14, abd: .07, push: .04 }],
  [bt(4, 4.5) + .02, .2, 'out', { roll: 0, side: 0, sq: 1, rise: 0, lean: .04, pitch: 0, hp: .04, hr: 0 }],
  // bars 5–6: rears up and paws the air with both forelegs, alternating; bar 6 a step closer and twice as fast
  [bt(5), .2, 'out', { fR: 1, fL: 1, rk: .6, ext: .9, lk: .5, lext: .78, rise: .13, pitch: .2, lean: .1, mf: .1, rw: 1, lw: 1, paw: 1, hp: .12, abd: -.06, ff: 0, sq: 1.02 }],
  [bt(5, 3), .08, 'snap', { hr: .08 }], [bt(5, 4), .08, 'snap', { hr: -.05 }],
  [bt(6), .3, 'io', { rise: .16, pitch: .22, lean: .13, rk: .72, lk: .6, ext: .92, rw: 1.15, lw: 1.15, paw: 2, push: .06, hr: 0 }],
  [bt(6), .5, 'io', { walk: W_MARK }],
  [bt(6, 4), .2, 'io', { rw: .6, lw: .6, paw: 1 }],
  // bar 7 — the build, a held breath: the pawing stops dead, forelegs pulled in, it sinks;
  // on the kick gaps the wings go up into a V, the halteres and wings start to buzz
  [bt(7), .06, 'snap', { rw: 0, lw: 0 }],
  [bt(7), .4, 'io', { wb: .12 }],
  [bt(7, 1.5), .3, 'io', { rk: -.45, lk: -.25, ext: .96, lext: .85, sq: .96, rise: .06, lean: 0, pitch: .12, abd: .06, an: .4, hp: .16, mf: -.04 }],
  [bt(7, 2.5), .06, 'snap', { wl: .35, wo: .08, wb: .3 }],
  [bt(7, 2.5), .4, 'io', { sq: .93, rise: -.02, lean: -.04, pitch: .1, br: .3 }],
  [bt(7, 4), .06, 'snap', { wl: .6, wo: .16, wb: .45, an: .8 }],
  [bt(7, 4), .44, 'io', { sq: .9, rise: -.065, lean: -.075, pitch: .08, abd: .12, br: 0, rk: -.55, push: .1 }],
  // THE THROW on the last hit: everything goes forward at once — the biggest reach of the replay
  // (starts a hair before the beat: with the spring lag the leg lands on it)
  // (starts a hair before the beat: with the spring lag the leg lands on it). The thorax
  // leans as far as a straight leg needs (strain), on tiptoe, abdomen up as a counterweight.
  [HIT - .03, .08, 'back', { rk: 1, ext: .965, lk: .8, lext: .85, sq: 1.08, lean: .2, rise: .22, pitch: .22, wo: .8, wl: .3, wb: .6, abd: -.22, hp: .2, push: .14, an: -.5 }],
  [HIT - .03, .12, 'out', { strain: 1 }],
  [HIT + .12, .25, 'out', { lean: .205, sq: 1.07 }],
]);
const PLAY_KICKS = [bt(1, 3) + .1, bt(2, 4), bt(3, 4.5), bt(4, 4.5), bt(7, 2.5), bt(7, 4)];

// The reverb tail, u = 0 at the dry cut … 1 at the hard stop: slow motion that keeps
// slowing, the leg creeps the last millimetres, the wings spread, the camera leans in.
function tailPose(u, o) {
  const e = 1 - (1 - u) * (1 - u);
  o.ts = .15 - .09 * u;
  o.ext += .035 * e; o.lean += .012 * e; o.rise += .01 * e; o.pitch += .012 * e;
  o.wo += .1 * e; o.wb = .45; o.an += .35 * e;
  o.push += .06 * u; o.glow = u;
  return o;
}

/* Waiting: grooming, glances at the screen (a loop, seconds). */
function idleKeys(content, walk) {
  return [
    [0, .25, 'io', { look: 1, hp: .05, fR: 0, fL: 0, rg: 0, lg: 0, rk: 0, lean: 0, rise: 0, pitch: 0, side: 0, roll: 0, walk, prob: 0, an: 0 }],
    [.55, .16, 'io', { fR: 1, fL: 1, rg: 1, lg: 1, look: .25, hp: -.1, pitch: .03, rise: .015 }],          // rubs the forelegs
    [2.1, .06, 'lin', { rub: 0 }], [2.4, .06, 'lin', { rub: 1 }],                                          // a pause in the rubbing
    [3.2, .2, 'io', { rg: 0, lg: 0, rh: 1, lh: 1, hp: -.24, pitch: -.02 }],                                 // sweeps the head
    [4.6, .16, 'io', { rh: 0, lh: 0, rg: 1, lg: 1, hp: -.1, pitch: .03 }],                                  // cleans the legs again
    [5.4, .14, 'in', { fR: 0, fL: 0, rg: 0, lg: 0, pitch: 0, rise: 0 }],
    [5.7, .06, 'snap', { look: 1, hp: .08 }],                                                              // glance at the screen
    [5.7, .08, 'out', { an: .4 }], [5.9, .3, 'io', { an: 0 }],
    ...(content
      ? [[6.1, .3, 'out', { prob: 1 }], [6.6, .2, 'io', { prob: 0 }]]                                      // pleased: tastes the air
      : [[6.15, .22, 'io', { fR: 1, rk: .3, ext: .62, lean: .035 }], [6.7, .2, 'io', { fR: 0, rk: 0, lean: 0 }]]), // a tentative lift towards it
    [7.1, .22, 'io', { side: -.035, roll: -.05, fH: 1, look: .3, hp: -.04 }],                               // right hind leg cleans the wing
    [8.3, .18, 'io', { fH: 0, side: 0, roll: 0, fHL: 1, abd: .12, lean: .03, pitch: -.05 }],                // hind legs rub under the abdomen
    [9.5, .16, 'io', { fHL: 0, abd: 0, lean: 0, pitch: 0 }],
    [9.8, .06, 'out', { wo: .45 }], [9.92, .08, 'io', { wo: 0 }], [10.05, .06, 'out', { wo: .4 }], [10.17, .08, 'io', { wo: 0 }], // wing scissoring
    [10.5, .3, 'io', { look: 1, hp: .05 }],
  ];
}
const LOOP = 11.5;
const IDLE = timeline(idleKeys(false, W_IDLE), LOOP);
const CONTENT = timeline(idleKeys(true, W_DONE), LOOP);
const IDLE_KICKS = [5.7, 10.5];

/* Someone pressed for it: the fly finally gets there, presses, holds, lets go, rubs its paws. */
const PRESS = timeline([
  [0, .12, 'snap', {
    look: 1, hp: .12, an: .6, rg: 0, lg: 0, rh: 0, lh: 0, rw: 0, lw: 0, rs: 0, rf: 0, fH: 0, fHL: 0, fL: 0, lk: 0, wo: 0, wl: 0, wb: 0,
    ts: 1, glow: 0, strain: 0, prob: 0, br: 1, pump: 0, ff: 0, mf: 0, hf: 0, sq: .97, lean: 0, rise: 0, pitch: .02, roll: 0, side: 0, yaw: 0, hy: 0, hr: 0, abd: .03, rub: 1, paw: 1,
  }],                                                                    // perks up
  [.1, .2, 'io', { fR: 1, rk: 0, ext: .9, sq: 1 }],                     // foreleg up in front of the face
  [.15, .5, 'io', { walk: W_PRESS }],                                   // walks up
  [.2, .3, 'io', { an: 0 }],
  [.5, .15, 'io', { rk: -.35, sq: .95, lean: -.03, rise: -.02, pitch: .06, hp: .16, push: .1 }],          // wind-up
  [.66, .12, 'back', { rk: 1, ext: 1, sq: 1.06, lean: .2, rise: .14, pitch: .14, wo: .2, abd: -.1 }],   // reach
  [.8, .1, 'out', { rk: 1.15 }],                                        // contact
  [.9, .1, 'out', { sq: .99, lean: .18 }],                              // recoil, holds it
  [1.5, .3, 'io', { rk: 0, ext: .8, lean: .02, rise: .02, pitch: .02, sq: 1, wo: 0, abd: 0, push: .04 }], // lets go
  [1.85, .2, 'io', { fR: 0, lean: 0, rise: 0, pitch: 0 }],
  [1.9, .5, 'io', { walk: W_DONE }],                                    // steps back to look
  [2.05, .06, 'out', { wo: .5 }], [2.17, .08, 'io', { wo: 0 }], [2.29, .06, 'out', { wo: .45 }], [2.41, .08, 'io', { wo: 0 }], // wing scissoring
  [2.6, .2, 'io', { fR: 1, fL: 1, rg: 1, lg: 1, look: .3, hp: -.08, push: 0 }],                            // rubs its paws
  [3.4, .12, 'out', { prob: 1 }], [3.8, .15, 'io', { prob: 0 }],
  [4.4, .2, 'io', { fR: 0, fL: 0, rg: 0, lg: 0, look: 1, hp: .05 }],
]);
const PRESS_END = 4.8;

/* 23:00, an hour before the release: it dies. A jolt, a last buzz, a stagger, falls on its back,
   the legs flail, slow down and curl up. Then it lies there; now and then a leg twitches. */
const DIE = timeline([
  [0, .07, 'snap', {
    look: 0, hp: .14, an: .75, sq: .95, rise: -.02, fR: 0, fL: 0, rg: 0, lg: 0, rh: 0, lh: 0, rw: 0, lw: 0, rs: 0, rf: 0, fH: 0, fHL: 0,
    rk: 0, lk: 0, ext: .7, lext: .7, prob: 0, ts: 1, push: 0, glow: 0, strain: 0, pump: 0, mf: 0, hf: 0, ff: 0, rub: 1, paw: 1, hy: 0,
  }],                                                                    // the jolt
  [.06, .08, 'snap', { wb: .9, wo: .22, wl: .3 }],                      // a last buzz
  [.12, .3, 'io', { side: .05, roll: .2, lean: -.04, pitch: .05, hr: .28, abd: .12 }], // staggers
  [.42, .05, 'lin', { wb: 0, wl: 0 }],
  [.44, .28, 'in', { die: 1, kick: 1, br: 0 }],                          // falls on its back (the spring bounces it)
  [.5, .25, 'io', { roll: 0, side: 0, lean: 0, rise: 0, pitch: 0, sq: 1, wo: .55, an: -.45, hp: -.28, hr: 0, abd: .1, prob: .8 }],
  [1.1, 1.4, 'io', { kick: .35 }],                                       // the flailing slows down
  [2.3, 1.3, 'in', { kick: 0, curl: 1 }],                               // the legs curl up and stop
]);
const DIE_END = 3.8;

/* After the release, someone pressed «слушать» for it: the legs kick, it rolls over, stands up, shakes it off,
   scissors the wings and rubs its paws. Then it listens (CONTENT). */
const REVIVE = timeline([
  [0, .1, 'snap', { kick: 1, curl: 0, an: .2 }],
  [.12, .15, 'snap', { wb: .8, wo: .3 }],
  [.62, .3, 'back', { die: 0, wb: 0, prob: 0, br: 1 }],                  // rolls over onto its feet
  [.7, .3, 'io', { kick: 0, wo: 0, look: 1, hp: .1, an: .6, sq: .94, rise: -.04, hr: 0 }],
  [1.05, .18, 'out', { sq: 1.04, rise: .03 }],                           // shakes it off
  [1.25, .2, 'io', { sq: 1, rise: 0, an: 0 }],
  [1.05, .5, 'io', { walk: W_DONE }],                                   // (until here it stays where it lay)
  [1.45, .06, 'out', { wo: .5 }], [1.57, .08, 'io', { wo: 0 }], [1.69, .06, 'out', { wo: .45 }], [1.81, .08, 'io', { wo: 0 }],
  [2.1, .2, 'io', { fR: 1, fL: 1, rg: 1, lg: 1, look: .3, hp: -.08 }],  // rubs its paws
  [3.1, .2, 'io', { fR: 0, fL: 0, rg: 0, lg: 0, look: 1, hp: .05 }],
]);
const REVIVE_END = 3.5;
// Dead legs, body space, from each hip: bent up over the belly (on its back that is up), claws in.
const DEAD_LEG = { fore: [.22, -.6, .14], mid: [0, -.66, .2], hind: [-.2, -.6, .16] };
const DEAD_ROLL = -(Math.PI - .3);   // on its back, the belly turned a little to the camera

// Body-space targets near the face (right side; z is mirrored for the left leg).
const READY = [.9, -.16, .44], COCK = [-.12, .2, .1], RUB = [1.0, -.5, .07];
const SWEEP = [[-.04, .36, .36], [.24, .33, .34], [.42, .03, .3], [.3, -.26, .18]]; // head space, around the eye
const EYES = [[.12, .05, .2, .3], [.12, .05, -.2, .3], [.02, 0, 0, .3]];            // head space: centre + radius
const TRIPODS = [['Lfore', 'Rmid', 'Lhind'], ['Rfore', 'Lmid', 'Rhind']];

// What the fly does: S.state, except it is dead (S.dead), or getting up after «слушать».
const flyState = S => S.poster ? 'lost' : S.dead ? 'dead' : S.died && S.live && S.state === 'pressed' ? 'revive' : S.state;

function createFlyAnimator(fly, screen, S) {
  const body = fly.body, head = fly.head, F = fly.group, L = fly.legs;
  F.rotation.order = 'YXZ'; // the death roll turns around its own long axis
  const R1 = L.Rfore, REACH = .99 * (R1.len[0] + R1.len[1] + R1.len[2]);
  const out = { touch: false, near: 0, push: 0, shake: 0, tail: 0, die: 0 };
  const base = F.position.clone(), fwd = V(Math.cos(F.rotation.y), 0, -Math.sin(F.rotation.y));
  const sp = {}, val = { ...REST }, raw = { ...REST }, from = { ...REST };
  for (const c in SPR) sp[c] = new Spring(SPR[c][0], SPR[c][1], REST[c]);
  const hd = { y: new Spring(1100, .75), p: new Spring(1100, .75), r: new Spring(700, .6) };
  const ant = new Spring(500, .16), push = new Spring(6, 1), glow = new Spring(20, 1);
  let lastState = '', stateT = 0, idleT = 0, animT = 0, blend = 1, prevMusic = 0, hitDone = false, touched = false;
  let rubPh = 0, sweepPh = 0, hindPh = 0, prevWalk = REST.walk, gazeY = 0, gazeP = 0, lastQ = -1, lastGroup = 1, forceRun = false;
  let lastSt = -1, stEx = 0, planted = false, deadWalk = REST.walk, fromDead = false;
  const deadTip = V(), deadDir = V(), stand = new THREE.Matrix4();

  // Per-leg gait state: world anchor, current step (preallocated), lifted weight.
  const GAIT = Object.entries(L).map(([k, leg]) => ({
    k, leg, group: TRIPODS[0].includes(k) ? 0 : 1, anchor: V(), want: V(), wantW: V(), free: 0,
    step: false, from: V(), to: V(), t: 0, dur: .2, h: .1,
  }));
  const drift = [0, 0];

  const tmp = V(), tmp2 = V(), up = V(0, 1, 0), btn = V(), A = V(), AL = V(), press = V(), toA = V(), lat = V();
  const hipR = V(), hipL = V(), p0 = V(), ctl = V(), aim = V(), pos = V(), fdir = V(), m4 = new THREE.Matrix4();
  const avoid = EYES.map(() => ({ c: V(), r: 0 })), tipW = V(), vel = V();
  const bodyPt = (x, y, z, o) => o.set(x, y, z).applyMatrix4(body.matrix);
  const headPt = (x, y, z, o) => o.set(x, y, z).applyMatrix4(m4);

  function pose(st, t) {
    for (const c in REST) raw[c] = REST[c];
    if (st === 'playing' || st === 'paused') {
      sampleTL(PLAY, t, raw);
      const cut = S.cut || 14.1, dur = Math.max(cut + .1, S.dur || 16.3);
      if (t > cut) tailPose(clamp((t - cut) / (dur - cut), 0, 1), raw);
      return raw;
    }
    if (st === 'lost') {
      sampleTL(PLAY, 99, raw); tailPose(1, raw);
      raw.ts = forceRun ? 1 : 0; raw.push = .16; raw.glow = 0;
      return raw;
    }
    if (st === 'pressed') return stateT < PRESS_END ? sampleTL(PRESS, stateT, raw) : sampleTL(CONTENT, stateT - PRESS_END, raw);
    if (st === 'dead') { sampleTL(DIE, stateT, raw); raw.walk = deadWalk; return raw; }
    if (st === 'revive') {
      if (!fromDead) return stateT < PRESS_END ? sampleTL(PRESS, stateT, raw) : sampleTL(CONTENT, stateT - PRESS_END, raw);
      return stateT < REVIVE_END ? sampleTL(REVIVE, stateT, raw) : sampleTL(CONTENT, stateT - REVIVE_END, raw);
    }
    return sampleTL(IDLE, idleT, raw);
  }

  // Free (lifted) target of a foreleg in root space. s = +1 right, −1 left.
  function foreTarget(s, hip, k, ext, rs, rg, rh, rw, rf, clock, target, dirOut, pressing) {
    // ready / cocked pose in front of the face
    const c = Math.max(0, -k) / .4;
    bodyPt(READY[0] + COCK[0] * c, READY[1] + COCK[1] * c, s * (READY[2] + COCK[2] * c), p0);
    // never past the aim point unless someone pressed for it: overshoot must not touch the pill
    aim.lerpVectors(hip, target, Math.min(ext, 1));
    toA.subVectors(target, hip).normalize();
    const kk = clamp(k, 0, 1);
    if (k <= 0) pos.copy(p0);
    else {
      // arc from the face to the aim point: a quadratic Bézier with a raised middle
      const dist = p0.distanceTo(aim);
      ctl.addVectors(p0, aim).multiplyScalar(.5).addScaledVector(up, .1 + .16 * dist);
      ctl.z += s * .08;
      const a = (1 - kk) * (1 - kk), b = 2 * kk * (1 - kk), cc = kk * kk;
      pos.set(p0.x * a + ctl.x * b + aim.x * cc, p0.y * a + ctl.y * b + aim.y * cc, p0.z * a + ctl.z * b + aim.z * cc);
      if (pressing && k > 1) pos.lerp(press, clamp((k - 1) / .15, 0, 1));
    }
    lat.crossVectors(toA, up).normalize();
    // searching loops at the end of the reach, on the beat
    if (rs > 0) {
      const ph = clock / BEAT * Math.PI * 2 + (s < 0 ? Math.PI : 0);
      pos.addScaledVector(up, rs * kk * .03 * Math.sin(ph)).addScaledVector(lat, rs * kk * .025 * Math.cos(ph)).addScaledVector(toA, -rs * kk * .02 * (1 + Math.sin(2 * ph)));
    }
    // pawing: a forward-over-the-top circle, alternating legs, on the quarters (paw 1) or eighths (paw 2)
    if (rw > 0) {
      const ph = clock / BEAT * Math.PI * 2 + (s < 0 ? Math.PI : 0), m = clamp(val.paw - 1, 0, 1);
      const sn = Math.sin(ph) * (1 - m) + Math.sin(2 * ph) * m, cs = Math.cos(ph) * (1 - m) + Math.cos(2 * ph) * m;
      pos.addScaledVector(toA, rw * (.09 * sn - .05)).addScaledVector(up, rw * .08 * cs);
    }
    if (rf > 0) pos.addScaledVector(up, rf * .05 * Math.sin(animT * 75)).addScaledVector(lat, rf * .03 * Math.cos(animT * 75));
    // tarsus direction: down in front of the face, aimed at the button when cocked or reaching
    dirOut.set(.5, -.8, s * .15).normalize().lerp(toA, Math.max(kk, Math.min(1, c) * .7)).normalize();
    // rubbing the forelegs together under the head
    if (rg > 0) {
      const w = rubPh + (s < 0 ? Math.PI : 0);
      bodyPt(RUB[0] + .075 * Math.sin(w), RUB[1] + .03 * Math.cos(w), s * RUB[2], tmp);
      pos.lerp(tmp, rg);
      dirOut.lerp(tmp2.set(.25, -.25, -s).normalize(), rg).normalize();
    }
    // sweeping over the eye, outside its surface
    if (rh > 0) {
      const u = (.5 - .5 * Math.cos(sweepPh)) * (SWEEP.length - 1), i = Math.min(SWEEP.length - 2, Math.floor(u)), f = u - i;
      const a = SWEEP[i], b = SWEEP[i + 1];
      headPt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, s * (a[2] + (b[2] - a[2]) * f), tmp);
      pos.lerp(tmp, rh);
      dirOut.lerp(tmp2.set(.4, -.3, -s * .85).normalize(), rh).normalize();
    }
    return pos;
  }

  function pushOutOfHead(p) {
    for (const s of avoid) {
      tmp.subVectors(p, s.c);
      const d = tmp.length();
      if (d < s.r + .03) p.copy(s.c).addScaledVector(tmp, (s.r + .03) / (d || 1e-4));
    }
  }

  function tick(dt, worldT, force) {
    const st = force || flyState(S);
    if (st !== lastState) {
      Object.assign(from, val);
      // The replay and the press start from wherever the fly is; loops cross-fade into it.
      if (st === 'playing' && lastState !== 'paused') { enterTL(PLAY, val); ant.v += 9; hitDone = false; }
      if (st === 'pressed') { enterTL(PRESS, val); touched = false; }
      if (st === 'dead') { enterTL(DIE, val); deadWalk = val.walk; ant.v += 12; }
      if (st === 'revive') { fromDead = val.die > .5; enterTL(fromDead ? REVIVE : PRESS, val); touched = false; }
      blend = st === 'idle' ? 0 : 1;
      if (st === 'idle') idleT = 0;
      lastState = st; stateT = 0;
    }
    // Music clock: S.t arrives at ~30 Hz; run it forward between updates.
    let music = S.t || 0;
    if (st === 'playing') {
      if (music !== lastSt) { lastSt = music; stEx = 0; } else stEx = Math.min(stEx + dt, .05);
      music += stEx;
    }
    pose(st, music);
    const ts = st === 'paused' ? 0 : raw.ts;
    const sdt = dt * ts;
    stateT += dt; animT += sdt;
    if (st === 'idle') idleT += sdt;
    if (blend < 1) {
      blend = Math.min(1, blend + dt / .35);
      const u = EASE.io(blend);
      for (const c in raw) if (c !== 'ts') raw[c] = from[c] + (raw[c] - from[c]) * u;
    }
    for (const c in raw) val[c] = sp[c] ? sp[c].to(raw[c], sdt) : raw[c];

    // Accents: antennae flick on every bar and on the key beats; the last hit kicks everything.
    if (st === 'playing') {
      const bar = Math.floor((music - BEAT) / BAR), pbar = Math.floor((prevMusic - BEAT) / BAR);
      if (bar !== pbar && music > BEAT && music < HIT) ant.v += 6;
      for (const k of PLAY_KICKS) if (prevMusic < k && music >= k) ant.v += 8;
      if (prevMusic < bt(4, 4.5) && music >= bt(4, 4.5) && music < bt(5)) { out.shake = Math.max(out.shake, .35); sp.sq.v -= .8; sp.abd.v += 1.2; }
      if (!hitDone && music >= HIT && music < HIT + .2) { hitDone = true; sp.sq.v += 1.4; sp.wo.v += 5; sp.abd.v -= 2.2; sp.an.v -= 6; ant.v -= 14; out.shake = 1; }
    }
    if (st === 'idle') for (const k of IDLE_KICKS) if (Math.abs((idleT % LOOP) - k) < sdt) ant.v += 10;
    prevMusic = music;

    rubPh += sdt * 34 * val.rub;
    if (val.rh > .01) sweepPh += sdt * Math.PI * 2 / .55; else sweepPh = 0;
    hindPh += sdt * Math.PI * 2 / (val.fHL > val.fH ? .3 : .6);

    // Thorax: position, pitch/roll/yaw, squash & stretch (volume kept). A walking bob comes from the gait.
    let bob = 0, groll = 0;
    for (const g of GAIT) if (g.step) { const s = Math.sin(Math.PI * Math.min(1, g.t)); bob += s; groll += s * g.leg.side; }
    const buzz = S.reduced ? val.wb * .3 : val.wb;
    body.position.set(val.lean, val.rise - bob * .006 + Math.sin(animT * 83) * .004 * buzz, val.side);
    body.rotation.set(val.roll + groll * .012, val.yaw, val.pitch);
    const thin = 1 / Math.sqrt(val.sq);
    body.scale.set(val.sq, thin, thin);
    body.updateMatrix();
    F.position.copy(base).addScaledVector(fwd, val.walk * FLY_SCALE);
    // The feet stay planted where it stood (stance targets come from the upright frame), so the fall
    // doesn't pop and it gets up onto its own feet.
    F.rotation.x = 0; F.updateMatrixWorld(); stand.copy(F.matrixWorld);
    // Dead: rolled onto its back around the long axis; the thorax rests on the desk, on its side half way.
    const dd = clamp(val.die, 0, 1);
    F.position.y += -.26 * dd - .2 * Math.sin(Math.PI * dd);
    F.rotation.x = DEAD_ROLL * clamp(val.die, -.1, 1.15);
    F.updateMatrixWorld();

    // Targets in fly space. The aim stops short of the pill by the gap (the one this replay will end on).
    btn.copy(screen.buttonWorld); F.worldToLocal(btn);
    const n = (S.replays || 0) + (st === 'playing' || st === 'paused' ? 1 : 0);
    A.copy(screen.buttonWorld).add(tmp.set(-screen.buttonHalfW - gapFor(n), -.02, .03)); F.worldToLocal(A);
    press.copy(screen.buttonWorld).add(tmp.set(-screen.buttonHalfW * .4, -.02, .005)); F.worldToLocal(press);
    AL.copy(A).add(tmp.set(-.16, -.24, -.12));
    // Full stretch: the thorax leans exactly as far as a straight reaching leg needs.
    if (val.strain > .001) {
      bodyPt(R1.hip.x, R1.hip.y, R1.hip.z, hipR);
      const ry = A.y - hipR.y, rz = A.z - hipR.z, rr = REACH * REACH - ry * ry - rz * rz;
      if (rr > 0) { body.position.x += clamp(A.x - hipR.x - Math.sqrt(rr), -.06, .14) * val.strain; body.updateMatrix(); }
    }

    // Head: saccades towards the button (jumps, then holds), stabilised against the body roll.
    head.updateMatrix();
    bodyPt(head.position.x, head.position.y, head.position.z, tmp);
    const dx = btn.x - tmp.x, dy = btn.y - tmp.y, dz = btn.z - tmp.z;
    const wantY = (Math.atan2(-dz, dx) - val.yaw) * val.look, wantP = (Math.atan2(dy, Math.hypot(dx, dz)) - val.pitch) * val.look;
    if (Math.abs(wantY - gazeY) > .05 || Math.abs(wantP - gazeP) > .05 || val.look < .98) { gazeY = wantY; gazeP = wantP; }
    const kick = st === 'playing' && music < (S.cut || 14.1) ? (S.env?.low || 0) * .06 : 0;
    head.rotation.set(
      hd.r.to(val.hr - val.roll * .8, sdt),
      hd.y.to(clamp(gazeY + val.hy, -.7, .7), sdt),
      hd.p.to(clamp(gazeP * .75 + val.hp - kick, -.6, .55), sdt));
    head.updateMatrix();
    m4.multiplyMatrices(body.matrix, head.matrix);
    for (let i = 0; i < EYES.length; i++) { const e = EYES[i]; headPt(e[0], e[1], e[2], avoid[i].c); avoid[i].r = e[3]; }

    // Legs. Free weights per leg; desired stance positions in fly space.
    for (const g of GAIT) {
      const leg = g.leg;
      g.free = leg.kind === 'fore' ? (leg.side > 0 ? val.fR : val.fL) : leg.kind === 'hind' ? (leg.side > 0 ? Math.max(val.fH, val.fHL) : val.fHL) : 0;
      g.want.copy(leg.restTip);
      if (leg.kind === 'mid') g.want.x += val.mf;
      if (leg.kind === 'hind') g.want.x += val.hf;
      if (g.k === 'Rfore') g.want.x += val.ff;
      g.wantW.copy(g.want).applyMatrix4(stand);
      if (!planted) g.anchor.copy(g.wantW);
      if (g.free > .001 && !g.step) g.anchor.copy(g.wantW); // a lifted leg lands where it should
    }
    planted = true;
    // Tripod gait: re-plant a whole tripod when its feet drift; on the eighths while the music plays.
    const walkV = sdt > 0 ? (val.walk - prevWalk) / sdt : 0;
    prevWalk = val.walk;
    vel.copy(fwd).multiplyScalar(walkV * FLY_SCALE);
    let busy = 0, progress = 1;
    for (const g of GAIT) {
      if (!g.step) continue;
      g.t += sdt / g.dur;
      if (g.t >= 1) { g.anchor.copy(g.to); g.step = false; } else { busy++; progress = Math.min(progress, g.t); }
    }
    if (sdt > 0) {
      const moving = Math.abs(walkV) > .05;
      if (!busy || (moving && progress > .55)) {
        drift[0] = drift[1] = 0;
        for (const g of GAIT) if (g.free <= .001 && !g.step) drift[g.group] = Math.max(drift[g.group], g.anchor.distanceTo(g.wantW) / FLY_SCALE);
        let gi = drift[0] >= drift[1] ? 0 : 1;
        if (moving && drift[1 - lastGroup] > .02) gi = 1 - lastGroup;
        const thr = moving ? .03 : .07, q = Math.floor(music / (BEAT / 2));
        const onGrid = st !== 'playing' || q !== lastQ || drift[gi] > .16;
        if (drift[gi] > thr && onGrid) {
          lastQ = q; lastGroup = gi;
          const dur = moving ? .17 : .2;
          for (const g of GAIT) {
            if (g.group !== gi || g.free > .001 || g.step || g.anchor.distanceTo(g.wantW) < .015 * FLY_SCALE) continue;
            g.from.copy(g.anchor); g.to.copy(g.wantW).addScaledVector(vel, dur * .9);
            g.t = 0; g.dur = dur; g.h = Math.min(.2, .07 + .35 * g.from.distanceTo(g.to) / FLY_SCALE); g.step = true;
          }
        }
      }
    }
    // Place every tip (fly space) and tarsus direction.
    bodyPt(R1.hip.x, R1.hip.y, R1.hip.z, hipR);
    bodyPt(L.Lfore.hip.x, L.Lfore.hip.y, L.Lfore.hip.z, hipL);
    const clock = st === 'playing' ? music : animT, pressing = st === 'pressed' || (st === 'revive' && !fromDead);
    for (const g of GAIT) {
      const leg = g.leg;
      if (g.step) {
        const e = EASE.io(Math.min(1, g.t));
        tipW.lerpVectors(g.from, g.to, e);
        tipW.y += Math.sin(Math.PI * e) * g.h * FLY_SCALE;
      } else tipW.copy(g.anchor);
      leg.tip.copy(tipW); F.worldToLocal(leg.tip);
      leg.dir.copy(leg.restDir);
      leg.pole.copy(leg.poleBase);
      const w = clamp(g.free, 0, 1);
      if (w <= .001) continue;
      let target;
      if (leg.kind === 'fore') {
        const r = leg.side > 0;
        target = r
          ? foreTarget(1, hipR, val.rk, val.ext, val.rs, val.rg, val.rh, val.rw, val.rf, clock, A, fdir, pressing)
          : foreTarget(-1, hipL, val.lk, val.lext, val.rs * .6, val.lg, val.lh, val.lw, 0, clock, AL, fdir, false);
        const k = clamp(r ? val.rk : val.lk, 0, 1);
        leg.pole.copy(leg.poleBase).lerp(tmp.set(.05, .8, .6 * leg.side), k).normalize();
      } else {
        // hind legs: the right one sweeps along the wing edge, or both rub under the abdomen
        const s = leg.side, rubW = val.fHL / Math.max(1e-3, val.fHL + (s > 0 ? val.fH : 0));
        const u = .5 - .5 * Math.cos(hindPh);
        bodyPt(-.55 - .65 * u, -.18 + .3 * u, s * (.62 - .1 * u), pos);
        bodyPt(-1.42 + s * .07 * Math.sin(hindPh), -.6, s * .08, tmp);
        pos.lerp(tmp, rubW);
        target = pos;
        fdir.set(-.8, .3, 0).lerp(tmp2.set(-.3, -.2, -s * .9), rubW).normalize();
      }
      pushOutOfHead(target);
      leg.tip.lerp(target, w);
      leg.tip.y += Math.sin(Math.PI * w) * .1;
      leg.dir.lerp(fdir, w).normalize();
    }
    // Dead legs: bent up over the belly, flailing (kick) and slowly curling in (curl); a rare twitch later.
    const dw = clamp(val.die * 1.5, 0, 1);
    if (dw > .001) {
      const since = st === 'dead' ? stateT - DIE_END : -1, k = Math.floor(since / 8.3), tw = since - k * 8.3;
      const twitch = since > 0 && !S.reduced && tw < .4 ? Math.sin(tw / .4 * Math.PI) : 0, twLeg = k % 6;
      let i = 0;
      for (const g of GAIT) {
        const leg = g.leg, o = DEAD_LEG[leg.kind], s = leg.side, c = val.curl;
        const ph = animT * (17 + i * 3.1) + i * 1.7, kk = val.kick * (leg.kind === 'fore' ? 1.2 : 1) * (S.reduced ? .3 : 1);
        bodyPt(leg.hip.x + o[0] + kk * .17 * Math.sin(ph), leg.hip.y + o[1] * (1 - .28 * c) + kk * .1 * Math.cos(ph * 1.3),
          leg.hip.z + s * (o[2] * (1 - .45 * c) + kk * .12 * Math.cos(ph)), deadTip);
        if (i === twLeg && twitch) deadTip.x += .09 * twitch * Math.sin(tw * 60);
        deadDir.set(leg.kind === 'hind' ? -.2 : .2, .55 + .3 * c, -s * .8).normalize();
        leg.tip.lerp(deadTip, dw);
        leg.dir.lerp(deadDir, dw).normalize();
        leg.pole.copy(leg.poleBase);
        i++;
      }
    }
    fly.solveLegs(avoid);

    // Antennae: whippy, lag behind the head, flick on the accents.
    const a = ant.to(0, sdt);
    const alive = 1 - clamp(val.die, 0, 1);
    for (let i = 0; i < fly.antennae.length; i++) fly.antennae[i].rotation.z = a * .05 - val.an * .35 - .2 * clamp(val.rk, 0, 1) * val.fR + Math.sin(animT * 3 + i * 2) * .04 * alive;
    // Abdomen: counterbalances the thorax, lags behind it (follow-through), pumps with effort, breathes.
    fly.abdomen.rotation.z = .14 + val.abd - val.pitch * .45 + val.pump * .07 * Math.sin(animT * 7);
    const br = 1 + Math.sin(animT * 2.3) * .035 * val.br;
    fly.belly.scale.set(1, br, br);
    // Wings open, rise in a V and buzz; halteres beat with them.
    for (const { pivot, side } of fly.wings) {
      pivot.rotation.y = side * val.wo * (side > 0 ? 1 : .55);
      pivot.rotation.z = -val.wl * .55 + (side < 0 ? .3 * clamp(val.die, 0, 1) : 0); // dead: the near wing stays above the desk
      pivot.rotation.x = side * buzz * Math.sin(animT * 57 + side * 1.3) * .55;
    }
    if (fly.halteres) for (const { pivot, side } of fly.halteres) pivot.rotation.z = Math.sin(animT * 61 + side) * (.06 * alive + buzz * .9);
    if (fly.proboscis) { fly.proboscis.scale.y = 1 + val.prob * .9; fly.proboscis.rotation.z = .62 - val.prob * .3; }

    // Feedback for the screen, the camera and the post-process.
    tipW.copy(R1.reached); F.localToWorld(tipW);
    const bw = screen.buttonWorld;
    const dist = Math.hypot(Math.max(0, bw.x - screen.buttonHalfW - tipW.x), (tipW.y - bw.y) * 1.2, (tipW.z - SCREEN_Z) * 2);
    out.near = clamp(1 - dist / .5, 0, 1);
    if (pressing && val.rk > 1.08) touched = true;
    out.touch = pressing && touched;
    out.die = val.die;
    out.push = push.to(val.push, dt);
    out.tail = glow.to(val.glow, dt);
    out.shake = Math.max(0, out.shake - dt * 2.5);
  }

  out.update = (dt, worldT) => {
    const st = flyState(S);
    // Opened after 23:00: it is already lying there (and, after «слушать», gets up from there).
    if (!lastState && S.died && !S.poster) for (let i = 0; i < 270; i++) tick(1 / 60, worldT, 'dead');
    // Arriving in the frozen pose without playing into it (a preview link, the poster,
    // a reload): fast-forward so the very first frame already shows the settled pose.
    if (st === 'lost' && lastState !== 'lost' && lastState !== 'playing') {
      forceRun = true;
      for (let i = 0; i < 150; i++) tick(1 / 60, worldT);
      forceRun = false;
    }
    tick(dt, worldT);
  };
  out._gait = GAIT; // for the lab's numeric checks
  return out;
}

/* ---------------------------------------------------------------- inside the head */

// «голова как лента»: inside, the fly's head is a feed. Three depth tiers:
//   FAR  tiny unreadable shards in the distance: there are endlessly many of them
//   MID  readable interface shapes (chip, bubble, push, dialog, search), kept off the centre band
//   FORE one line at a time, DOM text over the canvas (#mind-fore), cut on the grid of the track
// The replay (excerpt E: 125 bpm, bar 1 at 0.48 s, last hit 13.92, dry cut S.cut, tail to S.dur)
// decides what shows when; see MIND_ROWS. THOUGHTS is imported at the top of the file.
import { CUES, DROP, AFTER, PRESSED } from './thoughts.js?v=8';

const MIND_T = { beat: 60 / 125, att: 2.40, paw: 8.16, build: 12.00, eighth: 12.96, drop: 13.92 };
MIND_T.bar = MIND_T.beat * 4;
const MIND_GIVE_UP = [3.90, 5.82, 7.74]; // the fly falls back at 0.78 of each attempt bar
const MIND_POPS = ['повторите попытку', 'что-то пошло не так', 'ещё раз'];
const MIND_LAYERS = ['ui', 'city', 'feed', 'search', 'fly', 'under'];
// Bag weights per section, in MIND_LAYERS order.
const MIND_WEIGHTS = {
  idle: [20, 35, 30, 5, 10, 0], boot: [70, 10, 5, 10, 5, 0], attempt: [25, 30, 20, 10, 15, 0],
  pawing: [20, 20, 25, 10, 20, 5], build: [25, 10, 15, 15, 15, 20], pressed: [0, 50, 50, 0, 0, 0],
};
// The fore line's grid for one replay: [from, to, what]. A CUE lands in the row that contains its t.
// 'typing' never resolves; 'empty' is the beat where nothing comes. Reduced motion: never faster than 0.96 s.
const MIND_ROWS = [
  [0, .96, 'boot'], [.96, 1.92, 'boot'], [1.92, 2.40, 'boot'],
  [2.40, 4.32, 'attempt'], [4.32, 6.24, 'attempt'], [6.24, 8.16, 'attempt'],
  [8.16, 9.12, 'pawing'], [9.12, 10.56, 'typing'], [10.56, 11.04, 'empty'], [11.04, 12.00, 'pawing'],
  [12.00, 12.48, 'beat'], [12.48, 12.96, 'beat'],
  [12.96, 13.20, 'eighth'], [13.20, 13.44, 'eighth'], [13.44, 13.68, 'eighth'], [13.68, 13.92, 'eighth'],
  [13.92, 1e9, 'drop'],
];
const MIND_ROWS_REDUCED = MIND_ROWS.filter(r => r[0] < 12).concat([[12.00, 12.96, 'beat'], [12.96, 13.92, 'eighth'], [13.92, 1e9, 'drop']]);
const MIND_TXT = { ui: '#d6f2f2', city: '#eafcfc', feed: '#c8d2ff', search: '#eafcfc', fly: '#8ff0e6', under: '#ff8cc2' };
const MIND_DOTS = ['#ff3b30', '#1ed760', '#0077ff', '#ffcc00', '#ff9f0a', '#af52de'];
const MIND_TYPING = ['печатает.', 'печатает..', 'печатает...'];
const MIND_JIT = ['-1px', '0px', '1px'];
const MIND_FONT = 'Geologica, "Helvetica Neue", Arial, sans-serif';

function mindRng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mindShuffle(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function mindCell(text) { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0; return h % 96; }

// Shuffle bag per layer: every entry once before any repeats, section gates honoured.
class MindBag {
  constructor(rand, S) {
    this.rand = rand; this.S = S; this.decks = {}; this.ptr = {};
    for (const L of MIND_LAYERS) { this.decks[L] = mindShuffle(THOUGHTS.filter(e => (e.layer || 'city') === L), rand); this.ptr[L] = 0; }
  }
  allowed(e, sec, tier, ok) {
    if (!e.text) return tier !== 'fore';                               // pictograms live in the background
    if (e.when === 'attempt') return tier === 'far';                   // they are the give-up pops
    if (tier === 'fore' && e.special) return false;                    // «печатает…», 99% have their own slots
    if (e.when === 'boot' && sec !== 'boot' && tier !== 'far') return false;
    if ((e.when === 'build' || e.echo) && sec !== 'build' && tier !== 'far') return false;
    if (e.text.includes('{countdown}') && !this.S.countdownShort) return false;
    return !ok || ok(e);
  }
  take(L, sec, tier, ok) {
    const d = this.decks[L];
    for (let pass = 0; pass < 2 && d.length; pass++) {
      for (let j = this.ptr[L]; j < d.length; j++) {
        if (!this.allowed(d[j], sec, tier, ok)) continue;
        const p = this.ptr[L];
        [d[p], d[j]] = [d[j], d[p]];
        this.ptr[L] = p + 1;
        if (this.ptr[L] >= d.length) { mindShuffle(d, this.rand); this.ptr[L] = 0; }
        return d[p];
      }
      mindShuffle(d, this.rand); this.ptr[L] = 0;
    }
    return null;
  }
  next(sec, tier, ok) {
    const w = MIND_WEIGHTS[sec] || MIND_WEIGHTS.idle;
    let sum = 0; for (const x of w) sum += x;
    for (let tries = 0; tries < 8; tries++) {
      let r = this.rand() * sum, i = 0;
      while (i < w.length - 1 && r >= w[i]) { r -= w[i]; i++; }
      const e = this.take(MIND_LAYERS[i], sec, tier, ok);
      if (e) return e;
    }
    for (let i = 0; i < w.length; i++) if (w[i]) { const e = this.take(MIND_LAYERS[i], sec, tier, ok); if (e) return e; }
    return null;
  }
}

// Inside a dead head it is the head after SIGNAL LOST, whatever the sound does.
const mindState = S => S.dead ? 'lost' : S.state;

class Mind {
  constructor(S) {
    this.S = S;
    this.scene = new THREE.Scene();
    this.bg = new THREE.Color('#07051a');
    this.scene.background = this.bg.clone();
    this.scene.fog = new THREE.Fog('#07051a', 5, 21);
    this.camera = new THREE.PerspectiveCamera(62, 1, .05, 60);
    this.items = [];
    this.built = false; this.inside = false;
    this.clock = 0; this.inT = 0; this.speed = .38; this.fov = 62;
    // ?seed=K (S.seed) fixes the shuffle so a clip can be re-recorded identically.
    const seed = Number.isFinite(S.seed) ? S.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    this.rand = mindRng(seed); this.bgRand = mindRng(seed ^ 0x9e3779b9);
    this.foreBag = new MindBag(this.rand, S); this.bgBag = new MindBag(this.bgRand, S);
    this.midTex = new Map(); this.farTex = new Map(); this.pictUrls = new Map();
    this.plan = null; this.lastT = 0; this.st = mindState(S); this.cur = null; this.logged = '';
    this.blackUntil = -1; this.dropFlash = 0; this.dim = 1; this.pop = null;
    this.F = { x: .6, y0: -.15, y1: .15, top: 1, bot: -1, y: 400, lh: 36 };
    // Warm every glyph the textures use (₽, «», digits and Latin sit in other unicode-range subsets).
    const sample = [...THOUGHTS, ...DROP, ...AFTER, ...PRESSED, ...CUES].map(e => e.text || '').join(' ') + MIND_POPS.join(' ') + ' я не робот 99+ 0123456789 отмена выйти нет да';
    this.fonts = Promise.all(['600 26px', '600 16px', '500 30px'].map(f => document.fonts?.load(`${f} Geologica`, sample))).catch(() => {})
      .then(() => { this.fontsReady = true; if (this.built) this.refresh(); });
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  build() {
    this.built = true;
    const S = this.S, mob = !!S.mobile;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    const sprite = (tier, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: tier !== 'fix' }));
      sp.userData = { tier, cell: (i * 37 + (tier === 'mid' ? 17 : 5)) % 96, flash: 0, pulse: 0, e: null, key: '', hw: 0, hh: 0 };
      sp.visible = false;
      this.root.add(sp);
      return sp;
    };
    this.mid = Array.from({ length: mob ? 8 : 12 }, (_, i) => sprite('mid', i));
    this.far = Array.from({ length: mob ? 30 : 40 }, (_, i) => sprite('far', i));
    this.items = [...this.mid, ...this.far];
    // Camera-relative pieces: the give-up pop, the 99+ badge that counts, the stuck 99% bar.
    this.popSp = sprite('fix', 0); this.badgeSp = sprite('fix', 1); this.stuckSp = sprite('fix', 2);
    for (const sp of [this.popSp, this.badgeSp, this.stuckSp]) sp.renderOrder = 2;
    // Connectome web: each shard links to its two nearest neighbours.
    const segs = this.items.length * 2;
    this.linkPos = new Float32Array(segs * 6); this.linkCol = new Float32Array(segs * 6);
    this.linkGeo = new THREE.BufferGeometry();
    this.linkGeo.setAttribute('position', new THREE.BufferAttribute(this.linkPos, 3));
    this.linkGeo.setAttribute('color', new THREE.BufferAttribute(this.linkCol, 3));
    this.links = new THREE.LineSegments(this.linkGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .55, fog: true, depthWrite: false }));
    this.links.frustumCulled = false;
    this.root.add(this.links);
    this.linkT = 0;
    // Dust: tiny neurons in the dark, a tube around the flight path.
    const D = mob ? 260 : 420, dp = new Float32Array(D * 3), r0 = mindRng(7);
    for (let i = 0; i < D; i++) { const a = r0() * 6.28, r = .6 + r0() * 4.2; dp[i * 3] = Math.cos(a) * r; dp[i * 3 + 1] = Math.sin(a) * r * .8; dp[i * 3 + 2] = -r0() * 30; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#40609a', size: 1.5, sizeAttenuation: false, fog: true }));
    this.dust.frustumCulled = false;
    this.root.add(this.dust);
    this.buildDom();
  }

  // The FORE line lives in the page, above the canvas and under the CRT lines.
  buildDom() {
    let root = document.getElementById('mind-fore');
    if (!root) {
      root = document.createElement('div'); root.id = 'mind-fore'; root.className = 'mind-fore'; root.setAttribute('aria-hidden', 'true');
      (document.getElementById('app') || document.body).append(root);
    }
    root.hidden = true;
    const slot = () => { const el = document.createElement('div'); el.className = 'mf'; el.hidden = true; root.append(el); return { el, it: null, t: null, c: null, n: -1, s: '', caret: null, y: -1, glitch: 0, sp: 0, letters: null, jit: -1, dim: false }; };
    this.dom = root; this.A = slot(); this.B = slot();
  }

  enter() {
    if (!this.built) this.build();
    const S = this.S;
    this.inside = true; this.inT = 0;
    this.camera.position.set(0, 0, 0);
    this.fov = 62; this.camera.fov = 62; this.camera.updateProjectionMatrix();
    this.speed = S.reduced ? .3 : .38; this.dim = 1; this.dropFlash = 0; this.blackUntil = -1;
    this.st = mindState(S); this.cur = null; this.logged = ''; this.idleSlot = -1;
    if (this.st === 'lost') this.startLost(1);            // re-entering after the cut starts from «ок.»
    if (this.st === 'pressed') this.startPressed();
    this.layout();
    this.fill();
    S.glitch?.(.6);
  }
  leave() {
    this.inside = false;
    if (this.dom) { this.dom.hidden = true; this.show(this.A, null); this.show(this.B, null); }
    this.S.glitch?.(.5);
  }

  /* ---- layout: where the fore line sits and the box the background keeps out of (NDC) */
  layout() {
    const S = this.S, W = innerWidth || 1, H = innerHeight || 1, mob = W < 801;
    const safe = S.safe || { top: 0, bottom: H };
    const fs = mob ? 20 : 30, lh = fs * (mob ? 1.25 : 1.2);
    const top = clamp(safe.top, 0, H * .45), bot = clamp(safe.bottom, H * .55, H);
    let y = H * (mob ? .56 : .5);
    const lo = top + lh * 1.3 + 6, hi = bot - lh * 1.3 - 6;
    y = lo < hi ? clamp(y, lo, hi) : (top + bot) / 2;
    const F = this.F;
    F.y = Math.round(y); F.lh = lh; F.mob = mob; F.W = W; F.H = H;
    const half = lh * 1.9 + 10;                                   // two lines, plus the second slot in the build
    F.x = (Math.min(W * .86, 720) / 2 + 24) / (W / 2) * 1.12;
    F.y1 = Math.max(.02, (1 - 2 * (y - half) / H) * 1.12);
    F.y0 = Math.min(-.02, (1 - 2 * (y + half) / H) * 1.12);
    F.top = 1 - 2 * top / H; F.bot = 1 - 2 * bot / H;
  }
  tanV() { return Math.tan(this.camera.fov * Math.PI / 360); }

  /* ---- background sprites */
  fill() {
    const cz = this.camera.position.z;
    this.mid.forEach((sp, i) => this.spawnMid(sp, 2.6 + (i + this.bgRand()) / this.mid.length * 5.6, cz));
    this.far.forEach((sp, i) => this.spawnFar(sp, 5 + (i + this.bgRand()) / this.far.length * 13, cz));
    this.linkT = 1;
  }
  section() {
    const S = this.S, st = mindState(S), t = S.t || 0;
    if (st === 'pressed') return 'pressed';
    if (st !== 'playing' && !(st === 'paused' && t > 0)) return 'idle';
    return t < MIND_T.att ? 'boot' : t < MIND_T.paw ? 'attempt' : t < MIND_T.build ? 'pawing' : 'build';
  }
  assign(sp, e) {
    const u = sp.userData, far = u.tier === 'far';
    const text = e ? this.resolve(e.text || '') : '';
    const key = e ? (far ? 'f:' : 'm:') + (e.icon || '') + (e.pict || '') + (e.kind || '') + (e.layer || '') + text : '';
    if (u.key === key && sp.material.map) return;
    if (u.key && !far) this.release(u.key);
    u.e = e; u.key = key;
    const rec = far ? this.farTexture(key, e, text) : this.midTexture(key, () => mindMid(e, text));
    sp.material.map = rec.tex; sp.material.needsUpdate = true;
    const h = far ? .09 + .04 * this.bgRand() : (this.F.mob ? .19 : .21) * rec.h / 42;
    sp.scale.set(h * rec.w / rec.h, h, 1);
  }
  spawnMid(sp, d, cz) {
    const S = this.S, u = sp.userData;
    let e = this.bgBag.next(this.section(), 'mid');
    if (e && this.cur && e.text && this.cur.e === e) e = this.bgBag.next(this.section(), 'mid');
    this.assign(sp, e);
    const tv = this.tanV(), ta = tv * this.camera.aspect, F = this.F;
    const hw = sp.scale.x / 2 / (d * ta), hh = sp.scale.y / 2 / (d * tv);
    let nx = 0, ny = F.top - hh, ok = false;
    for (let k = 0; k < 28 && !ok; k++) {
      nx = (this.bgRand() * 2 - 1) * Math.max(0, .96 - hw);
      ny = F.bot + hh + this.bgRand() * Math.max(0, F.top - F.bot - 2 * hh);
      if (!(nx + hw < -F.x || nx - hw > F.x || ny + hh < F.y0 || ny - hh > F.y1)) continue;
      ok = true;
      // Keep clear of the other readable shards as they are now.
      for (const o of this.mid) {
        if (o === sp || !o.visible) continue;
        const od = cz - o.position.z; if (od < .5) continue;
        const ox = (o.position.x - this.camera.position.x) / (od * ta), oy = (o.position.y - this.camera.position.y) / (od * tv);
        const ow = o.scale.x / 2 / (od * ta), oh = o.scale.y / 2 / (od * tv);
        if (Math.abs(ox - nx) < ow + hw + .03 && Math.abs(oy - ny) < oh + hh + .03) { ok = false; break; }
      }
    }
    sp.position.set(this.camera.position.x + nx * d * ta, this.camera.position.y + ny * d * tv, cz - d);
    u.hw = sp.scale.x / 2; u.hh = sp.scale.y / 2; u.flash = 0; u.pulse = 0;
    sp.visible = !!e;
  }
  spawnFar(sp, d, cz) {
    const e = this.bgBag.next(this.section(), 'far');
    this.assign(sp, e);
    const tv = this.tanV(), ta = tv * this.camera.aspect;
    sp.position.set(this.camera.position.x + (this.bgRand() * 2.3 - 1.15) * d * ta, this.camera.position.y + (this.bgRand() * 2.3 - 1.15) * d * tv, cz - d);
    sp.userData.flash = 0;
    sp.visible = !!e;
  }

  /* ---- textures: FAR tinted white shards (small, kept), MID full colour (LRU, lazily drawn) */
  resolve(text) { return text.includes('{countdown}') ? text.replace('{countdown}', this.S.countdownShort || '') : text; }
  farTexture(key, e, text) {
    let rec = this.farTex.get(key);
    if (!rec) {
      const c = document.createElement('canvas'), g = c.getContext('2d');
      const font = `600 16px ${MIND_FONT}`, t = text || (e?.icon === 'badge' ? '99+' : '✓✓');
      g.font = font;
      c.width = Math.ceil(g.measureText(t).width) + 10; c.height = 22;
      const box = e && e.kind && e.kind !== 'line';
      if (box) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.strokeRect(1, 1, c.width - 2, c.height - 2); }
      g.font = font; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(t, 5, 12);
      rec = { tex: mindTex(c), w: c.width, h: c.height };
      this.farTex.set(key, rec);
    }
    return rec;
  }
  midTexture(key, draw) {
    let rec = this.midTex.get(key);
    if (rec) { this.midTex.delete(key); this.midTex.set(key, rec); rec.ref++; return rec; } // LRU order
    const c = draw();
    rec = { tex: mindTex(c), w: c.width, h: c.height, ref: 1 };
    this.midTex.set(key, rec);
    if (this.midTex.size > 34) for (const [k, r] of this.midTex) { if (r.ref <= 0) { r.tex.dispose(); this.midTex.delete(k); if (this.midTex.size <= 30) break; } }
    return rec;
  }
  release(key) { const r = this.midTex.get(key); if (r) r.ref--; }
  special(sp, key, draw, fracH) {
    const u = sp.userData;
    if (u.key !== key) {
      if (u.key) this.release(u.key);
      u.key = key;
      const rec = this.midTexture(key, draw);
      sp.material.map = rec.tex; sp.material.needsUpdate = true;
      u.aspect = rec.w / rec.h; u.frac = fracH * rec.h / 42;
    }
  }
  // Fonts arrived after the first draw: redraw everything once.
  refresh() {
    for (const r of this.farTex.values()) r.tex.dispose();
    this.farTex.clear();
    for (const sp of [...this.items, this.popSp, this.badgeSp, this.stuckSp]) { const u = sp.userData; if (u.key) { this.release(u.key); u.key = ''; } }
    for (const [k, r] of this.midTex) { r.tex.dispose(); this.midTex.delete(k); }
    for (const sp of this.items) if (sp.userData.e) this.assign(sp, sp.userData.e);
  }

  /* ---- the fore line: items */
  item(e, over) {
    if (!e) return null;
    const kind = e.kind || 'line', layer = e.layer || 'city';
    const text = this.resolve(e.text || '');
    const it = {
      e, text, kind, layer, under: layer === 'under', out: !!e.out, pict: e.pict || null, btns: e.btns || null,
      dot: MIND_DOTS[mindCell(text) % MIND_DOTS.length], typing: e.special === 'typing',
      rate: 0, step: 1, cut: 1e9, caret: false, after: false, t0: 0, t1: 1e9, cell: mindCell(text),
    };
    if (kind === 'search') { it.rate = 2 / .06; it.step = 2; it.caret = true; }
    return Object.assign(it, over);
  }
  makePlan() {
    const S = this.S, bag = this.foreBag, rows = S.reduced ? MIND_ROWS_REDUCED : MIND_ROWS, items = [];
    const short = e => e.text.length <= 18;
    const snappy = e => e.text.length <= 30 && e.kind !== 'dialog' && e.kind !== 'notif';
    const typing = THOUGHTS.find(e => e.special === 'typing') || { text: 'печатает…', kind: 'bubble', layer: 'ui', special: 'typing' };
    for (const [t0, t1, what] of rows) {
      const cue = CUES.find(c => c.t >= t0 - 1e-6 && c.t < t1 - 1e-6);
      let it = null;
      if (what === 'drop') {
        const d = DROP[(S.replays || 0) % DROP.length];
        it = this.item(d, { drop: true, cell: 95 });
      } else if (cue) {
        it = this.item({ layer: 'ui', kind: 'chip', ...THOUGHTS.find(e => e.text === cue.text), ...cue });
      } else if (what === 'typing') it = this.item(typing);
      else if (what === 'empty') it = null;
      else if (what === 'beat') it = this.item(bag.next('build', 'fore', short) || bag.next('build', 'fore'));
      else if (what === 'eighth') {
        it = this.item(bag.next('build', 'fore', snappy) || bag.next('build', 'fore'));
        if (it && it.kind !== 'search' && !S.reduced) {
          // Cut mid-word at 40-70% of the length, no dash, no ellipsis.
          let n = Math.max(2, Math.round(it.text.length * (.4 + .3 * this.rand())));
          while (n < it.text.length - 1 && /[\s,.·]/.test(it.text[n - 1])) n++;
          it.cut = n;
        }
      } else it = this.item(bag.next(what, 'fore'));
      if (it) { it.t0 = t0; it.t1 = t1; it.dual = what === 'eighth' && !S.reduced; }
      items.push({ t0, t1, it });
    }
    return { replays: S.replays || 0, items, i: 0 };
  }
  planAt(t) {
    const P = this.plan.items;
    let i = this.plan.i;
    if (i >= P.length || P[i].t0 > t) i = 0;
    while (i < P.length - 1 && P[i].t1 <= t) i++;
    this.plan.i = i;
    return i;
  }
  startLost(from) {
    this.lostT0 = this.clock + (from ? .3 - from * 2 * MIND_T.bar : .6);
    this.lostItems = AFTER.map(e => this.item({ layer: 'under', ...e }, { rate: 1 / .08, caret: true, after: true, cell: 48 }));
    this.lostEnd = this.item({ text: '', layer: 'under' }, { caret: true, after: true, cell: 48 });
  }
  startPressed() { this.pressT0 = this.clock; this.pressItems = []; }

  /* ---- per frame */
  update(dt, wt) {
    if (!this.built) return;
    const S = this.S, cam = this.camera, st = mindState(S), t = S.t || 0, R = S.reduced;
    this.clock += dt; this.inT += dt;
    if (st !== this.st) {
      if (st === 'lost' && this.st === 'playing') {             // the dry cut: hard black, then the last cell talks
        this.blackUntil = this.clock + .6; this.startLost(0);
      } else if (st === 'lost') this.startLost(1);
      if (st === 'pressed') this.startPressed();
      if (st === 'playing' && this.st !== 'paused') { this.dim = 1; this.dropFlash = 0; }
      this.st = st;
    }
    const playing = st === 'playing' || (st === 'paused' && t > 0);
    const black = this.clock < this.blackUntil;
    this.layout();

    // Which fore line(s) now.
    let A = null, B = null, log = null, logCell = null;
    if (playing) {
      if (!this.plan || this.plan.replays !== (S.replays || 0) || t < this.lastT - .5) this.plan = this.makePlan();
      const i = this.planAt(t), row = this.plan.items[i];
      A = row.it;
      if (A?.dual && i > 0) B = this.plan.items[i - 1].it;
      if (row.it?.drop) { log = t > (S.cut || 14.1) ? 'SIGNAL / DECAY' : '96/96 CELLS'; }
      else if (A) { log = A.typing ? 'печатает…' : A.text; logCell = A.cell; }
      this.events(this.lastT, t, st === 'playing');
      this.lastT = t;
    } else if (st === 'lost') {
      if (!black) {
        const k = Math.floor((this.clock - this.lostT0) / (2 * MIND_T.bar));
        A = k < 0 ? null : k < this.lostItems.length ? this.lostItems[k] : this.lostEnd;
        if (A) { A.t0 = this.lostT0 + Math.min(k, this.lostItems.length) * 2 * MIND_T.bar; if (A.text) { log = A.text; logCell = 48; } }
      }
    } else if (st === 'pressed') {
      const k = Math.floor((this.clock - this.pressT0) / (2 * MIND_T.bar));
      while (this.pressItems.length <= k) {
        const j = this.pressItems.length;
        const it = j < PRESSED.length ? this.item({ layer: 'city', ...PRESSED[j] }) : this.item(this.foreBag.next('pressed', 'fore'));
        if (it) it.t0 = this.pressT0 + j * 2 * MIND_T.bar;
        this.pressItems.push(it);
      }
      A = this.pressItems[k];
      if (A) { log = A.text; logCell = A.cell; }
    } else {
      const k = Math.floor(this.clock / 2.4);
      if (k !== this.idleSlot) { this.idleSlot = k; this.idleItem = this.item(this.foreBag.next('idle', 'fore')); if (this.idleItem) this.idleItem.t0 = this.clock; }
      A = this.idleItem;
      if (A) { log = A.text; logCell = A.cell; }
    }
    this.cur = A;
    if (log !== null) { const key = log + '|' + logCell; if (key !== this.logged) { this.logged = key; S.onThought?.(log, logCell); } }

    // Camera: flies on the music, speeds up in the build, freezes on the last hit, dollies in the tail.
    const cut = S.cut || 14.1, dur = S.dur || 16.3, tail = playing && t > cut ? clamp((t - cut) / Math.max(.1, dur - cut), 0, 1) : 0;
    const e = S.env || { low: 0, mid: 0, high: 0 };
    let v = .3, fov = 62, k = 3;
    if (R) v = st === 'lost' ? 0 : .3;
    else if (st === 'lost') v = 0;
    else if (st === 'pressed') v = .25;
    else if (st === 'paused') v = .05;
    else if (playing) {
      if (t >= MIND_T.drop) { v = tail > 0 ? .3 / Math.max(.1, dur - cut) : 0; k = 22; fov = 68; }
      else {
        v = .38 + e.low * .5 + e.mid * .3;
        if (t >= MIND_T.build) { const s = (t - MIND_T.build) / (MIND_T.drop - MIND_T.build); v += (1.2 - v) * s * s; fov = 62 + 6 * s * s; }
      }
    }
    this.speed += (v - this.speed) * (1 - Math.exp(-dt * k));
    cam.position.z -= this.speed * dt;
    const sway = R || st === 'lost' ? 0 : 1;
    cam.position.x = Math.sin(this.clock * .23) * .05 * sway;
    cam.position.y = Math.sin(this.clock * .17 + 1) * .035 * sway;
    if (st === 'lost') fov = this.fov;
    if (Math.abs(fov - this.fov) > .01) { this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 4)); if (Math.abs(fov - this.fov) < .02) this.fov = fov; cam.fov = this.fov; cam.updateProjectionMatrix(); }

    // Global levels: the drop flashes every shard once, then the head holds its breath.
    this.dropFlash = Math.max(0, this.dropFlash - dt / .3);
    const dimTo = st === 'lost' ? 1 : playing && t >= MIND_T.drop ? .25 : 1;
    this.dim += (dimTo - this.dim) * (1 - Math.exp(-dt * 12));
    this.root.visible = !black;
    this.scene.background.copy(this.bg).multiplyScalar(black ? 0 : 1);

    this.updateSprites(dt, playing, tail);
    this.updateSpecials(dt, playing, t, black);
    this.updateLinks(dt, st === 'lost', tail);
    this.dust.position.z = Math.ceil(cam.position.z / 30) * 30;

    // DOM
    const visible = this.inside && S.peek && this.inT > .35 && !black;
    if (this.dom.hidden === visible) this.dom.hidden = !visible;
    const now = playing ? t : this.clock;
    this.show(this.A, visible ? A : null);
    this.show(this.B, visible ? B : null, false);
    const off = B ? this.F.lh * .85 : 0;
    this.place(this.A, this.F.y + off); this.place(this.B, this.F.y - off);
    if (this.B.dim !== !!B) { this.B.dim = !!B; this.B.el.classList.toggle('is-dim', !!B); }
    this.tick(this.A, now);
    if (B) this.tick(this.B, B.t1);
    this.smear(this.A, A?.drop ? tail : 0, now);
  }

  events(t0, t1, live) {
    if (!live || t1 <= t0 || t1 - t0 > .3) return;
    const T = MIND_T, R = this.S.reduced;
    const crossed = x => t0 < x && t1 >= x;
    MIND_GIVE_UP.forEach((x, i) => { if (crossed(x)) this.pop = { text: MIND_POPS[i], t0: this.clock, i, key: '' }; });
    // Pawing: three shards fire on every beat. Build: six on every eighth (not on the kick drop-out).
    const b0 = Math.floor(t0 / T.beat), b1 = Math.floor(t1 / T.beat);
    if (b1 !== b0 && t1 >= T.paw && t1 < T.build) this.pulse(3);
    const e0 = Math.floor(t0 / (T.beat / 2)), e1 = Math.floor(t1 / (T.beat / 2));
    if (e1 !== e0 && t1 >= T.eighth && t1 < T.drop && Math.abs(t1 - 13.44) > .05) this.pulse(R ? 2 : 6);
    if (crossed(T.drop)) { if (!R) this.dropFlash = 1; this.pop = null; }
  }
  pulse(n) {
    for (let k = 0; k < n; k++) { const sp = this.mid[Math.floor(Math.random() * this.mid.length)]; sp.userData.pulse = 1; }
  }

  updateSprites(dt, playing, tail) {
    const S = this.S, cam = this.camera, st = mindState(S), lost = st === 'lost', R = S.reduced;
    const tv = this.tanV(), ta = tv * cam.aspect, F = this.F, cz = cam.position.z;
    const fire = S.fire, flashAmp = R ? 0 : 2.5 * this.dropFlash;
    for (const sp of this.mid) {
      const u = sp.userData, d = cz - sp.position.z;
      const nx = (sp.position.x - cam.position.x) / (d * ta), ny = (sp.position.y - cam.position.y) / (d * tv);
      const hw = u.hw / (d * ta), hh = u.hh / (d * tv);
      if (!lost && (d < 1.4 || Math.abs(nx) - hw > 1.02 || ny - hh > F.top + .02 || ny + hh < F.bot - .02 || !sp.visible)) { this.spawnMid(sp, 8 + this.bgRand() * .8, cz); continue; }
      // Fade out as it slides under the header or the HUD.
      const edge = Math.min(F.top - (ny + hh * .3), (ny - hh * .3) - F.bot);
      sp.material.opacity = clamp(edge / .08, 0, 1) * clamp((d - 1.4) / .6, 0, 1);
      if (!lost) {
        if (fire?.[u.cell] && Math.random() < .05) u.flash = 1;
        u.flash = Math.max(0, u.flash - dt * 1.8);
        u.pulse = Math.max(0, u.pulse - dt / .25);
      }
      const b = lost ? .3 : st === 'pressed' ? .7 : (.8 + .15 * u.flash + (R ? .2 : .8) * u.pulse) * this.dim + flashAmp;
      sp.material.color.setScalar(b);
    }
    for (const sp of this.far) {
      const u = sp.userData, d = cz - sp.position.z;
      if (!lost && (d < 4.5 || !sp.visible)) { this.spawnFar(sp, 16.5 + this.bgRand() * 2, cz); continue; }
      const nx = (sp.position.x - cam.position.x) / (d * ta), ny = (sp.position.y - cam.position.y) / (d * tv);
      if (!lost) {
        if (fire?.[u.cell] && Math.random() < (playing ? .35 : .5)) u.flash = 1;
        u.flash = Math.max(0, u.flash - dt * 2.2);
      }
      const behind = nx > -F.x && nx < F.x && ny > F.y0 && ny < F.y1 ? .45 : 1;  // stay quiet behind the line
      const b = lost ? .4 : ((1.05 + (R ? .2 : .7) * u.flash) * behind) * this.dim + flashAmp * .6;
      sp.material.color.setRGB(.353 * b, .455 * b, .659 * b);
      sp.material.opacity = clamp((d - 4.5) / 1.5, 0, 1);
    }
  }

  // The give-up pop (above the line), the 99+ badge counting on beats, the stuck 99% bar.
  updateSpecials(dt, playing, t, black) {
    const S = this.S, cam = this.camera, F = this.F, tv = this.tanV(), ta = tv * cam.aspect;
    const put = (sp, nx, ny, d, scale = 1) => {
      const u = sp.userData, h = u.frac * 2 * d * tv * scale;
      sp.scale.set(h * u.aspect, h, 1);
      sp.position.set(cam.position.x + nx * d * ta, cam.position.y + ny * d * tv, cam.position.z - d);
    };
    const toNdc = y => 1 - 2 * y / F.H;
    const lvl = (.95 * this.dim + (S.reduced ? 0 : 2.5 * this.dropFlash));
    // pop
    const p = this.pop, pa = p ? this.clock - p.t0 : 9;
    this.popSp.visible = !!p && pa < .96 && playing && !black;
    if (this.popSp.visible) {
      this.special(this.popSp, 'pop:' + p.text, () => mindMid({ kind: 'chip', layer: 'ui', pop: true }, p.text), F.mob ? .034 : .044);
      const s = S.reduced ? 1 : pa < .06 ? .9 + 2.3 * pa : pa < .12 ? 1.04 - .67 * (pa - .06) : 1;
      const hh = this.popSp.userData.frac;
      let ny = toNdc(F.y - F.lh * 1.25) + .035 + hh;
      if (ny + hh > F.top - .02) ny = toNdc(F.y + F.lh * 1.25) - .035 - hh;
      put(this.popSp, [-.1, .12, -.04][p.i] * (F.mob ? .4 : 1), ny, 3, s);
      this.popSp.material.color.setScalar(1.05);
    } else if (pa >= .96) this.pop = null;
    // badge + stuck bar: the build only
    const inBuild = playing && t >= MIND_T.build && !black;
    this.badgeSp.visible = inBuild; this.stuckSp.visible = inBuild && t >= MIND_T.build + MIND_T.beat;
    if (inBuild) {
      const n = ['3', '12', '47', '99+'][Math.min(3, Math.floor((Math.min(t, MIND_T.drop - .01) - MIND_T.build) / MIND_T.beat))];
      this.special(this.badgeSp, 'badge:' + n, () => mindMid({ kind: 'icon', icon: 'badge' }, n), F.mob ? .03 : .036);
      const band = F.top - F.bot;
      put(this.badgeSp, F.mob ? .52 : .56, F.top - band * (F.mob ? .1 : .14), 3.2);
      this.badgeSp.material.color.setScalar(lvl);
      if (this.stuckSp.visible) {
        this.special(this.stuckSp, 'stuck', () => mindMid({ kind: 'icon', pict: 'progress', layer: 'ui' }, 'загрузка 99%'), F.mob ? .03 : .036);
        put(this.stuckSp, F.mob ? -.38 : -.5, F.bot + band * (F.mob ? .08 : .14), 3.2);
        this.stuckSp.material.color.setScalar(lvl * .9);
      }
    }
  }

  updateLinks(dt, lost, tail) {
    this.linkT += dt;
    if (this.linkT < .2) return;
    this.linkT = 0;
    const P = this.linkPos, C = this.linkCol, items = this.items, n = items.length;
    const fade = lost ? .4 : 1 - tail;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = items[i].position, ua = items[i].userData;
      let n1 = -1, n2 = -1, d1 = 1e9, d2 = 1e9;
      for (let j = 0; j < n; j++) {
        if (j === i || !items[j].visible) continue;
        const d = a.distanceToSquared(items[j].position);
        if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = j; } else if (d < d2) { d2 = d; n2 = j; }
      }
      for (let m = 0; m < 2; m++) {
        const j = m ? n2 : n1, dd = m ? d2 : d1, o = k * 6;
        if (j < 0 || !items[i].visible) { P.fill(0, o, o + 6); C.fill(0, o, o + 6); k++; continue; }
        const b = items[j].position, f = Math.max(ua.flash, items[j].userData.flash, ua.pulse || 0);
        const lum = (lost ? .05 : .05 + .45 * f) * clamp(1 - Math.sqrt(dd) / 2.6, 0, 1) * fade * this.dim;
        P[o] = a.x; P[o + 1] = a.y; P[o + 2] = a.z; P[o + 3] = b.x; P[o + 4] = b.y; P[o + 5] = b.z;
        C[o] = C[o + 3] = .5 * lum; C[o + 1] = C[o + 4] = .95 * lum; C[o + 2] = C[o + 5] = .9 * lum;
        k++;
      }
    }
    this.linkGeo.attributes.position.needsUpdate = true;
    this.linkGeo.attributes.color.needsUpdate = true;
  }

  /* ---- DOM slots */
  show(sl, it, glitch = true) {
    if (sl.it === it) return;
    sl.it = it;
    const el = sl.el;
    if (!it) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'mf mf-' + it.kind + (it.under ? ' is-under' : '') + (it.out ? ' is-out' : '') + (it.after ? ' is-after' : '') + (it.typing ? ' is-typing' : '') + (sl.dim ? ' is-dim' : '');
    el.textContent = '';
    el.style.textShadow = '';
    if (it.kind === 'notif' && !it.pict) { const d = document.createElement('i'); d.className = 'mf-dot'; d.style.background = it.dot; el.append(d); }
    const pict = it.pict || (it.kind === 'search' ? 'search' : null);
    if (pict && MIND_PICTS[pict]) el.append(this.pictImg(pict));
    const t = document.createElement('span'); t.className = 'mf-t'; el.append(t);
    let c = null;
    if (it.caret) { c = document.createElement('i'); c.className = 'mf-caret'; el.append(c); }
    if (it.kind === 'dialog') {
      const b = document.createElement('span'); b.className = 'mf-btns';
      const [x, y] = it.btns || ['отмена', 'выйти'];
      const b1 = document.createElement('b'); b1.textContent = x;
      const b2 = document.createElement('b'); b2.textContent = y; if (!it.btns) b2.className = 'off';
      b.append(b1, b2); el.append(b);
    }
    sl.t = t; sl.c = c; sl.n = -1; sl.s = ''; sl.caret = null; sl.sp = 0; sl.letters = null; sl.jit = -1;
    sl.glitch = !glitch || this.S.reduced || it.after ? 0 : 2;
    if (sl.glitch) el.classList.add('is-glitch');
  }
  place(sl, y) { y = Math.round(y); if (sl.y !== y) { sl.y = y; sl.el.style.top = y + 'px'; } }
  tick(sl, now) {
    const it = sl.it;
    if (!it) return;
    const a = Math.max(0, now - it.t0);
    if (it.typing) {
      const n = Math.floor(a / (MIND_T.beat / 2)) % 3;
      if (n !== sl.n) { sl.n = n; sl.t.textContent = MIND_TYPING[n]; }
    } else {
      const full = Math.min(it.text.length, it.cut);
      const n = it.rate ? Math.min(full, (Math.floor(a * it.rate / it.step) + 1) * it.step) : full;
      if (n !== sl.n && !sl.letters) { sl.n = n; sl.t.textContent = n >= it.text.length ? it.text : it.text.slice(0, n); }
      if (sl.c) {
        const on = n < full || Math.floor(a / MIND_T.beat) % 2 === 0;
        if (on !== sl.caret) { sl.caret = on; sl.c.classList.toggle('off', !on); }
      }
    }
    if (sl.glitch > 0 && --sl.glitch === 0) sl.el.classList.remove('is-glitch');
  }
  // The reverb tail: the held line smears (trailing copies spread with the swell), then its letters shake.
  smear(sl, k, now) {
    if (!sl.it || !k) return;
    const sp = Math.round((1 + 2 * k) * 10) / 10;
    if (sp !== sl.sp) {
      sl.sp = sp;
      const c = sl.it.under ? '255,140,194' : '234,252,252';
      sl.el.style.textShadow = `${2 * sp}px ${sp}px 0 rgba(${c},.45), ${4 * sp}px ${2 * sp}px 0 rgba(${c},.25), ${6 * sp}px ${3 * sp}px 0 rgba(${c},.12), 0 0 14px #07051a`;
    }
    if (k > .5 && !this.S.reduced) {
      if (!sl.letters) {
        sl.letters = [];
        sl.t.textContent = '';
        for (const ch of sl.it.text) {
          if (ch === ' ') { sl.t.append(' '); continue; }
          const s = document.createElement('span'); s.className = 'mf-l'; s.textContent = ch; sl.t.append(s); sl.letters.push(s);
        }
      }
      const j = Math.floor(now * 12);
      if (j !== sl.jit) {
        sl.jit = j;
        for (const s of sl.letters) { s.style.left = MIND_JIT[Math.floor(Math.random() * 3)]; s.style.top = MIND_JIT[Math.floor(Math.random() * 3)]; }
      }
    }
  }
  pictImg(name) {
    let url = this.pictUrls.get(name);
    if (!url) {
      const bm = MIND_PICTS[name], c = document.createElement('canvas');
      c.width = bm[0].length; c.height = bm.length;
      mindPict(c.getContext('2d'), bm, 0, 0, 1);
      url = c.toDataURL();
      this.pictUrls.set(name, url);
    }
    const img = document.createElement('img');
    img.className = 'mf-p'; img.alt = ''; img.src = url;
    img.style.setProperty('--r', MIND_PICTS[name].length);
    return img;
  }
}

function mindTex(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/* ---- pixel pictograms: one char per pixel, '.' is empty */
const MIND_PAL = {
  w: '#eafcfc', g: '#6b7a90', d: '#3a4659', r: '#ff3b30', c: '#4fc3f7', b: '#2f6fd6', B: '#7fa6ff',
  G: '#1fa463', k: '#0b1020', t: '#8ff0e6', v: '#8e7dff', y: '#ffcc00',
};
const MIND_PICTS = {
  battery: ['rrrrrrrrrrrrr..', 'r...........r..', 'r.r.........rrr', 'r.r.........rrr', 'r.r.........rrr', 'r...........r..', 'rrrrrrrrrrrrr..'],
  nosignal: ['r.r......dd', '.r.......dd', 'r.r...dd.dd', '......dd.dd', '...dd.dd.dd', '...dd.dd.dd', 'dd.dd.dd.dd', 'dd.dd.dd.dd'],
  voice: (() => {
    const H = [1, 3, 5, 3, 7, 5, 3, 5, 7, 3, 1, 3, 5, 1], rows = Array.from({ length: 7 }, () => Array(6 + H.length * 2).fill('.'));
    for (let y = 0; y < 7; y++) for (let x = 0; x < 4 - Math.abs(y - 3); x++) rows[y][x] = 'w';
    H.forEach((h, i) => { for (let y = 3 - (h >> 1); y <= 3 + (h >> 1); y++) rows[y][6 + i * 2] = 't'; });
    return rows.map(r => r.join(''));
  })(),
  eye: ['....wwwww....', '..ww.....ww..', '.w...ccc...w.', 'w...cckcc...w', '.w...ccc...w.', '..ww.....ww..', '....wwwww....'],
  missed: ['rr.....rrrr', 'rrr.....rrr', 'rrr....r.rr', '.rr...r...r', '.rrr.......', '..rrr...rr.', '...rrrrrrrr', '.....rrrrr.'],
  satellite: ['bbb.......bbb', 'bBb...w...bBb', 'bbbddwwwddbbb', 'bBb..www..bBb', 'bbb...w...bbb', '......w......', '.....www.....'],
  calendar: ['.d......d.', 'rrrrrrrrrr', 'rrrrrrrrrr', 'wwwwwwwwww', 'wwwkkkkwww', 'wwwwwwkwww', 'wwwkkkkwww', 'wwwkwwwwww', 'wwwkkkkwww', 'wwwwwwwwww'],
  progress: ['gggggggggggggggggggggggggggg', 'gttttttttttttttttttttttttt.g', 'gttttttttttttttttttttttttt.g', 'gttttttttttttttttttttttttt.g', 'gggggggggggggggggggggggggggg'],
  code: ['gggggg.gggggg.gggggg.gggggg', 'g....g.g....g.g....g.g....g', 'g.ww.g.g.ww.g.g.t..g.g....g', 'g.ww.g.g.ww.g.g.t..g.g....g', 'g.ww.g.g.ww.g.g.t..g.g....g', 'g....g.g....g.g....g.g....g', 'gggggg.gggggg.gggggg.gggggg'],
  alarm: ['rr.......rr', 'r..wwwww..r', '..w.....w..', '.w...w...w.', '.w...w...w.', '.w...www.w.', '.w.......w.', '..w.....w..', '...wwwww...', '..w.....w..'],
  plane: ['.....w.....', '....www....', '....www....', '.wwwwwwwww.', 'ww..www..ww', '....www....', '.....w.....', '...wwwww...'],
  candles: ['.G.......r...', 'GGG......r...', 'GGG.r...rrr..', 'GGG.r...rrr.G', '.G.rrr..rrr.G', '...rrr...r.GG', '...rrr.G...GG', '....r.GGG..GG', '......GGG...G', '.......G.....'],
  stamp: ['...vvvvv...', '..v.....v..', '.v..vvv..v.', 'v..v...v..v', 'v.v.....v.v', 'v.v.....v.v', 'v.v.....v.v', 'v..v...v..v', '.v..vvv..v.', '..v.....v..', '...vvvvv...'],
  search: ['.wwww...', 'w....w..', 'w....w..', 'w....w..', 'w....w..', '.wwwww..', '.....ww.', '......ww'],
  read: ['.........c....c', '........c....c.', 'c......c....c..', '.c....c....c...', '..c..c.c..c....', '...cc...cc.....'],
};
function mindPict(g, bm, x, y, p) {
  for (let r = 0; r < bm.length; r++) for (let q = 0; q < bm[r].length; q++) {
    const ch = bm[r][q];
    if (ch === '.') continue;
    g.fillStyle = MIND_PAL[ch] || '#fff';
    g.fillRect(x + q * p, y + r * p, p, p);
  }
}

// A MID shard: the entry drawn as its interface shape. Base unit U = 2 canvas px; a chip is 42 px tall.
function mindMid(e, text) {
  const U = 2, FS = 13 * U, c = document.createElement('canvas'), g = c.getContext('2d');
  const kind = e?.kind || 'line', layer = e?.layer || 'city', under = layer === 'under';
  const font = `600 ${FS}px ${MIND_FONT}`, small = `600 ${10 * U}px ${MIND_FONT}`;
  g.font = font;
  const tw = text ? Math.ceil(g.measureText(text).width) : 0;
  const pictName = e?.pict || (kind === 'search' ? 'search' : null), bm = pictName ? MIND_PICTS[pictName] : null;
  const pp = 3, pw = bm ? bm[0].length * pp : 0, ph = bm ? bm.length * pp : 0, gap = bm && text ? 7 * U : 0;
  const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  const label = (x, y, col) => { g.font = font; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(text, x, y); };
  const txt = e?.pop ? '#eafcfc' : MIND_TXT[layer] || '#eafcfc';
  if (e?.icon === 'badge') {
    g.font = `700 ${14 * U}px ${MIND_FONT}`;
    const w = Math.max(21 * U, Math.ceil(g.measureText(text).width) + 14 * U);
    c.width = w; c.height = 21 * U;
    g.fillStyle = '#ff3b30'; round(0, 0, w, c.height, c.height / 2); g.fill();
    g.font = `700 ${14 * U}px ${MIND_FONT}`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, c.height / 2 + U);
  } else if (e?.icon === 'read') {
    const b = MIND_PICTS.read; c.width = b[0].length * 4 + 8; c.height = b.length * 4 + 8; mindPict(g, b, 4, 4, 4);
  } else if (e?.icon === 'captcha') {
    g.font = `600 ${12 * U}px ${MIND_FONT}`;
    c.width = Math.ceil(g.measureText('я не робот').width) + 40 * U; c.height = 26 * U;
    g.fillStyle = '#eef2f5'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#9aa7b3'; g.lineWidth = U; g.strokeRect(U / 2, U / 2, c.width - U, c.height - U);
    g.fillStyle = '#fff'; g.fillRect(6 * U, 6 * U, 14 * U, 14 * U); g.strokeStyle = '#6b7a88'; g.strokeRect(6.5 * U, 6.5 * U, 13 * U, 13 * U);
    g.fillStyle = '#1fa463';
    for (let i = 0; i < 4; i++) g.fillRect(9 * U + i * U, 12 * U + i * U, 2 * U, 2 * U);
    for (let i = 0; i < 7; i++) g.fillRect(12 * U + i * U, 15 * U - i * U, 2 * U, 2 * U);
    g.font = `600 ${12 * U}px ${MIND_FONT}`; g.fillStyle = '#26323d'; g.textBaseline = 'middle'; g.fillText('я не робот', 26 * U, 13.5 * U);
  } else if (kind === 'icon') {                          // «загрузка 99%»: text over a bar that stops one pixel short
    c.width = Math.max(tw, pw) + 16 * U; c.height = 36 * U;
    g.fillStyle = 'rgba(8,12,26,.8)'; round(0, 0, c.width, c.height, 5 * U); g.fill();
    label(8 * U, 12 * U, txt);
    if (bm) { const s = Math.floor((c.width - 16 * U) / bm[0].length); mindPict(g, bm, 8 * U, 21 * U, s); }
  } else if (kind === 'dialog') {
    g.font = small;
    const [b1, b2] = e.btns || ['отмена', 'выйти'];
    const bw = Math.ceil(g.measureText(b1).width + g.measureText(b2).width) + 14 * U;
    c.width = Math.max(tw, bw) + 22 * U; c.height = 46 * U;
    g.fillStyle = '#141c2f'; round(U, U, c.width - 2 * U, c.height - 2 * U, 6 * U); g.fill();
    g.strokeStyle = under ? '#8a4b70' : '#34425c'; g.lineWidth = U; g.stroke();
    label(11 * U, 15 * U, txt);
    g.font = small; g.textBaseline = 'middle'; g.textAlign = 'right';
    g.fillStyle = e.btns ? '#4fc3f7' : '#566079'; g.fillText(b2, c.width - 11 * U, 34 * U);
    g.fillStyle = '#4fc3f7'; g.fillText(b1, c.width - 11 * U - g.measureText(b2).width - 14 * U, 34 * U);
  } else if (kind === 'notif') {
    const lead = bm ? pw : 7 * U;
    c.width = 9 * U + lead + 7 * U + tw + 11 * U; c.height = 28 * U;
    g.fillStyle = '#121a2c'; round(U, U, c.width - 2 * U, c.height - 2 * U, 7 * U); g.fill();
    g.strokeStyle = '#2c3a52'; g.lineWidth = U; g.stroke();
    if (bm) mindPict(g, bm, 9 * U, (c.height - ph) / 2, pp);
    else { g.fillStyle = MIND_DOTS[mindCell(text) % MIND_DOTS.length]; round(9 * U, c.height / 2 - 3.5 * U, 7 * U, 7 * U, 2 * U); g.fill(); }
    label(9 * U + lead + 7 * U, c.height / 2 + U, txt);
  } else if (kind === 'bubble') {
    const out = !!e.out;
    c.width = tw + pw + gap + 20 * U; c.height = 24 * U;
    g.fillStyle = out ? '#2f6fd6' : '#262f42';
    round(U, U, c.width - 2 * U, c.height - 2 * U, out ? [9 * U, 9 * U, 2 * U, 9 * U] : [9 * U, 9 * U, 9 * U, 2 * U]); g.fill();
    if (bm) mindPict(g, bm, 10 * U, (c.height - ph) / 2, pp);
    label(10 * U + pw + gap, c.height / 2 + U, out ? '#ffffff' : '#e6eef7');
  } else if (kind === 'chip' || kind === 'search') {
    c.width = tw + pw + gap + 22 * U + (kind === 'search' ? 5 * U : 0); c.height = 21 * U;
    g.fillStyle = e?.pop ? '#0d1a2c' : '#0b1428'; round(U, U, c.width - 2 * U, c.height - 2 * U, c.height / 2); g.fill();
    g.strokeStyle = e?.pop ? '#80e8de' : under ? '#b0588a' : layer === 'ui' ? '#4a7c9c' : '#3d5a7a'; g.lineWidth = 2 * U; g.stroke();
    if (bm) mindPict(g, bm, 11 * U, (c.height - ph) / 2, pp);
    label(11 * U + pw + gap, c.height / 2 + U, txt);
    if (kind === 'search') { g.fillStyle = '#8ff0e6'; g.fillRect(11 * U + pw + gap + tw + 2 * U, 5 * U, U * 1.5, 11 * U); }
  } else {                                               // a plain line of thought
    c.width = tw + pw + gap + 8 * U; c.height = 20 * U;
    g.fillStyle = 'rgba(4,6,18,.55)'; g.fillRect(0, 2 * U, c.width, c.height - 4 * U);
    if (bm) mindPict(g, bm, 4 * U, (c.height - ph) / 2, pp);
    label(4 * U + pw + gap, c.height / 2 + U, txt);
  }
  return c;
}
