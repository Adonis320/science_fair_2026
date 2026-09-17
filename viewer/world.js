/* The room simulated live in the browser: people walking with ORCA, the robot driven by SARL.

   People follow SocNavGym's rules (socnavgym/envs/socnavenv_v1.py):
   - each person gets a velocity from ORCA (RVO2, ported below), computed as if everyone else stood
     still, exactly as SocNavGym builds a fresh RVO simulator per person with zero velocities;
   - they cannot turn faster than pi/2 rad/s: a person who needs a sharper turn stops and pivots;
   - they ignore the robot, but stop for a step when they touch it;
   - when close to their goal they get a new one, drawn anywhere in the room away from bodies and goals.
   The robot steps with SARL's move, gets a new goal when it arrives or runs out of time, and is placed
   somewhere free again after a collision. The world never ends. */
'use strict';

const ORCA = (() => {
  const EPSILON = 0.00001;
  const det = (ax, ay, bx, by) => ax * by - ay * bx;

  function linearProgram1(lines, lineNo, radius, optX, optY, directionOpt, result) {
    const L = lines[lineNo];
    const dot = L.px * L.dx + L.py * L.dy;
    const discriminant = dot * dot + radius * radius - (L.px * L.px + L.py * L.py);
    if (discriminant < 0) return false;
    const root = Math.sqrt(discriminant);
    let tLeft = -dot - root, tRight = -dot + root;
    for (let i = 0; i < lineNo; i++) {
      const M = lines[i];
      const denominator = det(L.dx, L.dy, M.dx, M.dy);
      const numerator = det(M.dx, M.dy, L.px - M.px, L.py - M.py);
      if (Math.abs(denominator) <= EPSILON) {
        if (numerator < 0) return false;
        continue;
      }
      const t = numerator / denominator;
      if (denominator >= 0) tRight = Math.min(tRight, t);
      else tLeft = Math.max(tLeft, t);
      if (tLeft > tRight) return false;
    }
    let t;
    if (directionOpt) t = optX * L.dx + optY * L.dy > 0 ? tRight : tLeft;
    else {
      t = L.dx * (optX - L.px) + L.dy * (optY - L.py);
      t = t < tLeft ? tLeft : t > tRight ? tRight : t;
    }
    result.x = L.px + t * L.dx;
    result.y = L.py + t * L.dy;
    return true;
  }

  function linearProgram2(lines, radius, optX, optY, directionOpt, result) {
    if (directionOpt) { result.x = optX * radius; result.y = optY * radius; }
    else if (optX * optX + optY * optY > radius * radius) {
      const n = Math.hypot(optX, optY);
      result.x = optX / n * radius; result.y = optY / n * radius;
    } else { result.x = optX; result.y = optY; }
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (det(L.dx, L.dy, L.px - result.x, L.py - result.y) > 0) {
        const tx = result.x, ty = result.y;
        if (!linearProgram1(lines, i, radius, optX, optY, directionOpt, result)) {
          result.x = tx; result.y = ty;
          return i;
        }
      }
    }
    return lines.length;
  }

  function linearProgram3(lines, beginLine, radius, result) {
    let distance = 0;
    for (let i = beginLine; i < lines.length; i++) {
      const L = lines[i];
      if (det(L.dx, L.dy, L.px - result.x, L.py - result.y) > distance) {
        const projLines = [];
        for (let j = 0; j < i; j++) {
          const M = lines[j];
          const determinant = det(L.dx, L.dy, M.dx, M.dy);
          let px, py;
          if (Math.abs(determinant) <= EPSILON) {
            if (L.dx * M.dx + L.dy * M.dy > 0) continue;
            px = 0.5 * (L.px + M.px); py = 0.5 * (L.py + M.py);
          } else {
            const s = det(M.dx, M.dy, L.px - M.px, L.py - M.py) / determinant;
            px = L.px + s * L.dx; py = L.py + s * L.dy;
          }
          const ddx = M.dx - L.dx, ddy = M.dy - L.dy, n = Math.hypot(ddx, ddy) || 1;
          projLines.push({ px, py, dx: ddx / n, dy: ddy / n });
        }
        const tx = result.x, ty = result.y;
        if (linearProgram2(projLines, radius, -L.dy, L.dx, true, result) < projLines.length) {
          result.x = tx; result.y = ty;
        }
        distance = det(L.dx, L.dy, L.px - result.x, L.py - result.y);
      }
    }
  }

  /** New velocity for `self` among `others` ({x, y, radius}), everyone assumed still, as SocNavGym does. */
  function velocity(self, others, prefX, prefY, p) {
    const invTimeHorizon = 1 / p.timeHorizon, invTimeStep = 1 / p.timeStep;
    const neighbours = others
      .map(o => ({ o, distSq: (o.x - self.x) ** 2 + (o.y - self.y) ** 2 }))
      .filter(n => n.distSq < p.neighborDist * p.neighborDist)
      .sort((a, b) => a.distSq - b.distSq)
      .slice(0, p.maxNeighbors);
    const lines = [];
    for (const { o, distSq } of neighbours) {
      const rx = o.x - self.x, ry = o.y - self.y;                  // relative position
      const vx = 0, vy = 0;                                        // relative velocity (everyone still)
      const combined = self.radius + o.radius, combinedSq = combined * combined;
      let dx, dy, ux, uy;
      if (distSq > combinedSq) {
        const wx = vx - invTimeHorizon * rx, wy = vy - invTimeHorizon * ry;
        const wLengthSq = wx * wx + wy * wy, dot1 = wx * rx + wy * ry;
        if (dot1 < 0 && dot1 * dot1 > combinedSq * wLengthSq) {
          const wLength = Math.sqrt(wLengthSq), uwx = wx / wLength, uwy = wy / wLength;
          dx = uwy; dy = -uwx;
          ux = (combined * invTimeHorizon - wLength) * uwx; uy = (combined * invTimeHorizon - wLength) * uwy;
        } else {
          const leg = Math.sqrt(distSq - combinedSq);
          if (det(rx, ry, wx, wy) > 0) {
            dx = (rx * leg - ry * combined) / distSq; dy = (rx * combined + ry * leg) / distSq;
          } else {
            dx = -(rx * leg + ry * combined) / distSq; dy = -(-rx * combined + ry * leg) / distSq;
          }
          const dot2 = vx * dx + vy * dy;
          ux = dot2 * dx - vx; uy = dot2 * dy - vy;
        }
      } else {
        const wx = vx - invTimeStep * rx, wy = vy - invTimeStep * ry;
        const wLength = Math.hypot(wx, wy) || EPSILON, uwx = wx / wLength, uwy = wy / wLength;
        dx = uwy; dy = -uwx;
        ux = (combined * invTimeStep - wLength) * uwx; uy = (combined * invTimeStep - wLength) * uwy;
      }
      lines.push({ px: 0.5 * ux, py: 0.5 * uy, dx, dy });         // point = own velocity (0) + u / 2
    }
    const result = { x: 0, y: 0 };
    const fail = linearProgram2(lines, p.maxSpeed, prefX, prefY, false, result);
    if (fail < lines.length) linearProgram3(lines, fail, p.maxSpeed, result);
    return result;
  }

  return { velocity };
})();

