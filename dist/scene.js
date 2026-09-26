import * as THREE from './assets/three.module.js?v=6';
import { createFly, FOOT_Y } from './fly.js?v=6';
import { THOUGHTS } from './thoughts.js?v=6';

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
      if (S.state === 'lost' && !S.poster && Math.random() < dt * .35) S.glitch(.3);
      post.uniforms.glitch.value = Math.max(0, post.uniforms.glitch.value - dt * 1.6);
      post.uniforms.fade.value = cam.fade;
      post.uniforms.inside.value = cam.inside;

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

function createPost(target) {
  const uniforms = {
    map: { value: target.texture }, res: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 }, glitch: { value: 0 }, fade: { value: 1 }, inside: { value: 0 },
    levels: { value: 12 }, exposure: { value: 1.3 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec2 res; uniform float time, glitch, fade, inside, levels, exposure;
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
        vec2 q=vUv*2.-1.;
        c*=1.-.22*dot(q,q);
        if(inside>0.){
          vec2 h=gl_FragCoord.xy/vec2(5.,4.4);
          h.x+=mod(floor(h.y),2.)*.5;
          vec2 f=fract(h)-.5;
          c*=1.-inside*.22*smoothstep(.2,.52,length(f*vec2(1.,1.15)));
          q.x*=res.x/res.y;
          float rr=length(q)/min(1.,res.x/res.y);
          c*=mix(1.,smoothstep(1.45,1.18,rr),inside);
        }
        c=floor(c*levels+b4(gl_FragCoord.xy))/levels;
        gl_FragColor=vec4(c*fade,1.);
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
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

  return {
    update(t, glow, S) {
      const e = S.env || {}, on = S.state === 'playing';
      screenLight.intensity = 5 + glow * 5 + (on ? (e.low || 0) * 4 : Math.sin(t * 7) * .3);
      pink.intensity = 30 + (on ? (e.mid || 0) * 14 : 0);
      teal.intensity = 16 + (on ? (e.high || 0) * 10 : 0);
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
  let lastKey = '', acc = 0;
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
    g.fillText(live ? 'Слушайте' : (S.countdownShort || '').replace('д', ' д'), 28, 61);
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
      const q = Math.round(near * 10);
      const key = `${touch}|${S.live}|${S.countdownShort}|${coverReady}|${fontReady}|${q}`;
      if (api.dirty || (key !== lastKey && acc > .08)) {
        paint(touch, near); api.dirty = false; lastKey = key; acc = 0;
      }
    },
  };
  return api;
}

function mix(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1)).getHexString(); }

