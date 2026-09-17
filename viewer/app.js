/* Time-lapse viewer for a robot learning to cross a room among people.
   Plays back trajectories exported from SocNavGym (see ../SCHEMA.md). */
'use strict';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
  playbackSpeed: 1.0,          // 1 = real time
  holdEndSeconds: 2.0,         // pause on the last frame before moving on
  // Text shown to visitors (French; \u00a0 = non-breaking space before "!")
  outcomeText: { collision: 'Collision\u00a0!', timeout: 'Temps écoulé', success: 'Réussi\u00a0!' },
  // Outcomes shown as another one on screen (the data keeps the difference)
  outcomeDisplayAs: { too_close: 'success' },
  // Rigged people (Quaternius, CC0, see ../ASSETS.md), one per person, picked by room and id.
  // Value: the material whose colour varies per person (null keeps the model's own colours).
  humanModels: {
    Man_Casual_2: 'Red_Dark', Woman_Casual: 'Orange', Man_Suit: null, Woman_Formal: 'Red',
    Man_Casual_Hoodie: 'Purple', Woman_Suit: null, Man_Worker: null, Woman_Adventurer: 'Green',
    Man_Adventurer: 'Green', Woman_Worker: null,
  },
  idleClip: 'Idle_Neutral',     // falls back to 'Idle'
  humanHeight: 1.7,            // metres
  // Display only: people whose centres come closer than this are nudged apart on screen so the
  // character models do not pass through each other. The recorded data is not changed.
  humanVisualSeparation: 0.5,  // metres, 0 disables
  liveGoalMargin: 0.4,         // how close to the walls a visitor may place the goal, metres
  // Live room (world.js): the simulation runs without end at the checkpoint on the slider.
  world: {
    minGoalDistance: 5,        // metres between the robot and each new goal it gets
    collisionPause: 1.5,       // seconds the robot stays put after a collision, before reappearing
    outcomeSeconds: 2,         // how long "Réussi !", "Collision !" or "Temps écoulé" stays on screen
    movesPerFrame: 27,         // moves scored per frame while the robot thinks (81 per decision)
  },
  decorativeWalls: true,       // draw walls around rooms that have none in the simulation (display only)
  // "Options" fan: every move the robot scored at this step, drawn on the floor in front of it.
  // Direction = the move's turn, distance = its speed (exaggerated so it is visible).
  options: {
    showByDefault: true,
    reach: 1.4,                  // metres from the robot's edge for the fastest move
    gap: 0.25,                   // metres between the robot's edge and the slowest moves
    dotRadius: 0.065,
    // colour scale from the worst to the best score at that step (viridis)
    colors: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  },
  // SARL attention: a halo under each person, stronger when the robot weighs that person more.
  // Strength = weight x number of people / 2: equal attention shows every halo at half strength.
  attention: {
    showByDefault: true,
    color: '#0096e6',
  },
  // People's faces when the robot enters their zone (zone keys from `proxemics`).
  reactions: {
    showByDefault: true,
    height: 2.1,                 // metres above the floor
    size: 0.55,                  // metres
    byZone: { personal: 'uneasy', intimate: 'angry', contact: 'shocked' },
  },
  // Reward function panel: SARL's reward (CrowdNav), in plain language.
  rewards: {
    showByDefault: true,
    rules: [
      { value: '+1', tone: 'good', text: 'Atteindre l\u2019objectif' },
      { value: '−0,25', tone: 'bad', text: 'Toucher une personne (fin de l\u2019essai)' },
      { value: '−', tone: 'bad', text: 'Passer à moins de 20 cm d\u2019une personne : plus il est près, plus il perd' },
      { value: '0', tone: 'neutral', text: 'Tout le reste' },
    ],
  },
  // Learning curves panel. Series values come from each checkpoint's `evaluation` (many test rooms),
  // or its `aggregate` over the exported rooms when no evaluation was exported.
  curves: {
    showByDefault: true,
    series: [
      { key: 'goal', label: 'Objectif atteint', color: '#35c46a', value: e => e.success + e.too_close },
      { key: 'collision', label: 'Collision', color: '#ef4b4b', value: e => e.collision },
    ],
    showRoomDots: false,         // row of dots: what happened in the room on screen at each checkpoint
    roomDotsLabel: 'Cette salle',
    outcomeColors: { success: '#35c46a', too_close: '#f5a623', collision: '#ef4b4b', timeout: '#9aa0aa' },
  },
  // Proxemic zones (Edward T. Hall), measured from the person's body edge. Hall's public zone
  // (3.6-7.6 m) is left out: it would cover the whole room. `fill: false` draws only the outline.
  proxemics: {
    showByDefault: true,
    zones: [
      { key: 'intimate', label: 'Intime', range: '0 – 45 cm', to: 0.45, color: 0xe53935, fill: true },
      { key: 'personal', label: 'Personnelle', range: '45 cm – 1,2 m', to: 1.2, color: 0xfb8c00, fill: true },
      { key: 'social', label: 'Sociale', range: '1,2 m – 3,6 m', to: 3.6, color: 0xfdd835, fill: false },
    ],
    fillOpacity: 0.16,           // zone disc at rest
    activeOpacity: 0.5,          // zone disc while the robot's body is inside it
    // Shape of personal space, chosen with the buttons in the legend:
    //   circle    Hall's zones as concentric circles
    //   egg       the same zones stretched in front of the person and shortened behind
    //   gaussian  Kirby's asymmetric Gaussian (2009): sigma in front = max(2 x speed, 0.5 m),
    //             sides 2/3 of that, behind 1/2; longer in front of people who walk fast
    model: 'circle',
    modelLabels: { circle: 'Cercle', egg: 'Œuf', gaussian: 'Gaussienne' },
    egg: { front: 1.45, back: 0.55 },
    gaussian: { speedFactor: 2, minSigmaFront: 0.5, sideRatio: 2 / 3, rearRatio: 1 / 2, extentSigmas: 2.5,
                color: '#e53935', maxAlpha: 0.38,
                // discomfort value at the robot's edge that counts as each zone (for highlights and faces)
                levels: { intimate: 0.6, personal: 0.25, social: 0.05 } },
  },
  modelLoadTimeoutSeconds: 15, // give up and use simple shapes after this
  // Clothing tints so people stay easy to tell apart even when two share a model.
  clothingColors: [0xb83232, 0x2e6fb8, 0xd9921a, 0x1f8a5c, 0x7a3e9d, 0xc85a1e, 0x178a8a, 0xa8174f],
  skinTones: [0xf1c7a5, 0xe0ac7e, 0xc68a5b, 0x9c6a43, 0x6e4a2f, 0xf5d3b8],
};

const params = new URLSearchParams(location.search);
const SIMPLE = params.get('simple') === '1';

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------
const data = DEMO_DATA;
const nCheckpoints = data.checkpoints.length;
const nEpisodes = data.checkpoints[0].episodes.length;
const episodeAt = (c, e) => data.checkpoints[c].episodes[e];

// world (x, y) -> three (x, 0, -y); theta -> rotation.y
function lerpAngle(a, b, t) {
  let d = b - a;
  d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}
function sampleFrames(frames, f) {
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(f)));
  const j = Math.min(frames.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, f - i));
  const a = frames[i], b = frames[j];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, lerpAngle(a[2], b[2], t)];
}

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d22);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
camera.position.set(0, 10.5, 9.5);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.6);
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 6; controls.maxDistance = 40;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(5, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x3a3d44 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

let afterResize = null;                          // set once the data is ready; refits the camera
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (afterResize) afterResize();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
const std = (color) => new THREE.MeshStandardMaterial({ color });
function shadowed(o) { o.traverse(m => { if (m.isMesh) { m.castShadow = true; } }); return o; }

// TurtleBot 3 "Burger" look-alike, built from primitives (no model file needed).
// Real robot: 178 mm long, 138 mm wide, 192 mm tall. Scaled so its footprint
// matches the recorded radius. Front of the robot is +x.
function roundedPlate(len, wid, thick, corner, material) {
  const sh = new THREE.Shape();
  const x = -len / 2, y = -wid / 2;
  sh.moveTo(x + corner, y);
  sh.lineTo(x + len - corner, y); sh.quadraticCurveTo(x + len, y, x + len, y + corner);
  sh.lineTo(x + len, y + wid - corner); sh.quadraticCurveTo(x + len, y + wid, x + len - corner, y + wid);
  sh.lineTo(x + corner, y + wid); sh.quadraticCurveTo(x, y + wid, x, y + wid - corner);
  sh.lineTo(x, y + corner); sh.quadraticCurveTo(x, y, x + corner, y);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);                     // lie flat, thickness grows upward
  return new THREE.Mesh(geo, material);
}