/** Small seeded random generator (mulberry32), so a reset always starts the same way. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

class World {
  constructor(room, settings, seed) {
    this.room = room;
    this.s = settings;
    this.random = seededRandom(seed * 2654435761);
    const h = settings.human;
    this.orca = { timeStep: settings.time_step, neighborDist: h.orca.neighbor_dist,
                  timeHorizon: h.orca.time_horizon, maxSpeed: h.max_speed, maxNeighbors: room.humans.length };
    this.humans = room.humans.map(p => ({
      id: p.id, radius: p.radius, x: p.start[0], y: p.start[1], theta: p.start[2], speed: 0,
      gx: p.goal[0], gy: p.goal[1],
    }));
    const [rx, ry, rt] = room.robot.start;
    this.robot = { x: rx, y: ry, theta: rt, v: 0, radius: room.robot.radius,
                   gx: room.robot.goal[0], gy: room.robot.goal[1] };
    this.stepsTowardGoal = 0;
    this.frozenSteps = 0;                     // after a collision the robot waits before reappearing
    this.events = [];                         // {kind: 'success' | 'collision' | 'timeout'}
  }

  /** What SARL observes (CrowdNav JointState fields). */
  robotState() {
    const r = this.robot;
    return { px: r.x, py: r.y, theta: r.theta, vx: r.v * Math.cos(r.theta), vy: r.v * Math.sin(r.theta),
             radius: r.radius, gx: r.gx, gy: r.gy, vPref: this.s.v_pref };
  }

  peopleState() {
    return this.humans.map(h => ({ px: h.x, py: h.y, vx: h.speed * Math.cos(h.theta), vy: h.speed * Math.sin(h.theta),
                                   radius: h.radius }));
  }

  get robotActive() { return this.frozenSteps === 0; }

  /** Random point in the room clear of every body and goal (SocNavGym's sample_goal). */
  sampleFree(radius, extraCheck = () => true) {
    const half = this.s.map[1] - this.s.margin;
    for (let attempt = 0; attempt < 500; attempt++) {
      const x = (this.random() * 2 - 1) * half, y = (this.random() * 2 - 1) * half;
      const clear = (ox, oy, or) => Math.hypot(x - ox, y - oy) > radius + or;
      const r = this.robot;
      if (!clear(r.x, r.y, r.radius) || !clear(r.gx, r.gy, this.s.goal_radius)) continue;
      if (this.humans.some(h => !clear(h.x, h.y, h.radius) || !clear(h.gx, h.gy, this.s.human.goal_radius))) continue;
      if (extraCheck(x, y)) return [x, y];
    }
    return [0, 0];
  }

  setRobotGoal(x, y) {
    this.robot.gx = x;
    this.robot.gy = y;
    this.stepsTowardGoal = 0;
  }

  newRobotGoal(minDistance) {
    const r = this.robot;
    const [x, y] = this.sampleFree(this.s.goal_radius, (gx, gy) => Math.hypot(gx - r.x, gy - r.y) >= minDistance);
    this.setRobotGoal(x, y);
  }

  /** One simulation step: the robot applies `move` ([speed, turn]), then everyone else walks. */
  step(move, minGoalDistance) {
    const s = this.s, dt = s.time_step, r = this.robot;

    // robot (SocNavGym moves it first)
    if (this.robotActive) {
      const [v, turn] = move;
      r.theta = wrapAngle(r.theta + turn);
      r.x += v * Math.cos(r.theta) * dt;
      r.y += v * Math.sin(r.theta) * dt;
      r.v = v;
      this.stepsTowardGoal += 1;
    } else {
      r.v = 0;
    }

    // people: ORCA velocities from where everyone stands now, then turning limits
    const bodies = this.humans.map(h => ({ x: h.x, y: h.y, radius: h.radius }));
    const hp = s.human, maxTurn = hp.max_rotation_speed * dt;
    this.humans.forEach((h, i) => {
      let px = h.gx - h.x, py = h.gy - h.y;
      const n = Math.hypot(px, py);
      if (n > 0) { px = px / n * hp.max_speed; py = py / n * hp.max_speed; }
      const others = bodies.filter((_, j) => j !== i);
      const vel = ORCA.velocity(bodies[i], others, px, py, this.orca);
      const heading = Math.atan2(vel.y, vel.x);
      const diff = wrapAngle(heading - h.theta);
      if (Math.abs(diff) > maxTurn) {
        h.theta = wrapAngle(h.theta + Math.sign(diff) * maxTurn);
        h.speed = 0;
      } else {
        h.theta = heading;
        h.speed = Math.hypot(vel.x, vel.y);
        if (h.speed < hp.speed_threshold) h.speed = 0;
      }
    });

    // new goals for people who arrived
    for (const h of this.humans) {
      if (Math.hypot(h.x - h.gx, h.y - h.gy) < h.radius + hp.goal_radius) {
        [h.gx, h.gy] = this.sampleFree(hp.goal_radius);
      }
    }

    // people touching the robot stop, then everyone moves
    for (const h of this.humans) {
      if (this.robotActive && Math.hypot(h.x - r.x, h.y - r.y) < h.radius + r.radius) h.speed = 0;
      h.x += h.speed * Math.cos(h.theta) * dt;
      h.y += h.speed * Math.sin(h.theta) * dt;
    }

    // how the robot's run went
    if (!this.robotActive) {
      this.frozenSteps -= 1;
      if (this.frozenSteps === 0) this.respawnRobot(minGoalDistance);
      return;
    }
    const [x0, x1, y0, y1] = s.map;
    const outside = r.x < x0 || r.x > x1 || r.y < y0 || r.y > y1;
    const hit = this.humans.some(h => Math.hypot(h.x - r.x, h.y - r.y) < h.radius + r.radius);
    if (outside || hit) {
      this.events.push({ kind: 'collision' });
      this.frozenSteps = Math.max(1, Math.round(s.collision_pause / dt));
    } else if (Math.hypot(r.x - r.gx, r.y - r.gy) < s.goal_threshold) {
      this.events.push({ kind: 'success' });
      this.newRobotGoal(minGoalDistance);
    } else if (this.stepsTowardGoal >= s.episode_length) {
      this.events.push({ kind: 'timeout' });
      this.newRobotGoal(minGoalDistance);
    }
  }

  respawnRobot(minGoalDistance) {
    const r = this.robot;
    const keepAway = 1.0;                     // metres between the robot and anyone when it reappears
    r.x = 1e3; r.y = 1e3;                     // out of the way while a free spot is drawn
    const [x, y] = this.sampleFree(r.radius, (px, py) =>
      this.humans.every(h => Math.hypot(h.x - px, h.y - py) > h.radius + r.radius + keepAway));
    r.x = x; r.y = y; r.theta = (this.random() * 2 - 1) * Math.PI; r.v = 0;
    this.newRobotGoal(minGoalDistance);
  }
}