/* ---------------------------------------------------------------- rain & city */

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
    uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec4 seed; attribute vec3 color; uniform float time; varying vec3 vColor; varying float vA;
      void main(){
        vec3 p=position;
        p.y+=mod(seed.y*1.3-time*seed.x,16.)-.4;
        vColor=color; vA=smoothstep(-.4,.6,p.y)*(.25+.2*fract(seed.y));
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,
    fragmentShader: 'varying vec3 vColor;varying float vA;void main(){gl_FragColor=vec4(vColor,vA);}',
  });
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
  for (const [name, color] of [['pink', '#ff4f9a'], ['teal', '#3fe0d4']]) {
    if (!edges[name].length) continue;
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edges[name], 3));
    scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .45 })));
  }
  let acc = 0;
  return {
    update(dt, S) {
      acc += dt;
      if (acc < (S.state === 'playing' ? .15 - (S.env?.high || 0) * .11 : .15)) return;
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
      F.localToWorld(eye.set(.72, .2, .3));
      F.localToWorld(eyeLook.set(1.6, .05, .1));
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

// Damped spring: every animated channel goes through one, which gives slow-in/out,
// overshoot and settle for free. Different stiffness per part = overlapping action.
class Spring {
  constructor(k, zeta, x = 0) { this.k = k; this.d = 2 * zeta * Math.sqrt(k); this.x = x; this.v = 0; }
  to(target, dt) {
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (this.k * (target - this.x) - this.d * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}

const BEAT = 60 / 125, BAR = BEAT * 4;
const jab = p => Math.min(1, p * 22) * Math.exp(-p * 7); // quick poke, soft return; p = phase 0..1
const pulse = (t, at, len) => (t >= at && t < at + len ? Math.sin(Math.PI * (t - at) / len) : 0);

function createFlyAnimator(fly, screen, S) {
  const R1 = fly.legs.Rfore, L1 = fly.legs.Lfore;
  const body = fly.body, head = fly.head, F = fly.group;
  const sp = {
    reach: new Spring(110, .55), groom: new Spring(26, 1, 1), lean: new Spring(55, .78), rise: new Spring(55, .78),
    pitch: new Spring(55, .78), roll: new Spring(45, .7), look: new Spring(30, 1), hPitch: new Spring(170, .62),
    hRoll: new Spring(120, .6), hYaw: new Spring(170, .62), abd: new Spring(26, .42), wing: new Spring(160, .42),
    buzz: new Spring(40, 1), ant: new Spring(240, .3), stretch: new Spring(240, .32, 1), lift: new Spring(120, .6),
    push: new Spring(6, 1), glow: new Spring(20, 1), step: new Spring(14, .9),
  };
  const out = { touch: false, near: 0, push: 0, shake: 0, tail: 0 };
  // Feet are anchored in the world; when the fly shifts, they re-plant one at a time.
  const base = F.position.clone(), fwd = V(Math.cos(F.rotation.y), 0, -Math.sin(F.rotation.y));
  const walkers = ['Lmid', 'Rhind', 'Rmid', 'Lhind', 'Lfore'].map((k, i) => ({ leg: fly.legs[k], world: null, step: null, order: i }));
  let lastStepAt = -1;
  let idleT = 0, animT = 0, lastState = '', stateT = 0, prevBar = -9, dropHit = false;
  const btnRoot = V(), almost = V(), toBtn = V(), pressAt = V(), tmp = V(), tipW = V();
  const restR = R1.restTip.clone(), cock = V(-.18, .42, -.06);
  const gR = V(), gL = V(), groomDirR = V(.25, -.25, -1).normalize(), groomDirL = V(.25, -.25, 1).normalize();

  function goals() {
    const st = S.state, t = S.t || 0, cut = S.cut || 16.32, drop = cut - BEAT;
    const G = { reach: 0, groom: 0, lean: 0, rise: 0, pitch: 0, roll: 0, look: 0, hPitch: 0, hRoll: 0, abd: 0, wing: 0, buzz: 0, stretch: 1, lift: 0, push: 0, glow: 0, ts: 1, step: 0 };
    const stretchPose = () => Object.assign(G, { reach: 1, lean: .17, pitch: .15, rise: .15, abd: -.14, stretch: 1.06, wing: .45, look: 1, hPitch: .12 });
    if (st === 'playing' || (st === 'paused' && t > 0)) {
      const b = (t - BEAT) / BAR, beatP = (t / BEAT) % 1, eighthP = (t / (BEAT / 2)) % 1;
      G.look = 1; G.push = .1 * smooth(clamp(t / cut, 0, 1));
      if (t < BEAT) { G.rise = -.035; G.pitch = -.03; }                                  // startle: a dip before rising
      else if (b < 1) { G.rise = .05; G.lean = .02; G.reach = .06; G.hPitch = .05; }       // attention
      else if (b < 4) {                                                                    // three attempts, one per bar
        const k = Math.floor(b), p = b - k, A = [.46, .64, .8][k - 1];
        const up = { lean: .05 + .025 * k, pitch: .05 + .025 * k, rise: .04 + .02 * k, hPitch: .07 };
        if (p < .16) Object.assign(G, { reach: -.16, lean: -.05, pitch: -.05, rise: .03, stretch: .965 });   // anticipation
        else if (p < .55) Object.assign(G, up, { reach: A, stretch: 1.025 });                               // the reach
        else if (p < .78) Object.assign(G, up, { reach: A + .045 * jab(beatP) });                            // strain
        else Object.assign(G, { reach: A * .5, lean: .01, rise: .02, hPitch: -.08, hRoll: k % 2 ? .1 : -.1 }); // falls back, disappointed
      } else if (b < 6) {                                                                  // sustained pawing on the beat
        const s = (b - 4) / 2;
        Object.assign(G, { reach: .84 + .07 * s + .05 * jab(beatP), lean: .12, pitch: .11, rise: .1, abd: -.05, buzz: .05, lift: .05 * jab((beatP + .5) % 1), hPitch: .08 });
      } else if (t < drop) {                                                               // the build: eighths, tiptoes, wings tremble
        const s = clamp((b - 6) / 2, 0, 1);
        Object.assign(G, { reach: .92 + .05 * s + .03 * jab(eighthP), lean: .14, pitch: .12, rise: .13, abd: -.1, buzz: .12 + .25 * s, stretch: 1.02, hPitch: .1, lift: .04 * jab(eighthP) });
      } else {                                                                             // the drop, then the reverb tail in slow motion
        stretchPose(); G.buzz = .45; G.push = .14;
        if (t > cut) { const k = clamp((t - cut) / Math.max(.1, (S.dur || 18.5) - cut), 0, 1); G.ts = .12; G.push = .14 + .08 * k; G.glow = k; }
      }
      if (b >= 4) G.step = .09;
      if (st === 'paused') G.ts = 0;
    } else if (st === 'lost' || S.poster) {
      stretchPose(); G.push = .16; G.ts = 0; G.step = .09;
    } else if (st === 'pressed') {                                                         // someone pressed for it
      const p = stateT;
      G.look = 1;
      if (p < .35) Object.assign(G, { reach: .85, lean: .1, pitch: .08, rise: .08, stretch: .97 });
      else if (p < 1.5) Object.assign(G, { reach: 1.15, lean: .16, pitch: .14, rise: .13, stretch: 1.04 });
      else if (p < 2.4) Object.assign(G, { reach: .2, groom: .4, buzz: .18, rise: .04 });
      else Object.assign(G, { groom: 1, buzz: p < 3.2 ? .1 : 0, look: 0, hPitch: -.08 });   // rubs its paws, pleased
    } else {                                                                               // idle: grooming, glances at the screen
      const c = idleT % 9.2;
      if (c < 3.6 || c >= 6) Object.assign(G, { groom: 1, hPitch: -.1 });
      else Object.assign(G, { look: 1, rise: .025, lean: .02, hPitch: .04 });
      if (c > 5.3 && c < 6.1) G.roll = .05 * Math.sin((c - 5.3) / .8 * Math.PI);
      G.wing = .32 * pulse(c, 7.1, .5);
    }
    return G;
  }

  let settle = 0;
  out.update = (dt, worldT) => {
    if (S.state !== lastState) {
      // Entering a frozen pose without playing into it (a preview link, the poster, a reload):
      // let the springs settle for a moment instead of freezing at rest.
      if ((S.state === 'lost' || S.poster) && lastState !== 'playing') settle = 1.6;
      lastState = S.state; stateT = 0;
      if (S.state === 'playing') sp.ant.v += 9;
    }
    stateT += dt;
    const G = goals();
    if (settle > 0) { settle -= dt; G.ts = 1; }
    const sdt = dt * G.ts;
    animT += sdt;
    if (!['playing', 'paused', 'lost'].includes(S.state)) idleT += sdt;
    // Antennae twitch on every new bar, and when the fly glances up.
    const bar = Math.floor(((S.t || 0) - BEAT) / BAR);
    if (S.state === 'playing' && bar !== prevBar) { sp.ant.v += 7; prevBar = bar; }
    if (S.state === 'idle' && Math.abs((idleT % 9.2) - 3.65) < sdt) sp.ant.v += 10;
    // The drop kicks the springs: stretch, wing flare, abdomen whip, camera shake.
    const inDrop = S.state === 'playing' && S.t > (S.cut || 16.32) - BEAT;
    if (inDrop && !dropHit) { dropHit = true; sp.stretch.v += 1.2; sp.wing.v += 4; sp.abd.v -= 1.5; out.shake = 1; }
    if (!inDrop && S.state === 'playing') dropHit = false;

    const reach = sp.reach.to(G.reach, sdt), groom = sp.groom.to(G.groom, sdt), look = sp.look.to(G.look, sdt);
    body.position.set(sp.lean.to(G.lean, sdt), sp.rise.to(G.rise, sdt), 0);
    body.rotation.set(sp.roll.to(G.roll, sdt), 0, sp.pitch.to(G.pitch, sdt));
    const str = sp.stretch.to(G.stretch, sdt), thin = 1 / Math.sqrt(str);
    body.scale.set(str, thin, thin);
    body.updateMatrix();
    F.position.copy(base).addScaledVector(fwd, sp.step.to(G.step, sdt) * FLY_SCALE);
    F.updateMatrixWorld();

    // The button in fly space; the target stops short of the pill by the gap.
    // Every replay the gap shrinks, never to zero.
    F.updateMatrixWorld();
    btnRoot.copy(screen.buttonWorld); F.worldToLocal(btnRoot);
    const gapW = Math.max(.045, .18 * Math.pow(.62, S.replays || 0));
    tmp.copy(screen.buttonWorld).add(V(-screen.buttonHalfW - gapW, -.02, .03));
    almost.copy(tmp); F.worldToLocal(almost);
    toBtn.copy(btnRoot).sub(almost).normalize();
    pressAt.copy(btnRoot).addScaledVector(toBtn, -.06);

    // Right foreleg: rest → cock back (reach < 0) → arc to "almost" → press (reach > 1).
    const tip = R1.tip, dir = R1.dir;
    if (reach < 0) { tip.copy(restR).addScaledVector(cock, -reach / .16); dir.copy(R1.restDir); }
    else if (reach <= 1) {
      tip.lerpVectors(restR, almost, reach);
      tip.y += Math.sin(Math.PI * reach) * .3;
      dir.copy(R1.restDir).lerp(toBtn, smooth(clamp(reach * 1.4, 0, 1))).normalize();
    } else { tip.lerpVectors(almost, pressAt, clamp((reach - 1) / .15, 0, 1)); dir.copy(toBtn); }
    // Strain only at full stretch, not a constant tremble.
    const strain = clamp((reach - .85) / .15, 0, 1) * (S.state === 'lost' || S.poster ? 0 : 1) * (S.reduced ? .3 : 1);
    tip.y += Math.sin(animT * 31) * .006 * strain; tip.x += Math.sin(animT * 23 + 1) * .005 * strain;

    // Grooming: forelegs rub each other in front of the mouthparts, well below the eyes.
    const w = animT * 20, rub = Math.sin(w), rub2 = Math.cos(w);
    gR.set(1.04 + rub * .06, -.52 + rub2 * .03, .05); gL.set(1.04 - rub * .06, -.52 - rub2 * .03, -.05);
    tip.lerp(gR, groom); dir.lerp(groomDirR, groom).normalize();
    const lift = sp.lift.to(G.lift, sdt);
    for (const wk of walkers) {
      const want = F.localToWorld(wk.leg.restTip.clone());
      if (!wk.world) wk.world = want.clone();
      if (wk.step) {
        wk.step.t += sdt / .22;
        const e = smooth(Math.min(1, wk.step.t));
        wk.world.lerpVectors(wk.step.from, want, e);
        wk.world.y += Math.sin(Math.PI * e) * .14;
        if (wk.step.t >= 1) { wk.step = null; wk.world.copy(want); }
      } else if (wk.world.distanceTo(want) > .05 && animT - lastStepAt > .07 && walkers.filter(w => w.step).length < 2) {
        wk.step = { from: wk.world.clone(), t: 0 }; lastStepAt = animT;
      }
      wk.leg.tip.copy(wk.world); F.worldToLocal(wk.leg.tip);
    }
    L1.tip.y += lift;
    L1.tip.lerp(gL, groom); L1.dir.copy(L1.restDir).lerp(groomDirL, groom).normalize();
    fly.solveLegs();

    // Head leads: looks at the button, nods on the kick, tilts when it fails.
    const dx = btnRoot.x - head.position.x - body.position.x, dy = btnRoot.y - head.position.y - body.position.y, dz = btnRoot.z - head.position.z;
    const yaw = Math.atan2(-dz, dx), pit = Math.atan2(dy, Math.hypot(dx, dz)) - sp.pitch.x;
    const kick = S.state === 'playing' ? (S.env?.low || 0) * .08 : 0;
    head.rotation.set(sp.hRoll.to(G.hRoll, sdt), sp.hYaw.to(yaw * look, sdt), sp.hPitch.to(G.hPitch + pit * look * .6 - kick, sdt));
    const ant = sp.ant.to(0, sdt);
    fly.antennae.forEach((a, i) => { a.rotation.z = ant * .05 + Math.sin(animT * 3 + i * 2) * .04; });

    // Abdomen lags and counterbalances; breathes on its own clock.
    fly.abdomen.rotation.z = .14 + sp.abd.to(G.abd, sdt) - sp.pitch.x * .4;
    const br = 1 + Math.sin(animT * 2.3) * .035;
    fly.belly.scale.set(1, br, br);
    // Wings open with effort and buzz on the build and the drop.
    const open = sp.wing.to(G.wing, sdt), buzz = sp.buzz.to(G.buzz, sdt);
    fly.wings.forEach(({ pivot, side }) => {
      pivot.rotation.y = side * open * (side > 0 ? 1 : .3);
      pivot.rotation.x = side * buzz * Math.sin(worldT * 55 + side * 1.3) * .6;
    });

    // Feedback for the screen glow, the camera and the post-process.
    tipW.copy(R1.reached); F.localToWorld(tipW);
    const bw = screen.buttonWorld;
    const dist = Math.hypot(Math.max(0, bw.x - screen.buttonHalfW - tipW.x), (tipW.y - bw.y) * 1.2, (tipW.z - SCREEN_Z) * 2);
    out.near = clamp(1 - dist / .5, 0, 1);
    out.touch = S.state === 'pressed' && reach > 1.08;
    out.push = sp.push.to(G.push, dt);
    out.tail = sp.glow.to(G.glow, dt);
    out.shake = Math.max(0, out.shake - dt * 2.5);
  };
  return out;
}

/* ---------------------------------------------------------------- inside the head */

class Mind {
  constructor(S) {
    this.S = S;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#07051a');
    this.scene.fog = new THREE.Fog('#07051a', 3, 14);
    this.camera = new THREE.PerspectiveCamera(62, 1, .05, 60);
    this.items = [];
    this.built = false;
    this.lastThought = 0;
  }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  async build() {
    this.built = true;
    // Load every glyph the thoughts use (Latin 'GPS', 'DOOM', digits, '?' live in other unicode-range subsets).
    const sample = THOUGHTS.map(t => t.text || '').join(' ') + ' я не робот 99+ 0123456789';
    await Promise.all(['600 48px Geologica', '700 54px Geologica'].map(f => document.fonts?.load(f, sample))).catch(() => {});
    const copies = 2;
    let n = 0;
    for (let c = 0; c < copies; c++) for (const th of THOUGHTS) {
      const tex = thoughtTexture(th, c);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true });
      const sp = new THREE.Sprite(mat);
      const hWorld = th.icon ? .36 : .26;
      sp.scale.set(hWorld * tex.image.width / tex.image.height, hWorld, 1);
      sp.userData = { th, cell: (n * 37) % 96, flash: 0, spin: (n % 2 ? 1 : -1) * (.05 + (n % 5) * .02) };
      this.place(sp, -2 - (n / (copies * THOUGHTS.length)) * 18);
      this.scene.add(sp);
      this.items.push(sp);
      n++;
    }
    // Faint links between neighbouring thoughts: a connectome-ish web.
    this.linkGeo = new THREE.BufferGeometry();
    this.linkPos = new Float32Array(this.items.length * 2 * 6);
    this.linkCol = new Float32Array(this.items.length * 2 * 6);
    this.linkGeo.setAttribute('position', new THREE.BufferAttribute(this.linkPos, 3));
    this.linkGeo.setAttribute('color', new THREE.BufferAttribute(this.linkCol, 3));
    const links = new THREE.LineSegments(this.linkGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .5, fog: true }));
    links.frustumCulled = false;
    this.scene.add(links);
    // Dust: tiny neurons in the dark.
    const D = 420, dp = new Float32Array(D * 3);
    for (let i = 0; i < D; i++) { const a = Math.random() * 6.28, r = .5 + Math.random() * 4; dp.set([Math.cos(a) * r, Math.sin(a) * r, -Math.random() * 30], i * 3); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#4a6fa8', size: 1.5, sizeAttenuation: false, fog: true }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }
  place(sp, z) {
    const a = Math.random() * Math.PI * 2, r = 1.1 + Math.random() * 1.2;
    sp.position.set(Math.cos(a) * r * 1.5, Math.sin(a) * r * .8, z);
    sp.userData.a = a; sp.userData.r = r;
  }
  enter() { if (!this.built) this.build(); this.camera.position.set(0, 0, 2); this.S.glitch?.(.6); }
  leave() { this.S.glitch?.(.5); }
  update(dt, t) {
    const S = this.S, cam = this.camera;
    const e = S.env || { low: 0, mid: 0, high: 0 };
    const lost = S.state === 'lost';
    const speed = lost ? .03 : .38 + (S.state === 'playing' ? (e.low * .8 + e.mid * .4) : 0);
    cam.position.z -= speed * dt;
    if (!this.items.length) return;
    let best = null;
    this.items.forEach(sp => {
      const u = sp.userData;
      if (sp.position.z > cam.position.z + .6) this.place(sp, cam.position.z - 17 - Math.random() * 3);
      if (!lost) {
        u.a += u.spin * dt * .2;
        sp.position.x = Math.cos(u.a) * u.r * 1.5; sp.position.y = Math.sin(u.a) * u.r * .8;
      }
      const fire = S.fire?.[u.cell] && Math.random() < (S.state === 'playing' ? .35 : .5);
      if (fire && !lost) u.flash = 1;
      u.flash = Math.max(0, u.flash - dt * 1.8);
      const b = lost ? .3 : .78 + .6 * u.flash;
      sp.material.color.setScalar(b);
      if (u.flash > .9 && !u.th.icon && sp.position.z < cam.position.z - 1 && (!best || u.flash > best.userData.flash)) best = sp;
    });
    if (best && t - this.lastThought > 1.2) { this.lastThought = t; S.onThought?.(best.userData.th.text); }
    // Rebuild the link web: each thought connects to its two nearest neighbours.
    this.linkT = (this.linkT || 0) + dt;
    if (this.linkT > .2) {
      this.linkT = 0;
      const P = this.linkPos, C = this.linkCol, items = this.items;
      let k = 0;
      for (let i = 0; i < items.length; i++) {
        const a = items[i].position;
        let n1 = -1, n2 = -1, d1 = 1e9, d2 = 1e9;
        for (let j = 0; j < items.length; j++) {
          if (j === i) continue;
          const d = a.distanceToSquared(items[j].position);
          if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = j; } else if (d < d2) { d2 = d; n2 = j; }
        }
        for (const [j, dd] of [[n1, d1], [n2, d2]]) {
          const b = items[j].position, f = Math.max(items[i].userData.flash, items[j].userData.flash);
          const near = clamp(1 - Math.sqrt(dd) / 2.2, 0, 1);
          P.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
          const lum = (lost ? .05 : .06 + .5 * f) * near;
          C.set([.5 * lum, .95 * lum, .9 * lum, .5 * lum, .95 * lum, .9 * lum], k * 6);
          k++;
        }
      }
      this.linkGeo.attributes.position.needsUpdate = true;
      this.linkGeo.attributes.color.needsUpdate = true;
    }
    this.dust.position.z = Math.ceil(cam.position.z / 30) * 30; // dust spans [z-30, z]
  }
}

function thoughtTexture(th, variant) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (th.icon) drawIcon(c, g, th.icon);
  else {
    // Drawn at 3x (48px) so the sprite minifies cleanly through the pixel pass.
    const K = 3, font = `600 ${16 * K}px Geologica, "Helvetica Neue", Arial, sans-serif`;
    g.font = font;
    const w = Math.ceil(g.measureText(th.text).width);
    const chip = (variant + th.text.length) % 3 === 0;
    c.width = w + (chip ? 20 : 8) * K; c.height = (chip ? 28 : 22) * K;
    g.font = font; g.textBaseline = 'middle';
    if (chip) {
      g.fillStyle = '#0f1830'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = '#4a6c8c'; g.lineWidth = 2 * K; g.strokeRect(K, K, c.width - 2 * K, c.height - 2 * K);
    } else {
      g.fillStyle = 'rgba(4,6,18,.55)'; g.fillRect(0, 2 * K, c.width, c.height - 4 * K);
    }
    const palette = ['#eafcfc', '#8ff0e6', '#ff8cc2', '#c8d2ff'];
    g.fillStyle = palette[(variant * 3 + th.text.length) % palette.length];
    g.fillText(th.text, (chip ? 10 : 4) * K, c.height / 2 + K);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = th.icon ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function drawIcon(c, g, icon) {
  const font = '600 16px Geologica, sans-serif';
  if (icon === 'read') {
    // Double check mark, the "прочитано" ticks.
    c.width = 60; c.height = 36;
    g.fillStyle = '#4fc3f7';
    const tick = ox => { for (let i = 0; i < 8; i++) g.fillRect(ox + i, 16 + i, 4, 4); for (let i = 0; i < 16; i++) g.fillRect(ox + 8 + i, 22 - i, 4, 4); };
    tick(4); tick(20);
  } else if (icon === 'captcha') {
    c.width = 208; c.height = 52;
    g.fillStyle = '#eef2f5'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#9aa7b3'; g.lineWidth = 2; g.strokeRect(1, 1, c.width - 2, c.height - 2);
    g.fillStyle = '#ffffff'; g.fillRect(12, 12, 28, 28);
    g.strokeStyle = '#6b7a88'; g.strokeRect(13, 13, 26, 26);
    g.fillStyle = '#1fa463';
    for (let i = 0; i < 6; i++) g.fillRect(17 + i, 24 + i, 4, 4);
    for (let i = 0; i < 13; i++) g.fillRect(23 + i, 29 - i, 4, 4);
    g.fillStyle = '#26323d'; g.font = font; g.textBaseline = 'middle';
    g.fillText('я не робот', 52, 27);
  } else if (icon === 'badge') {
    c.width = 68; c.height = 36;
    g.fillStyle = '#ff3b30';
    g.fillRect(6, 0, 56, 36); g.fillRect(0, 6, 68, 24); g.fillRect(2, 2, 64, 32);
    g.fillStyle = '#ffffff'; g.font = '700 18px Geologica, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText('99+', 34, 19);
  }
}