function makeRobot(radius) {
  const s = radius / 0.112;                      // metres of real robot -> scene size
  const L = 0.178 * s, W = 0.138 * s, H = 0.192 * s;
  const g = new THREE.Group();
  const plateMat = std(0x2b2b2e), metal = std(0xb8bcc2), rubber = std(0x151515);

  // Four stacked waffle plates.
  const plateYs = [0.03, 0.075, 0.12, 0.155].map(v => v * s);
  for (const py of plateYs) {
    const p = roundedPlate(L * 0.72, W, 0.006 * s, 0.02 * s, plateMat);
    p.position.set(-L * 0.08, py, 0);
    g.add(p);
  }
  // Metal standoffs at the corners between plates.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.004 * s, 0.004 * s, plateYs[3] - plateYs[0], 8), metal);
    post.position.set(-L * 0.08 + sx * L * 0.3, (plateYs[0] + plateYs[3]) / 2, sz * W * 0.4);
    g.add(post);
  }
  // Drive wheels on both sides, slightly forward of centre.
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.033 * s, 0.033 * s, 0.018 * s, 24), rubber);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(L * 0.12, 0.033 * s, side * (W / 2 + 0.01 * s));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.02 * s, 12), metal);
    hub.rotation.x = Math.PI / 2;
    hub.position.copy(wheel.position);
    g.add(wheel, hub);
  }
  // Battery (grey block) and green OpenCR board on the middle decks.
  const battery = new THREE.Mesh(new THREE.BoxGeometry(L * 0.35, 0.03 * s, W * 0.5), std(0x55595f));
  battery.position.set(-L * 0.12, plateYs[0] + 0.02 * s, 0);
  const board = new THREE.Mesh(new THREE.BoxGeometry(L * 0.45, 0.004 * s, W * 0.75), std(0x1f7a4d));
  board.position.set(-L * 0.08, plateYs[1] + 0.009 * s, 0);
  const pi = new THREE.Mesh(new THREE.BoxGeometry(L * 0.38, 0.004 * s, W * 0.55), std(0x2e8b3e));
  pi.position.set(-L * 0.08, plateYs[2] + 0.009 * s, 0);
  g.add(battery, board, pi);

  // LiDAR on top: dark base plus a spinning head.
  const lidarBase = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.02 * s, 24), std(0x1a1a1a));
  lidarBase.position.set(-L * 0.08, plateYs[3] + 0.016 * s, 0);
  const lidarHead = new THREE.Group();
  const headBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.033 * s, 0.022 * s, 24), std(0x2a2a2a));
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.012 * s, 0.01 * s, 0.03 * s), std(0x3a6ea5));
  lens.position.x = 0.03 * s;
  lidarHead.add(headBody, lens);
  lidarHead.position.set(-L * 0.08, plateYs[3] + 0.037 * s, 0);
  g.add(lidarBase, lidarHead);
  g.userData.lidar = lidarHead;

  // Heading indicator: a flat yellow arrow on the floor in front of the robot,
  // readable from the tilted camera even though the Burger itself is almost symmetric.
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, -0.12); arrowShape.lineTo(0.16, -0.12); arrowShape.lineTo(0.16, -0.22);
  arrowShape.lineTo(0.36, 0); arrowShape.lineTo(0.16, 0.22); arrowShape.lineTo(0.16, 0.12);
  arrowShape.lineTo(0, 0.12); arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape);
  arrowGeo.rotateX(-Math.PI / 2);
  const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffc400, side: THREE.DoubleSide }));
  arrow.scale.setScalar(radius / 0.3);
  arrow.position.set(radius * 1.05, 0.012, 0);
  g.add(arrow);

  shadowed(g);
  arrow.castShadow = false;
  return g;
}

// ---------------------------------------------------------------------------
// Rigged human models (skipped with ?simple=1 and when the page is opened as a file)
// ---------------------------------------------------------------------------
const humanTemplates = [];     // { name, scene, walk, idle, scale, walkSpeed }

function prepareHumanTemplate(name, gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const scale = CONFIG.humanHeight / Math.max(0.01, box.max.y - box.min.y);
  const walk = gltf.animations.find(a => a.name === 'Walk');
  const idle = gltf.animations.find(a => a.name === CONFIG.idleClip) || gltf.animations.find(a => a.name === 'Idle');
  if (!walk || !idle) throw new Error(name + ': missing Walk or Idle animation');
  for (const m of root.getObjectsByProperty('isMesh', true)) {
    m.castShadow = true;
    m.frustumCulled = false;                     // skinned bounds are unreliable when animated
    if (m.material.metalness !== undefined) m.material.metalness = 0;
  }
  return { name, scene: root, walk, idle, scale, walkSpeed: measureWalkSpeed(root, walk, scale) };
}

// The walk clip is in place. Estimate the ground speed it was animated for from how
// far a foot travels front-to-back, so playback rate can match the recorded speed.
function measureWalkSpeed(root, clip, scale) {
  const foot = root.getObjectByName('FootL') || root.getObjectByName('Foot.L');   // loader strips dots
  if (!foot) return 1.0;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const inv = new THREE.Matrix4(), p = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  const n = 40;
  for (let i = 0; i < n; i++) {
    mixer.setTime(clip.duration * i / n);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    foot.getWorldPosition(p).applyMatrix4(inv);
    lo = Math.min(lo, p.z); hi = Math.max(hi, p.z);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  // Foot is planted for roughly half the cycle while the body passes over it.
  const speed = (hi - lo) * scale / (clip.duration * 0.5);
  return Math.min(2.0, Math.max(0.5, speed || 1.0));
}

function loadHumanModels() {
  if (SIMPLE) return Promise.resolve();
  if (location.protocol === 'file:') {
    console.warn('Page ouverte comme fichier : le navigateur bloque le chargement des modèles. Utiliser run.sh, ou ?simple=1.');
    return Promise.resolve();
  }
  const loader = new THREE.GLTFLoader();
  const loads = Object.keys(CONFIG.humanModels).map(name => new Promise(resolve => {
    loader.load(`assets/humans/${name}.glb`,
      gltf => { try { resolve(prepareHumanTemplate(name, gltf)); } catch (e) { console.warn(e); resolve(null); } },
      undefined,
      err => { console.warn('Impossible de charger', name, err); resolve(null); });
  }));
  const all = Promise.all(loads).then(ts => {
    humanTemplates.push(...ts.filter(Boolean));
    console.info('Personnages chargés :', humanTemplates.map(t => `${t.name} (marche ${t.walkSpeed.toFixed(2)} m/s)`).join(', '));
  });
  const timeout = new Promise(resolve => setTimeout(() => {
    console.warn('Chargement des modèles trop long, formes simples utilisées.');
    resolve();
  }, CONFIG.modelLoadTimeoutSeconds * 1000));
  return Promise.race([all, timeout]);
}

function makeModelHuman(template, clothingColor, skinTone) {
  const g = new THREE.Group();
  const body = THREE.SkeletonUtils.clone(template.scene);
  body.scale.setScalar(template.scale);
  body.rotation.y = Math.PI / 2;                 // models face +z; our heading is +x
  const tintName = CONFIG.humanModels[template.name];
  const skin = new THREE.Color(skinTone).convertSRGBToLinear();
  body.traverse(m => {
    if (!m.isMesh) return;
    m.material = m.material.clone();             // per-person tint without touching the template
    const name = m.material.name;
    if (tintName && name === tintName) m.material.color.setHex(clothingColor);
    if (name === 'Skin') m.material.color.copy(skin);
    if (name === 'Skin_Darker') m.material.color.copy(skin).multiplyScalar(0.8);
    m.userData.sharedGeometry = true;
  });
  g.add(body);
  const mixer = new THREE.AnimationMixer(body);
  const walk = mixer.clipAction(template.walk);
  const idle = mixer.clipAction(template.idle);
  walk.play(); idle.play();
  walk.time = Math.random() * template.walk.duration;   // people should not step in sync
  idle.time = Math.random() * template.idle.duration;
  g.userData = { model: true, mixer, walk, idle, walkSpeed: template.walkSpeed, smoothSpeed: 0 };
  return g;
}

function animateModelHuman(h, speed, dt) {
  const u = h.userData;
  u.smoothSpeed += (speed - u.smoothSpeed) * Math.min(1, dt * 8);
  const s = u.smoothSpeed;
  const walkWeight = Math.min(1, Math.max(0, (s - 0.08) / 0.3));
  u.walk.setEffectiveWeight(walkWeight);
  u.idle.setEffectiveWeight(1 - walkWeight);
  u.walk.setEffectiveTimeScale(Math.min(2.0, Math.max(0.4, s / u.walkSpeed)));   // feet match ground speed
  u.mixer.update(dt);
}

function makeHuman(h, index, seed) {
  if (humanTemplates.length) {
    const pick = (seed * 7 + index * 3) % humanTemplates.length;
    return makeModelHuman(humanTemplates[pick],
      CONFIG.clothingColors[(seed + index * 5) % CONFIG.clothingColors.length],
      CONFIG.skinTones[(seed * 3 + index * 7) % CONFIG.skinTones.length]);
  }
  return makePrimitiveHuman(h.radius, index);
}

function animateHuman(m, speed, dt) {
  if (m.userData.model) animateModelHuman(m, speed, dt);
  else animatePrimitiveHuman(m, speed, dt);
}

// Push overlapping people apart symmetrically. Positions come from smooth interpolation, so the
// offsets are smooth too. Two passes settle small clusters.
function separateHumans(meshes, minDist) {
  if (!minDist) return;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < meshes.length; i++) {
      const a = meshes[i].position;
      for (let j = i + 1; j < meshes.length; j++) {
        const b = meshes[j].position;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= minDist) continue;
        const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0;
        const push = (minDist - d) / 2;
        a.x -= ux * push; a.z -= uz * push;
        b.x += ux * push; b.z += uz * push;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Proxemic zones on the floor around each person
// ---------------------------------------------------------------------------
// Zones are clipped to the room so the large social circles do not spill off the floor.
renderer.localClippingEnabled = true;
const roomClipPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
function setRoomClipping(ep) {
  const b = roomBounds(ep);                      // world (x, y) -> three (x, -y)
  roomClipPlanes[0].set(new THREE.Vector3(1, 0, 0), -b.minX);
  roomClipPlanes[1].set(new THREE.Vector3(-1, 0, 0), b.maxX);
  roomClipPlanes[2].set(new THREE.Vector3(0, 0, 1), b.maxY);    // z >= -maxY
  roomClipPlanes[3].set(new THREE.Vector3(0, 0, -1), -b.minY);  // z <= -minY
}

// Egg: zone distance multiplier by direction (angle from the person's heading)
function eggFactor(phi) {
  const { front, back } = CONFIG.proxemics.egg;
  return (front + back) / 2 + (front - back) / 2 * Math.cos(phi);
}

// Flat ring between two closed curves r_in(phi) and r_out(phi), in the person's frame (+x = heading).
function curveRingGeometry(rIn, rOut, segments = 72) {
  const shape = new THREE.Shape(), hole = new THREE.Path();
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * 2 * Math.PI, r = rOut(phi);
    i ? shape.lineTo(r * Math.cos(phi), r * Math.sin(phi)) : shape.moveTo(r * Math.cos(phi), r * Math.sin(phi));
  }
  for (let i = segments; i >= 0; i--) {
    const phi = (i / segments) * 2 * Math.PI, r = rIn(phi);
    i === segments ? hole.moveTo(r * Math.cos(phi), r * Math.sin(phi)) : hole.lineTo(r * Math.cos(phi), r * Math.sin(phi));
  }
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);                         // shape (x, y) -> floor (x, -z): +y stays the person's left
  return geo;
}

function zoneMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false,
                                       side: THREE.DoubleSide, clippingPlanes: roomClipPlanes });
}

// Hall's zones drawn as rings; `stretch(phi)` = 1 for circles, eggFactor for eggs.
function makeZoneRings(bodyRadius, stretch) {
  const g = new THREE.Group();
  const fills = [];
  let prevTo = 0;
  CONFIG.proxemics.zones.forEach((z, i) => {
    const y = 0.006 + i * 0.002;
    const rIn = phi => bodyRadius + prevTo * stretch(phi);
    const rOut = phi => bodyRadius + z.to * stretch(phi);
    let fill = null;
    if (z.fill) {
      fill = new THREE.Mesh(curveRingGeometry(rIn, rOut), zoneMaterial(z.color, CONFIG.proxemics.fillOpacity));
      fill.position.y = y;
      fill.renderOrder = 1;
      g.add(fill);
    }
    const edge = new THREE.Mesh(curveRingGeometry(phi => rOut(phi) - 0.03, rOut, 96), zoneMaterial(z.color, z.fill ? 0.55 : 0.75));
    edge.position.y = y + 0.001;
    edge.renderOrder = 2;
    g.add(edge);
    fills.push(fill);
    prevTo = z.to;
  });
  g.userData = { fills };
  return g;
}

// Kirby's Gaussian: one shared texture of a half Gaussian (u = forward in [0, 1], v = side in [-1, 1],
// both in units of extentSigmas sigmas), used by a front half and a rear half scaled every frame.
const gaussianTexture = (() => {
  const cfg = CONFIG.proxemics.gaussian, W = 64, H = 128, n = cfg.extentSigmas;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  const col = new THREE.Color(cfg.color);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W * n, v = ((j + 0.5) / H * 2 - 1) * n;
    const k = 4 * (j * W + i);
    img.data[k] = col.r * 255; img.data[k + 1] = col.g * 255; img.data[k + 2] = col.b * 255;
    img.data[k + 3] = 255 * cfg.maxAlpha * Math.exp(-(u * u + v * v) / 2);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
})();
const halfPlaneGeometry = (() => {
  const geo = new THREE.PlaneGeometry(1, 2);
  geo.translate(0.5, 0, 0);                          // x in [0, 1]: from the person forward
  geo.rotateX(-Math.PI / 2);
  return geo;
})();

function makeGaussianSpace() {
  const g = new THREE.Group();
  const mat = () => new THREE.MeshBasicMaterial({ map: gaussianTexture, transparent: true, opacity: 0.8,
                                                  depthWrite: false, side: THREE.DoubleSide, clippingPlanes: roomClipPlanes });
  const front = new THREE.Mesh(halfPlaneGeometry, mat());
  const rear = new THREE.Mesh(halfPlaneGeometry, mat());
  rear.rotation.y = Math.PI;
  for (const m of [front, rear]) { m.position.y = 0.007; m.renderOrder = 1; m.userData.sharedGeometry = true; g.add(m); }
  g.userData = { front, rear };
  return g;
}

function gaussianSigmas(speed) {
  const c = CONFIG.proxemics.gaussian;
  const front = Math.max(c.speedFactor * speed, c.minSigmaFront);
  return { front, side: front * c.sideRatio, rear: front * c.rearRatio };
}

function makeProxemicZones(bodyRadius) {
  const g = new THREE.Group();
  g.name = 'proxemics';
  const models = {
    circle: makeZoneRings(bodyRadius, () => 1),
    egg: makeZoneRings(bodyRadius, eggFactor),
    gaussian: makeGaussianSpace(),
  };
  for (const [key, sub] of Object.entries(models)) { sub.visible = key === CONFIG.proxemics.model; g.add(sub); }
  g.userData = { models };
  g.visible = ui.showZones.checked;
  return g;
}

// Where the robot is in each person's space, for the selected model.
// Returns { zone: index into CONFIG.proxemics.zones or -1, contact: bodies touch }.
function personalSpaceLevel(m, bodyRadius, robotPos, robotRadius) {
  const dx = robotPos.x - m.position.x, dz = robotPos.z - m.position.z;
  const dist = Math.hypot(dx, dz), gap = dist - bodyRadius - robotRadius;
  const zones = CONFIG.proxemics.zones;
  if (gap < 0) return { zone: 0, contact: true };
  const th = m.rotation.y, wx = dx, wy = -dz;        // three (x, z) -> world (x, y)
  const lx = Math.cos(th) * wx + Math.sin(th) * wy, ly = -Math.sin(th) * wx + Math.cos(th) * wy;
  const model = CONFIG.proxemics.model;
  if (model === 'gaussian') {
    const sg = gaussianSigmas(m.userData.speed || 0);
    const k = Math.max(0, dist - robotRadius) / Math.max(dist, 1e-6);   // measure at the robot's edge
    const x = lx * k, y = ly * k, sx = x >= 0 ? sg.front : sg.rear;
    const value = Math.exp(-(x * x / (2 * sx * sx) + y * y / (2 * sg.side * sg.side)));
    const lv = CONFIG.proxemics.gaussian.levels;
    return { zone: zones.findIndex(z => value >= lv[z.key]), contact: false };
  }
  const stretch = model === 'egg' ? eggFactor(Math.atan2(ly, lx)) : 1;
  return { zone: zones.findIndex(z => gap < z.to * stretch), contact: false };
}

// Shape the Gaussian to each person's speed and light up the zone the robot is in.
function updateProxemicZones(levels) {
  if (!ui.showZones.checked) return;
  const model = CONFIG.proxemics.model;
  humanMeshes.forEach((m, i) => {
    const pz = m.userData.proxemics;
    if (!pz) return;
    const sub = pz.userData.models[model];
    if (model === 'gaussian') {
      const sg = gaussianSigmas(m.userData.speed || 0), n = CONFIG.proxemics.gaussian.extentSigmas;
      sub.userData.front.scale.set(n * sg.front, 1, n * sg.side);
      sub.userData.rear.scale.set(n * sg.rear, 1, n * sg.side);
      const active = levels[i].zone >= 0 && levels[i].zone <= 1;
      for (const half of [sub.userData.front, sub.userData.rear]) half.material.opacity = active ? 1 : 0.7;
    } else {
      sub.userData.fills.forEach((fill, k) => {
        if (fill) fill.material.opacity = k === levels[i].zone ? CONFIG.proxemics.activeOpacity : CONFIG.proxemics.fillOpacity;
      });
    }
  });
}

function setSpaceModel(model) {
  CONFIG.proxemics.model = model;
  for (const m of humanMeshes) {
    const pz = m.userData.proxemics;
    if (pz) for (const [key, sub] of Object.entries(pz.userData.models)) sub.visible = key === model;
  }
  buildLegend();
}

function setZonesVisible(visible) {
  ui.legend.hidden = !visible;
  for (const m of humanMeshes) if (m.userData.proxemics) m.userData.proxemics.visible = visible;
}

function buildLegend() {
  const P = CONFIG.proxemics, model = P.model;
  const buttons = '<div class="space-models">' + Object.entries(P.modelLabels).map(([key, label]) =>
    `<button data-model="${key}" class="${key === model ? 'active' : ''}">${label}</button>`).join('') + '</div>';
  let body;
  if (model === 'gaussian') {
    body = '<div class="gauss-scale"></div><div class="options-scale-labels"><span>gêne faible</span><span>forte</span></div>' +
      '<div class="legend-note">Plus longue devant les personnes qui marchent vite</div>';
  } else {
    body = P.zones.map(z =>
      `<div class="legend-row"><span class="swatch${z.fill ? '' : ' outline'}" style="--c:#${z.color.toString(16).padStart(6, '0')}"></span>` +
      `<span>${z.label}</span><span class="legend-range">${z.range}</span></div>`).join('') +
      (model === 'egg' ? '<div class="legend-note">Distances devant la personne ; plus courtes derrière</div>' : '');
  }
  ui.legend.innerHTML = '<div class="legend-title">Distances sociales</div>' + buttons + body;
  for (const b of ui.legend.querySelectorAll('button[data-model]')) {
    b.addEventListener('click', () => { setSpaceModel(b.dataset.model); b.blur(); });
  }
}

// ---------------------------------------------------------------------------
// Options fan (SARL decisions)
// ---------------------------------------------------------------------------
const hasDecisions = data.checkpoints.some(c => c.episodes.some(e => e.decisions));
const optionColors = CONFIG.options.colors.map(c => new THREE.Color(c));
function optionColor(t, out) {                      // t in [0, 1] along the colour scale
  const k = Math.min(optionColors.length - 2, Math.floor(t * (optionColors.length - 1)));
  return out.copy(optionColors[k]).lerp(optionColors[k + 1], t * (optionColors.length - 1) - k);
}

const optionFan = (() => {
  const g = new THREE.Group();
  g.visible = false;
  const n = 81;
  const dotGeo = new THREE.CircleGeometry(CONFIG.options.dotRadius, 20);
  dotGeo.rotateX(-Math.PI / 2);
  const dots = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }), n);
  dots.renderOrder = 4;
  dots.position.y = 0.03;
  dots.frustumCulled = false;
  const ringGeo = new THREE.RingGeometry(CONFIG.options.dotRadius * 1.25, CONFIG.options.dotRadius * 2, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, transparent: true }));
  ring.renderOrder = 5;
  const lineGeo = new THREE.PlaneGeometry(1, 0.04);
  lineGeo.rotateX(-Math.PI / 2);
  lineGeo.translate(0.5, 0, 0);                    // starts at the robot, length set by scale.x
  const line = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  line.renderOrder = 5;
  line.position.y = 0.028;
  g.add(dots, ring, line);
  g.userData = { dots, ring, line, shownKey: null };
  return g;
})();
scene.add(optionFan);

/** Draws the scored moves around the robot. `heading` is the robot's heading when it decided;
    `key` changes whenever the decision does, so unchanged decisions are not redrawn. */
function drawOptionFan(actions, decision, heading, robotRadius, key, visible) {
  optionFan.visible = !!(visible && decision);
  if (!optionFan.visible) return;
  optionFan.position.set(robotMesh.position.x, 0, robotMesh.position.z);
  optionFan.rotation.y = heading;
  const u = optionFan.userData;
  if (u.shownKey === key) return;
  u.shownKey = key;

  const cfg = CONFIG.options, values = decision.values;
  const vmax = Math.max(...actions.map(a => a[0])) || 1;
  const lo = Math.min(...values), hi = Math.max(...values);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const place = (i) => {
    const [v, turn] = actions[i];
    if (v === 0) return [-(robotRadius + cfg.gap * 0.6), 0];        // "stay still": just behind the robot
    const d = robotRadius + cfg.gap + (v / vmax) * cfg.reach;
    return [d * Math.cos(turn), -d * Math.sin(turn)];               // robot frame -> three local (x, z)
  };
  actions.forEach((a, i) => {
    const [x, z] = place(i);
    u.dots.setMatrixAt(i, m.makeTranslation(x, 0, z));
    u.dots.setColorAt(i, optionColor(hi > lo ? (values[i] - lo) / (hi - lo) : 1, c));
  });
  u.dots.count = actions.length;
  u.dots.instanceMatrix.needsUpdate = true;
  u.dots.instanceColor.needsUpdate = true;
  const [cx, cz] = place(decision.chosen);
  u.ring.position.set(cx, 0.035, cz);
  const len = Math.hypot(cx, cz);
  u.line.scale.x = Math.max(0.001, len - cfg.dotRadius * 2);
  u.line.rotation.y = -Math.atan2(cz, cx);
}

function updateOptionFan(ep, k, visible) {
  const decision = ep.decisions ? ep.decisions.steps[k] : null;
  const heading = ep.robot.frames[k] ? ep.robot.frames[k][2] : 0;
  drawOptionFan(ep.decisions ? ep.decisions.actions : [], decision, heading, ep.robot.radius,
                state.checkpoint + ':' + state.episode + ':' + k, visible);
}

function buildOptionsLegend() {
  const stops = CONFIG.options.colors.map((col, i, arr) => `${col} ${Math.round(100 * i / (arr.length - 1))}%`).join(', ');
  ui.optionsLegend.innerHTML = '<div class="legend-title">Choix du robot</div>' +
    `<div class="options-scale" style="background: linear-gradient(90deg, ${stops})"></div>` +
    '<div class="options-scale-labels"><span>moins bon</span><span>meilleur</span></div>' +
    '<div class="legend-row"><span class="swatch outline" style="--c:#ffffff"></span><span>choix retenu</span></div>';
}

// ---------------------------------------------------------------------------
// SARL attention halos
// ---------------------------------------------------------------------------
const hasAttention = data.checkpoints.some(c => c.episodes.some(e => e.attention));
function makeAttentionHalo(bodyRadius) {
  const geo = new THREE.RingGeometry(bodyRadius + 0.04, bodyRadius + 0.3, 48);
  geo.rotateX(-Math.PI / 2);
  const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: CONFIG.attention.color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.NormalBlending }));
  halo.position.y = 0.02;
  halo.renderOrder = 3;
  return halo;
}
/** Halo strength per person, blending two sets of attention weights (t from 0 to 1). */
function drawAttention(weightsA, weightsB, t, visible) {
  const n = humanMeshes.length;
  humanMeshes.forEach((m, i) => {
    const halo = m.userData.attentionHalo;
    if (!halo) return;
    halo.visible = !!(visible && weightsA);
    if (!halo.visible) return;
    const wa = weightsA[i], wb = weightsB ? weightsB[i] : wa;
    const strength = Math.min(1, (wa + (wb - wa) * t) * n / 2);
    halo.material.opacity = 0.08 + 0.87 * strength;
    halo.scale.setScalar(0.85 + 0.3 * strength);
  });
}

function updateAttention(ep, f, visible) {
  const att = ep.attention;
  if (!att) { drawAttention(null, null, 0, false); return; }
  const k = Math.min(Math.floor(f), att.length - 1), k2 = Math.min(k + 1, att.length - 1);
  drawAttention(att[k], att[k2] || att[k], Math.min(1, f - k), visible);
}

// ---------------------------------------------------------------------------
// People's reactions (faces drawn on a canvas, no emoji font needed)
// ---------------------------------------------------------------------------
const faceTextures = (() => {
  const make = (kind) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const fill = { uneasy: '#ffb74d', angry: '#ef5350', shocked: '#ce93d8' }[kind];
    g.fillStyle = fill; g.strokeStyle = '#1b1d22'; g.lineWidth = 6;
    g.beginPath(); g.arc(64, 64, 56, 0, 2 * Math.PI); g.fill(); g.stroke();
    g.fillStyle = '#1b1d22'; g.lineCap = 'round';
    const eye = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill(); };
    if (kind === 'shocked') { eye(44, 50, 8); eye(84, 50, 8); } else { eye(44, 54, 6); eye(84, 54, 6); }
    g.lineWidth = 7;
    if (kind === 'uneasy') {                          // wavy mouth, raised brow
      g.beginPath(); g.moveTo(38, 90); g.quadraticCurveTo(51, 80, 64, 90); g.quadraticCurveTo(77, 100, 90, 90); g.stroke();
      g.beginPath(); g.moveTo(74, 36); g.lineTo(94, 32); g.stroke();
    } else if (kind === 'angry') {                    // frown and slanted brows
      g.beginPath(); g.arc(64, 104, 24, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke();
      g.beginPath(); g.moveTo(30, 34); g.lineTo(54, 44); g.moveTo(98, 34); g.lineTo(74, 44); g.stroke();
    } else {                                          // open mouth
      g.beginPath(); g.ellipse(64, 92, 12, 16, 0, 0, 2 * Math.PI); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  return { uneasy: make('uneasy'), angry: make('angry'), shocked: make('shocked') };
})();

function makeReaction() {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: faceTextures.uneasy, depthTest: false, transparent: true }));
  sprite.position.y = CONFIG.reactions.height;
  sprite.renderOrder = 10;
  sprite.visible = false;
  sprite.userData = { kind: null, since: 0 };
  sprite.userData.sharedGeometry = true;             // sprites share one geometry across the app
  return sprite;
}

function updateReactions(levels, now, visible) {
  const zones = CONFIG.proxemics.zones, byZone = CONFIG.reactions.byZone;
  humanMeshes.forEach((m, i) => {
    const sprite = m.userData.reaction;
    if (!sprite) return;
    let kind = null;
    if (visible) {
      if (levels[i].contact) kind = byZone.contact;
      else if (levels[i].zone >= 0) kind = byZone[zones[levels[i].zone].key] || null;
    }
    const u = sprite.userData;
    if (kind !== u.kind) {
      u.kind = kind; u.since = now;
      if (kind) sprite.material.map = faceTextures[kind];
    }
    sprite.visible = !!kind;
    if (kind) {                                       // quick pop with a small overshoot
      const t = Math.min(1, (now - u.since) * 5);
      const pop = t < 1 ? Math.sin(t * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1;
      sprite.scale.setScalar(CONFIG.reactions.size * Math.max(0.05, pop));
    }
  });
}

// Reward function panel
const rewardRules = CONFIG.rewards.rules;
function buildRewardsPanel() {
  if (!rewardRules) return;
  ui.rewards.innerHTML = '<div class="legend-title">Récompenses</div>' +
    '<div class="rewards-intro">Ce que le robot gagne ou perd :</div>' +
    rewardRules.map(r => `<div class="reward-row"><span class="reward-value ${r.tone}">${r.value}</span><span>${r.text}</span></div>`).join('');
}

// Training episode count at a checkpoint, or null when the data does not carry one
function episodeCount(i) {
  const n = data.index.checkpoints[i].training_episodes;
  return n === undefined || n === null ? null : n;
}
const formatCount = n => n.toLocaleString('fr-FR');

// ---------------------------------------------------------------------------
// Learning curves (2D canvas)
// ---------------------------------------------------------------------------
const curveVisible = {};
function curveStats(c) {
  if (c.evaluation) return { rates: c.evaluation, episodes: c.evaluation.episodes };
  const a = c.aggregate;
  return { rates: { success: a.success_rate, too_close: a.too_close_rate, collision: a.collision_rate,
                    timeout: a.timeout_rate }, episodes: c.n_episodes };
}

function buildCurvesPanel() {
  const cfg = CONFIG.curves;
  const rows = cfg.series.map(sr => ({ key: sr.key, label: sr.label, swatch: `<span class="series-swatch" style="--c:${sr.color}"></span>` }));
  if (cfg.showRoomDots) rows.push({ key: 'room', label: cfg.roomDotsLabel,
    swatch: `<span class="series-swatch dot" style="--c:${cfg.outcomeColors.success}"></span>` });
  ui.curvesSeries.innerHTML = rows.map(r =>
    `<label><input type="checkbox" data-series="${r.key}" checked>${r.swatch}${r.label}</label>`).join('');
  for (const input of ui.curvesSeries.querySelectorAll('input')) {
    curveVisible[input.dataset.series] = true;
    input.addEventListener('change', () => {
      curveVisible[input.dataset.series] = input.checked;
      input.blur();
      drawCurves();
    });
  }
}

function drawCurves() {
  if (ui.curves.hidden) return;
  const cfg = CONFIG.curves, canvas = ui.curvesCanvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const cps = data.index.checkpoints;
  const left = 78, right = 14, top = 40, bottom = (cfg.showRoomDots && curveVisible.room ? 26 : 0) + 58;
  const pw = W - left - right, ph = H - top - bottom;
  const X = i => left + (cps.length > 1 ? i / (cps.length - 1) : 0.5) * pw;
  const Y = v => top + (1 - v) * ph;

  // grid and axis labels
  g.font = '18px "DejaVu Sans", Arial, sans-serif';
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of [0, 0.5, 1]) {
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(left, Y(v)); g.lineTo(left + pw, Y(v)); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillText(`${Math.round(v * 100)} %`, left - 10, Y(v));
  }
  g.textBaseline = 'alphabetic';
  if (episodeCount(0) === null) {
    g.textAlign = 'left';
    g.fillText('début', left, H - 8);
    g.textAlign = 'right';
    g.fillText('fin de l\u2019entraînement', left + pw, H - 8);
  } else {
    // episode numbers under a few checkpoints, spread along the axis
    const ticks = [...new Set([0, Math.round((cps.length - 1) / 3), Math.round(2 * (cps.length - 1) / 3), cps.length - 1])];
    ticks.forEach((i, k) => {
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(i), top + ph); g.lineTo(X(i), top + ph + 6); g.stroke();
      g.textAlign = k === 0 ? 'left' : k === ticks.length - 1 ? 'right' : 'center';
      g.fillText(formatCount(episodeCount(i)), X(i) + (k === 0 ? -4 : 0), top + ph + 26);
    });
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText('essais', left + pw / 2, H - 4);
  }

  // curves
  for (const sr of cfg.series) {
    if (!curveVisible[sr.key]) continue;
    g.strokeStyle = sr.color; g.lineWidth = 4; g.lineJoin = 'round';
    g.beginPath();
    cps.forEach((c, i) => { const y = Y(sr.value(curveStats(c).rates)); i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); });
    g.stroke();
  }

  // outcomes in the room on screen
  if (cfg.showRoomDots && curveVisible.room) {
    const yDots = top + ph + 20;
    data.checkpoints.forEach((c, i) => {
      g.fillStyle = cfg.outcomeColors[c.episodes[state.episode].outcome] || '#fff';
      g.beginPath(); g.arc(X(i), yDots, i === state.checkpoint ? 8 : 5, 0, 2 * Math.PI); g.fill();
    });
  }

  // marker following the slider, labelled with its episode number
  const mx = X(state.checkpoint);
  const count = episodeCount(state.checkpoint);
  if (count !== null) {
    const text = `essai ${formatCount(count)}`;
    g.font = 'bold 18px "DejaVu Sans", Arial, sans-serif';
    const tw = g.measureText(text).width + 16;
    const bx = Math.min(Math.max(mx - tw / 2, left), left + pw - tw);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.roundRect(bx, 4, tw, 26, 6); g.fill();
    g.fillStyle = '#1b1d22'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, bx + tw / 2, 17);
    g.textBaseline = 'alphabetic';
  }
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.setLineDash([6, 5]);
  g.beginPath(); g.moveTo(mx, top); g.lineTo(mx, top + ph); g.stroke();
  g.setLineDash([]);
  for (const sr of cfg.series) {
    if (!curveVisible[sr.key]) continue;
    const y = Y(sr.value(curveStats(cps[state.checkpoint]).rates));
    g.fillStyle = sr.color; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(mx, y, 7, 0, 2 * Math.PI); g.fill(); g.stroke();
  }
}

const HUMAN_COLORS = [0xc0392b, 0x16a085, 0x8e44ad, 0xd35400, 0x2c3e50, 0x27ae60];
function makePrimitiveHuman(radius, colorIndex) {
  const g = new THREE.Group();
  const color = HUMAN_COLORS[colorIndex % HUMAN_COLORS.length];
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius * 0.7, 0.75, 20), std(color));
  body.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), std(0xf1c27d));
  head.position.y = 1.72;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), std(0xe0a060));
  nose.position.set(0.17, 1.72, 0);
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.78, side * radius * 0.4);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.78, 0.14), std(0x333a44));
    leg.position.y = -0.39;
    hip.add(leg);
    g.add(hip);
    legs.push(hip);
  }
  g.add(body, head, nose);
  g.userData = { legs, phase: 0 };
  return shadowed(g);
}
function animatePrimitiveHuman(h, speed, dt) {
  // Stride phase advances with distance walked, so feet match ground speed.
  h.userData.phase += speed * dt * 4.5;
  const amp = Math.min(1, speed / 1.0) * 0.55;
  h.userData.legs[0].rotation.z = Math.sin(h.userData.phase) * amp;
  h.userData.legs[1].rotation.z = -Math.sin(h.userData.phase) * amp;
}

// Static objects. Rectangular ones (tables, laptops, chairs) carry length and width, round ones a radius.
function makeObject(o) {
  const g = new THREE.Group();
  g.position.set(o.x, 0, -o.y);
  g.rotation.y = o.theta || 0;                   // length runs along the object's heading
  if (o.type === 'plant') {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(o.radius * 0.8, o.radius * 0.6, 0.4, 20), std(0xa0522d));
    pot.position.y = 0.2;
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(o.radius * 1.1, 1), std(0x3f8f3a));
    leaves.position.y = 0.4 + o.radius * 0.9;
    g.add(pot, leaves);
  } else if (o.length !== undefined && o.width !== undefined) {
    const h = o.type === 'table' ? 0.75 : o.type === 'chair' ? 0.45 : 0.05;
    const top = new THREE.Mesh(new THREE.BoxGeometry(o.length, 0.06, o.width), std(0x9c6b3e));
    top.position.y = h;
    g.add(top);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), std(0x6d4a2b));
      leg.position.set(sx * (o.length / 2 - 0.08), h / 2, sz * (o.width / 2 - 0.08));
      g.add(leg);
    }
  } else {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, 0.5, 24), std(0x9c6b3e));
    m.position.y = 0.25;
    g.add(m);
  }
  return g;
}

// Frame the whole room with the camera, keeping the ~45 degree tilt.
// Room extent from the walls, or from scene.bounds [xmin, xmax, ymin, ymax] when there are none.
function roomBounds(ep) {
  const pts = ep.scene.walls.flat();
  if (!pts.length) {
    const [minX, maxX, minY, maxY] = ep.scene.bounds || [-5, 5, -5, 5];
    // The simulation ends the run when the robot's centre leaves the map, so decorative walls sit
    // one robot radius further out: the robot's edge touches the wall at that moment.
    const pad = CONFIG.decorativeWalls ? ep.robot.radius : 0;
    return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function fitCamera(ep) {
  const b = roomBounds(ep);
  const cx = (b.minX + b.maxX) / 2, cz = -(b.minY + b.maxY) / 2;
  // Corners of the room, at floor level and at head height, must land inside the screen area
  // left free by the UI (label at the top, control bar at the bottom).
  const pts = [];
  for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const h of [0, 1.8]) {
    pts.push(new THREE.Vector3(x, h, -y));
  }
  const H = window.innerHeight;
  const top = 1 - 2 * (90 / H), bottom = -1 + 2 * (150 / H), side = 0.96;
  const place = (dist, shift) => {
    controls.target.set(cx, 0, cz + shift);
    camera.position.set(cx, dist * Math.SQRT1_2, cz + shift + dist * Math.SQRT1_2);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    let minY = Infinity, maxY = -Infinity, sideOk = true;
    for (const p of pts) {
      const v = p.clone().project(camera);
      if (Math.abs(v.x) > side || v.z > 1) sideOk = false;
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { fits: sideOk && maxY - minY <= top - bottom, mid: (minY + maxY) / 2 };
  };
  let lo = 2, hi = 200;
  for (let i = 0; i < 40; i++) {                 // closest distance whose projection fits
    const mid = (lo + hi) / 2;
    if (place(mid, 0).fits) hi = mid; else lo = mid;
  }
  // slide the target along the floor so the room sits centred in the free area
  let shift = 0;
  for (let i = 0; i < 20; i++) {
    // room drawn too high on screen -> move the target away from the camera (towards -z)
    shift -= (place(hi, shift).mid - (top + bottom) / 2) * (b.maxY - b.minY) * 0.5;
    shift = Math.max(-(b.maxY - b.minY), Math.min(b.maxY - b.minY, shift));
  }
  place(hi, shift);
  controls.maxDistance = hi * 2.5;
  controls.minDistance = Math.min(controls.minDistance, hi * 0.3);
  controls.update();
}

// Per-episode scene objects (walls, goal, objects) are rebuilt when the episode changes.
const episodeGroup = new THREE.Group();
scene.add(episodeGroup);
let robotMesh = null, humanMeshes = [], goalMesh = null;

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    if (c.userData.mixer) { c.userData.mixer.stopAllAction(); c.userData.mixer.uncacheRoot(c.userData.mixer.getRoot()); }
    c.traverse(m => {
      if (m.isSprite) { m.material.dispose(); return; }        // face textures are shared, only the material goes
      if (!m.isMesh) return;
      if (m.isSkinnedMesh && m.skeleton) m.skeleton.dispose();  // frees the per-person bone texture on the GPU
      if (!m.userData.sharedGeometry) m.geometry.dispose();   // model geometry is shared with the template
      m.material.dispose();
    });
  }
}

function buildEpisode(ep) {
  clearGroup(episodeGroup);
  const rb = roomBounds(ep);
  const room = new THREE.Mesh(new THREE.PlaneGeometry(rb.maxX - rb.minX, rb.maxY - rb.minY), std(0xe4dfd2));
  room.rotation.x = -Math.PI / 2;
  room.position.set((rb.maxX + rb.minX) / 2, 0.002, -(rb.maxY + rb.minY) / 2);
  room.receiveShadow = true;
  episodeGroup.add(room);
  // Rooms without walls in the simulation (SARL) get decorative walls just outside the floor edge.
  let wallSegments = ep.scene.walls;
  if (!wallSegments.length && CONFIG.decorativeWalls) {
    const t = 0.075;                                   // half the wall thickness: keep the floor clear
    const [x0, x1, y0, y1] = [rb.minX - t, rb.maxX + t, rb.minY - t, rb.maxY + t];
    wallSegments = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
  }
  for (const [[x1, y1], [x2, y2]] of wallSegments) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.15, 0.4, 0.15), std(0x7a7f8c));
    wall.position.set((x1 + x2) / 2, 0.2, -(y1 + y2) / 2);
    wall.rotation.y = Math.atan2(y2 - y1, x2 - x1);
    episodeGroup.add(shadowed(wall));
  }
  for (const o of ep.scene.objects) episodeGroup.add(shadowed(makeObject(o)));
  const [gx, gy] = ep.scene.goal;
  const goal = new THREE.Mesh(new THREE.RingGeometry(ep.scene.goal_radius * 0.6, ep.scene.goal_radius, 40),
    new THREE.MeshBasicMaterial({ color: 0x1f9d55, side: THREE.DoubleSide }));
  goal.rotation.x = -Math.PI / 2;
  goal.position.set(gx, 0.01, -gy);
  episodeGroup.add(goal);
  goalMesh = goal;

  robotMesh = makeRobot(ep.robot.radius);
  episodeGroup.add(robotMesh);
  humanMeshes = ep.humans.map((h, i) => {
    if (i === 0) setRoomClipping(ep);
    const m = makeHuman(h, i, ep.seed);
    m.userData.proxemics = makeProxemicZones(h.radius);
    m.add(m.userData.proxemics);
    m.userData.attentionHalo = makeAttentionHalo(h.radius);
    m.userData.reaction = makeReaction();
    m.add(m.userData.attentionHalo, m.userData.reaction);
    episodeGroup.add(m);
    return m;
  });
}

// ---------------------------------------------------------------------------
// Live room: people walk with ORCA and the robot decides with SARL, without end (world.js, sarl.js)
// ---------------------------------------------------------------------------
const worldAvailable = typeof World !== 'undefined' && typeof SARL !== 'undefined' && SARL.available
  && !!data.index.simulation && !!data.index.rooms;

const sim = {
  world: null, room: null, runner: null, job: null,
  clock: 0, prev: null, curr: null,
  shownDecision: null, shownHeading: 0, shownKey: 0,
  attentionPrev: null, attentionCurr: null,
  flashKind: null, flashUntil: 0,
};

function snapshot(w) {
  return {
    robot: { x: w.robot.x, y: w.robot.y, theta: w.robot.theta, active: w.robotActive },
    humans: w.humans.map(h => ({ x: h.x, y: h.y, theta: h.theta, speed: h.speed })),
    goal: [w.robot.gx, w.robot.gy],
  };
}

/** Puts the room back in its starting state, with the network of the checkpoint on the slider. */
function resetWorld() {
  const seed = episodeAt(state.checkpoint, state.episode).seed;
  sim.room = data.index.rooms[String(seed)];
  sim.world = new World(sim.room, { ...data.index.simulation, collision_pause: CONFIG.world.collisionPause }, seed);
  sim.prev = sim.curr = snapshot(sim.world);
  sim.clock = 0;
  sim.job = null;
  sim.shownDecision = null;
  sim.attentionPrev = sim.attentionCurr = null;
  sim.flashKind = null;
  sim.runner = SARL.runnerFor(state.checkpoint, data.index.simulation);
  state.builtFor = null;
}

function useCheckpointNetwork() {
  sim.runner = SARL.runnerFor(state.checkpoint, data.index.simulation);
  sim.job = null;                                     // a pending decision belongs to the previous network
}

/** Layout the scene builder needs: the room, its people and the current goal. */
function worldLayout() {
  return {
    seed: episodeAt(state.checkpoint, state.episode).seed,
    scene: { ...sim.room.scene, goal: sim.curr.goal },
    robot: { radius: sim.room.robot.radius },
    humans: sim.room.humans.map(h => ({ id: h.id, radius: h.radius })),
  };
}

/** Moves the live room forward by `elapsed` seconds. The robot thinks over several frames. */
function advanceWorld(elapsed) {
  const w = sim.world, dt = w.s.time_step;
  sim.clock += elapsed;
  if (!sim.job) {
    const r = w.robot;
    const atGoal = Math.hypot(r.x - r.gx, r.y - r.gy) < r.radius;
    sim.job = (!w.robotActive || atGoal)
      ? { result: { index: 0, values: null, attention: null }, work: () => true }
      : sim.runner.startDecision(w.robotState(), w.peopleState());
    if (sim.job.result === null || sim.job.result.attention) sim.attentionCurr = null;
  }
  sim.job.work(CONFIG.world.movesPerFrame);
  if (sim.job.result && sim.job.result.attention && !sim.attentionCurr) sim.attentionCurr = sim.job.result.attention;
  if (sim.clock < dt) return;
  if (!sim.job.result) { sim.clock = dt; return; }    // still thinking: hold on the current step

  const decision = sim.job.result;
  const heading = w.robot.theta;
  w.step(sim.runner.actions[decision.index], CONFIG.world.minGoalDistance);
  sim.job = null;
  sim.clock = Math.min(sim.clock - dt, dt);
  sim.prev = sim.curr;
  sim.curr = snapshot(w);
  if (!sim.prev.robot.active && sim.curr.robot.active) sim.prev = { ...sim.prev, robot: sim.curr.robot };   // reappeared
  sim.shownDecision = decision.values ? { values: decision.values, chosen: decision.index } : null;
  sim.shownHeading = heading;
  sim.shownKey += 1;
  sim.attentionPrev = decision.attention || sim.attentionPrev;
  sim.attentionCurr = null;
  for (const event of w.events.splice(0)) {
    sim.flashKind = event.kind;
    sim.flashUntil = performance.now() + CONFIG.world.outcomeSeconds * 1000;
  }
}

/** Draws the live room between the last two steps. */
function renderWorld(dt) {
  const s = sim.world.s, a = Math.min(1, sim.clock / s.time_step), P = sim.prev, C = sim.curr;
  const lerp = (u, v) => u + (v - u) * a;
  const [x0, x1, y0, y1] = s.map;
  const rx = Math.min(x1, Math.max(x0, lerp(P.robot.x, C.robot.x)));   // stop at the wall when leaving the room
  const ry = Math.min(y1, Math.max(y0, lerp(P.robot.y, C.robot.y)));
  robotMesh.position.set(rx, 0, -ry);
  robotMesh.rotation.y = lerpAngle(P.robot.theta, C.robot.theta, a);
  robotMesh.userData.lidar.rotation.y += dt * 12;
  goalMesh.position.set(C.goal[0], 0.01, -C.goal[1]);

  C.humans.forEach((h, i) => {
    const m = humanMeshes[i], p = P.humans[i];
    m.position.set(lerp(p.x, h.x), 0, -lerp(p.y, h.y));
    m.rotation.y = lerpAngle(p.theta, h.theta, a);
    m.userData.speed = h.speed;
    animateHuman(m, state.playing ? h.speed : 0, state.playing ? dt * CONFIG.playbackSpeed : 0);
  });
  separateHumans(humanMeshes, CONFIG.humanVisualSeparation);
  const levels = humanMeshes.map((m, i) => personalSpaceLevel(m, sim.room.humans[i].radius, robotMesh.position, sim.room.robot.radius));
  updateProxemicZones(levels);
  updateReactions(levels, clock.elapsedTime, ui.showReactions.checked);
  drawAttention(sim.attentionPrev, sim.attentionCurr || sim.attentionPrev, a, ui.showAttention.checked);
  drawOptionFan(sim.runner.actions, sim.shownDecision, sim.shownHeading,
                sim.room.robot.radius, sim.shownKey, ui.showOptions.checked && C.robot.active);

  const flashing = sim.flashKind && performance.now() < sim.flashUntil;
  ui.outcome.className = 'outcome ' + (sim.flashKind || '') + (flashing ? ' show' : '');
  ui.outcome.textContent = CONFIG.outcomeText[sim.flashKind] || '';
}

// Click on the floor to place the goal there (a drag turns the camera instead).
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let pressedAt = null;

renderer.domElement.addEventListener('pointerdown', (ev) => { pressedAt = { x: ev.clientX, y: ev.clientY }; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!worldAvailable || !pressedAt) return;
  const moved = Math.hypot(ev.clientX - pressedAt.x, ev.clientY - pressedAt.y);
  pressedAt = null;
  if (moved > 6) return;
  pointer.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(floorPlane, hit)) return;
  const [x0, x1, y0, y1] = data.index.simulation.map;
  const margin = CONFIG.liveGoalMargin;
  const x = Math.min(x1 - margin, Math.max(x0 + margin, hit.x));
  const y = Math.min(y1 - margin, Math.max(y0 + margin, -hit.z));
  if (Math.abs(hit.x - x) > 1 || Math.abs(-hit.z - y) > 1) return;      // clicked well outside the room
  sim.world.setRobotGoal(x, y);
  sim.curr.goal = [x, y];
  sim.job = null;                                     // decide again towards the new goal
});

// ---------------------------------------------------------------------------
// Playback state
// ---------------------------------------------------------------------------
const state = { checkpoint: 0, episode: 0, time: 0, playing: true, builtFor: null };

const ui = {
  outcome: document.getElementById('outcome'),
  sceneLabel: document.getElementById('scene-label'),
  progress: document.getElementById('progress'),
  progressText: document.getElementById('progress-text'),
  play: document.getElementById('play'),
  showZones: document.getElementById('show-zones'),
  showCurves: document.getElementById('show-curves'),
  showOptions: document.getElementById('show-options'),
  showRewards: document.getElementById('show-rewards'),
  showAttention: document.getElementById('show-attention'),
  attentionToggle: document.getElementById('attention-toggle'),
  attentionLegend: document.getElementById('attention-legend'),
  showReactions: document.getElementById('show-reactions'),
  liveBar: document.getElementById('live-bar'),
  hint: document.getElementById('hint'),
  rewardsToggle: document.getElementById('rewards-toggle'),
  rewards: document.getElementById('rewards'),
  optionsToggle: document.getElementById('options-toggle'),
  optionsLegend: document.getElementById('options-legend'),
  curves: document.getElementById('curves'),
  curvesCanvas: document.getElementById('curves-canvas'),
  curvesSeries: document.getElementById('curves-series'),
  legend: document.getElementById('legend'),
};
ui.attentionToggle.hidden = !hasAttention;
ui.showAttention.checked = hasAttention && CONFIG.attention.showByDefault;
ui.attentionLegend.innerHTML = '<div class="legend-title">Attention du robot</div>' +
  `<div class="legend-row attention-row"><span class="swatch halo" style="--c:${CONFIG.attention.color}"></span>` +
  '<span>Plus le halo brille, plus le robot surveille cette personne</span></div>';
ui.attentionLegend.hidden = !ui.showAttention.checked;
ui.showAttention.addEventListener('change', () => {
  ui.attentionLegend.hidden = !ui.showAttention.checked;
  ui.showAttention.blur();
});
ui.showReactions.checked = CONFIG.reactions.showByDefault;
ui.showReactions.addEventListener('change', () => ui.showReactions.blur());
ui.rewardsToggle.hidden = !rewardRules;
ui.showRewards.checked = !!rewardRules && CONFIG.rewards.showByDefault;
buildRewardsPanel();
ui.rewards.hidden = !ui.showRewards.checked;
ui.showRewards.addEventListener('change', () => {
  ui.rewards.hidden = !ui.showRewards.checked;
  ui.showRewards.blur();
});
ui.optionsToggle.hidden = !hasDecisions;
ui.showOptions.checked = hasDecisions && CONFIG.options.showByDefault;
buildOptionsLegend();
ui.optionsLegend.hidden = !ui.showOptions.checked;
ui.showOptions.addEventListener('change', () => {
  ui.optionsLegend.hidden = !ui.showOptions.checked;
  if (!ui.showOptions.checked) optionFan.visible = false;   // immediately, even between frames
  ui.showOptions.blur();
});
updateHint();
ui.showCurves.checked = CONFIG.curves.showByDefault;
ui.curves.hidden = !ui.showCurves.checked;
buildCurvesPanel();
ui.showCurves.addEventListener('change', () => {
  ui.curves.hidden = !ui.showCurves.checked;
  ui.showCurves.blur();
  drawCurves();
});
ui.showZones.checked = CONFIG.proxemics.showByDefault;
buildLegend();
ui.legend.hidden = !ui.showZones.checked;
ui.showZones.addEventListener('change', () => {
  setZonesVisible(ui.showZones.checked);
  ui.showZones.blur();                                  // keep the space bar for play / pause
});
ui.progress.max = nCheckpoints - 1;

function setEpisode(c, e) {
  state.checkpoint = (c + nCheckpoints) % nCheckpoints;
  state.episode = (e + nEpisodes) % nEpisodes;
  state.time = 0;
  if (sim.world) useCheckpointNetwork();        // the room keeps going with this stage of training
  ui.progress.value = state.checkpoint;
  const count = episodeCount(state.checkpoint);
  ui.progressText.textContent = count === null
    ? Math.round(100 * state.checkpoint / Math.max(1, nCheckpoints - 1)) + ' %'
    : `Essai ${formatCount(count)}`;
  ui.sceneLabel.textContent = `Salle ${state.episode + 1} sur ${nEpisodes}`;
  ui.sceneLabel.hidden = nEpisodes < 2;                // nothing to choose between with a single room
  drawCurves();
}

function updateHint() {
  ui.liveBar.hidden = !worldAvailable;
  ui.hint.textContent = 'Cliquez sur le sol pour déplacer l\u2019objectif';
}

ui.progress.addEventListener('input', () => setEpisode(+ui.progress.value, state.episode));
ui.play.addEventListener('click', () => { state.playing = !state.playing; });
// Presenter guide ("?" button): guide.html in an overlay, loaded on first open
const help = {
  button: document.getElementById('help-button'),
  overlay: document.getElementById('help-overlay'),
  frame: document.getElementById('help-frame'),
  close: document.getElementById('help-close'),
};
function openHelp() {
  if (!help.frame.getAttribute('src')) help.frame.setAttribute('src', 'guide.html');
  help.overlay.hidden = false;
  help.close.focus();
}
function closeHelp() {
  help.overlay.hidden = true;
  help.button.blur();
}
help.button.addEventListener('click', openHelp);
help.close.addEventListener('click', closeHelp);
help.overlay.addEventListener('click', (ev) => { if (ev.target === help.overlay) closeHelp(); });

window.addEventListener('keydown', (ev) => {
  if (!help.overlay.hidden) {                         // the demo ignores keys while the guide is open
    if (ev.key === 'Escape') closeHelp();
    return;
  }
  if (ev.key === 'ArrowRight') setEpisode(state.checkpoint, state.episode + 1);
  else if (ev.key === 'ArrowLeft') setEpisode(state.checkpoint, state.episode - 1);
  else if (ev.key === 'ArrowUp') setEpisode(state.checkpoint + 1, state.episode);
  else if (ev.key === 'ArrowDown') setEpisode(state.checkpoint - 1, state.episode);
  else if (ev.key === ' ') { state.playing = !state.playing; ev.preventDefault(); }
  else if (ev.key === 'r' || ev.key === 'R') {
    setEpisode(0, 0);
    if (worldAvailable) resetWorld();
    state.playing = true;
    fitCamera(episodeAt(0, 0));
  }
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const loadingEl = document.getElementById('loading');
// URL parameters for jumping straight to a moment: ?checkpoint=19&episode=2&t=8&paused=1
setEpisode(+(params.get('checkpoint') || 0), +(params.get('episode') || 0));
if (params.has('t')) state.time = +params.get('t');
if (params.get('paused') === '1') state.playing = false;

function tick() {
  const dt = Math.min(0.1, clock.getDelta());
  if (sim.world) {
    if (state.builtFor !== 'world') { buildEpisode(worldLayout()); state.builtFor = 'world'; }
    if (state.playing) advanceWorld(dt * CONFIG.playbackSpeed);
    renderWorld(dt);
    ui.play.textContent = state.playing ? '❚❚' : '▶';
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
    return;
  }

  if (state.playing) state.time += dt * CONFIG.playbackSpeed;
  const ep = episodeAt(state.checkpoint, state.episode);
  const key = state.checkpoint + ':' + state.episode;
  if (state.builtFor !== key) { buildEpisode(ep); state.builtFor = key; }

  const duration = ep.n_steps * ep.dt;
  if (state.time > duration + CONFIG.holdEndSeconds) {
    // Same room, next stage of training; after the last one, move to the next room.
    setEpisode(state.checkpoint + 1, state.checkpoint + 1 >= nCheckpoints ? state.episode + 1 : state.episode);
    requestAnimationFrame(tick);
    return;
  }
  const f = Math.min(state.time, duration) / ep.dt;

  let [rx, ry, rt] = sampleFrames(ep.robot.frames, f);
  if (CONFIG.decorativeWalls && !ep.scene.walls.length && ep.scene.bounds) {
    // Steps are 25 cm, so the last recorded position can be past the map edge. Stop the drawn robot
    // where its edge meets the decorative wall instead of letting it sink into it.
    const [bx0, bx1, by0, by1] = ep.scene.bounds;
    rx = Math.min(bx1, Math.max(bx0, rx));
    ry = Math.min(by1, Math.max(by0, ry));
  }
  robotMesh.position.set(rx, 0, -ry);
  robotMesh.rotation.y = rt;
  robotMesh.userData.lidar.rotation.y += dt * 12;   // LiDAR spins even when parked

  ep.humans.forEach((h, i) => {
    const [x, y, th] = sampleFrames(h.frames, f);
    const [xa, ya] = sampleFrames(h.frames, f - 0.5);
    const [xb, yb] = sampleFrames(h.frames, f + 0.5);
    const m = humanMeshes[i];
    const span = (Math.min(f + 0.5, h.frames.length - 1) - Math.max(f - 0.5, 0)) * ep.dt;
    const speed = state.time < duration && span > 0 ? Math.hypot(xb - xa, yb - ya) / span : 0;
    m.position.set(x, 0, -y);
    m.rotation.y = th;
    m.userData.speed = speed;
    animateHuman(m, speed, state.playing ? dt * CONFIG.playbackSpeed : 0);
  });
  separateHumans(humanMeshes, CONFIG.humanVisualSeparation);
  const levels = humanMeshes.map((m, i) => personalSpaceLevel(m, ep.humans[i].radius, robotMesh.position, ep.robot.radius));
  updateProxemicZones(levels);
  updateReactions(levels, clock.elapsedTime, ui.showReactions.checked);
  updateAttention(ep, f, ui.showAttention.checked);
  updateOptionFan(ep, Math.min(Math.floor(f), ep.n_steps - 1), ui.showOptions.checked && state.time < duration);

  const done = state.time >= duration;
  const shown = CONFIG.outcomeDisplayAs[ep.outcome] || ep.outcome;
  ui.outcome.className = 'outcome ' + shown + (done && shown ? ' show' : '');
  ui.outcome.textContent = CONFIG.outcomeText[shown] || '';
  ui.play.textContent = state.playing ? '❚❚' : '▶';

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
afterResize = () => { fitCamera(episodeAt(state.checkpoint, state.episode)); drawCurves(); };
afterResize();
loadHumanModels().then(() => {
  loadingEl.hidden = true;
  if (worldAvailable) resetWorld();
  clock.getDelta();
  requestAnimationFrame(tick);
});
