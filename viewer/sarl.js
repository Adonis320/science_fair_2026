/* SARL running in the browser: the robot of the live room (world.js) decides with it.

   Same computation as CrowdNav's SARL (crowd_nav/policy/sarl.py) and the same weights:
   for each candidate move, predict where everyone will be one step later (people at constant
   velocity), score that situation with the value network, and keep the best.

   Weights come from weights.js (float16, see training/export_weights.py). */
'use strict';

const SARL = (() => {
  const SELF_STATE_DIM = 6;                          // dg, v_pref, theta, radius, vx, vy
  const ROTATED_DIM = 13;

  // --- float16 -> float32, one value at a time -----------------------------------------------
  function f16(bits) {
    const sign = (bits & 0x8000) ? -1 : 1;
    const exp = (bits >> 10) & 0x1f;
    const frac = bits & 0x3ff;
    if (exp === 0) return sign * frac * 5.9604644775390625e-8;      // subnormal: 2^-24
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
  }

  function decodeCheckpoint(entry, layerShapes) {
    const raw = atob(entry.data);
    const u16 = new Uint16Array(raw.length / 2);
    for (let i = 0; i < u16.length; i++) u16[i] = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8);
    const layers = {};
    let at = 0;
    for (const [name, [out, inp]] of layerShapes) {
      const weight = new Float32Array(out * inp);
      for (let i = 0; i < weight.length; i++) weight[i] = f16(u16[at + i]);
      at += weight.length;
      const bias = new Float32Array(out);
      for (let i = 0; i < out; i++) bias[i] = f16(u16[at + i]);
      at += out;
      layers[name] = { weight, bias, out, inp };
    }
    return layers;
  }

  // --- dense layer over `rows` samples, optional ReLU ------------------------------------------
  function linear(layer, input, rows, output, relu) {
    const { weight, bias, out, inp } = layer;
    for (let r = 0; r < rows; r++) {
      const src = r * inp, dst = r * out;
      for (let o = 0; o < out; o++) {
        let sum = bias[o];
        const w = o * inp;
        for (let i = 0; i < inp; i++) sum += weight[w + i] * input[src + i];
        output[dst + o] = relu && sum < 0 ? 0 : sum;
      }
    }
    return output;
  }

  /** The value network of SARL: attention over people, then one value per candidate situation. */
  class ValueNetwork {
    constructor(layers) {
      this.layers = layers;
      this.buffers = {};
    }

    buffer(name, size) {
      let b = this.buffers[name];
      if (!b || b.length < size) b = this.buffers[name] = new Float32Array(size);
      return b;
    }

    /** rotated: (groups x people x 13) agent-centric rows. Returns one value per group. */
    forward(rotated, groups, people) {
      const L = this.layers, rows = groups * people;
      const h1 = linear(L['mlp1.0'], rotated, rows, this.buffer('h1', rows * 150), true);
      const e1 = linear(L['mlp1.2'], h1, rows, this.buffer('e1', rows * 100), true);       // embedding
      const m2a = linear(L['mlp2.0'], e1, rows, this.buffer('m2a', rows * 100), true);
      const feat = linear(L['mlp2.2'], m2a, rows, this.buffer('feat', rows * 50), false);

      // attention input: each person's embedding next to the group's mean embedding
      const attIn = this.buffer('attIn', rows * 200);
      for (let g = 0; g < groups; g++) {
        const mean = this.buffer('mean', 100);
        mean.fill(0, 0, 100);
        for (let p = 0; p < people; p++) {
          const src = (g * people + p) * 100;
          for (let i = 0; i < 100; i++) mean[i] += e1[src + i];
        }
        for (let i = 0; i < 100; i++) mean[i] /= people;
        for (let p = 0; p < people; p++) {
          const src = (g * people + p) * 100, dst = (g * people + p) * 200;
          for (let i = 0; i < 100; i++) { attIn[dst + i] = e1[src + i]; attIn[dst + 100 + i] = mean[i]; }
        }
      }
      const a1 = linear(L['attention.0'], attIn, rows, this.buffer('a1', rows * 100), true);
      const a2 = linear(L['attention.2'], a1, rows, this.buffer('a2', rows * 100), true);
      const scores = linear(L['attention.4'], a2, rows, this.buffer('scores', rows), false);

      // masked softmax, as in CrowdNav: a score of exactly 0 means "no person here"
      const weights = this.buffer('weights', rows);
      for (let g = 0; g < groups; g++) {
        let total = 0;
        for (let p = 0; p < people; p++) {
          const i = g * people + p;
          weights[i] = scores[i] === 0 ? 0 : Math.exp(scores[i]);
          total += weights[i];
        }
        for (let p = 0; p < people; p++) weights[g * people + p] /= total || 1;
      }
      this.attentionWeights = weights;

      // value of each group: its own state plus the weighted sum of the people's features
      const joint = this.buffer('joint', groups * (SELF_STATE_DIM + 50));
      for (let g = 0; g < groups; g++) {
        const dst = g * (SELF_STATE_DIM + 50);
        for (let i = 0; i < SELF_STATE_DIM; i++) joint[dst + i] = rotated[g * people * ROTATED_DIM + i];
        for (let i = 0; i < 50; i++) joint[dst + SELF_STATE_DIM + i] = 0;
        for (let p = 0; p < people; p++) {
          const w = weights[g * people + p], src = (g * people + p) * 50;
          for (let i = 0; i < 50; i++) joint[dst + SELF_STATE_DIM + i] += w * feat[src + i];
        }
      }
      const v1 = linear(L['mlp3.0'], joint, groups, this.buffer('v1', groups * 150), true);
      const v2 = linear(L['mlp3.2'], v1, groups, this.buffer('v2', groups * 100), true);
      const v3 = linear(L['mlp3.4'], v2, groups, this.buffer('v3', groups * 100), true);
      return linear(L['mlp3.6'], v3, groups, this.buffer('value', groups), false);
    }
  }

  /** CrowdNav's action space: 5 speeds (exponentially spaced) x 16 turns in [-45, +45] degrees, plus stop. */
  function buildActionSpace(vPref, speedSamples = 5, rotationSamples = 16) {
    const actions = [[0, 0]];
    const speeds = [];
    for (let i = 0; i < speedSamples; i++) speeds.push((Math.exp((i + 1) / speedSamples) - 1) / (Math.E - 1) * vPref);
    for (let j = 0; j < rotationSamples; j++) {
      const turn = -Math.PI / 4 + (j / (rotationSamples - 1)) * (Math.PI / 2);
      for (const speed of speeds) actions.push([speed, turn]);
    }
    return actions;
  }

  /** Agent-centric rows (CADRL.rotate): one per (candidate situation, person). */
  function rotateInto(out, robots, people, groups, nPeople) {
    for (let g = 0; g < groups; g++) {
      const r = robots[g];
      const dx = r.gx - r.px, dy = r.gy - r.py;
      const rot = Math.atan2(dy, dx), c = Math.cos(rot), s = Math.sin(rot);
      const dg = Math.hypot(dx, dy);
      const vx = r.vx * c + r.vy * s, vy = r.vy * c - r.vx * s;
      let theta = r.theta - rot;
      for (let p = 0; p < nPeople; p++) {
        const h = people[p], base = (g * nPeople + p) * ROTATED_DIM;
        const hx = h.px - r.px, hy = h.py - r.py;
        out[base] = dg;
        out[base + 1] = r.vPref;
        out[base + 2] = theta;
        out[base + 3] = r.radius;
        out[base + 4] = vx;
        out[base + 5] = vy;
        out[base + 6] = hx * c + hy * s;
        out[base + 7] = hy * c - hx * s;
        out[base + 8] = h.vx * c + h.vy * s;
        out[base + 9] = h.vy * c - h.vx * s;
        out[base + 10] = h.radius;
        out[base + 11] = Math.hypot(hx, hy);
        out[base + 12] = r.radius + h.radius;
      }
    }
    return out;
  }

  /** One robot, its policy and the rules of the simulation. */
  class Runner {
    constructor(settings, layers) {
      this.settings = settings;
      this.net = new ValueNetwork(layers);
      this.actions = buildActionSpace(settings.v_pref);
      this.gamma = settings.gamma;
      this.rotated = new Float32Array(this.actions.length * 16 * ROTATED_DIM);
    }

    /** Scores every move for this situation. Returns {index, values, attention}. */
    decide(robot, people) {
      const job = this.startDecision(robot, people);
      while (!job.work(this.actions.length)) { /* one call scores everything */ }
      return job.result;
    }

    /** Same as decide(), spread over several calls to work(n) so a frame never waits for all 81 moves. */
    startDecision(robot, people) {
      const st = this.settings, dt = st.time_step, n = people.length;
      const nextPeople = people.map(h => ({ px: h.px + h.vx * dt, py: h.py + h.vy * dt, vx: h.vx, vy: h.vy, radius: h.radius }));

      // attention is reported for the situation as it is now, which is what the viewer draws
      const now = rotateInto(this.rotated, [robot], people, 1, n);
      this.net.forward(now, 1, n);
      const attention = Array.from(this.net.attentionWeights.slice(0, n));

      const candidates = this.actions.map(([v, turn]) => {
        const theta = robot.theta + turn;
        const vx = v * Math.cos(theta), vy = v * Math.sin(theta);
        return { px: robot.px + vx * dt, py: robot.py + vy * dt, vx, vy, theta,
                 radius: robot.radius, gx: robot.gx, gy: robot.gy, vPref: robot.vPref };
      });
      const rewards = candidates.map(c => {
        let dmin = Infinity, hit = false;
        for (const h of nextPeople) {
          const d = Math.hypot(c.px - h.px, c.py - h.py) - c.radius - h.radius;
          if (d < 0) { hit = true; break; }
          dmin = Math.min(dmin, d);
        }
        if (hit) return st.collision_reward;
        if (Math.hypot(c.px - c.gx, c.py - c.gy) < c.radius) return st.success_reward;
        return dmin < st.discomfort_dist ? (dmin - st.discomfort_dist) * st.discomfort_factor * dt : 0;
      });

      const discount = Math.pow(this.gamma, dt * robot.vPref);
      const scored = new Array(candidates.length);
      let done = 0;
      const job = {
        result: null,
        work: (budget) => {
          if (job.result) return true;
          const count = Math.min(budget, candidates.length - done);
          const batch = candidates.slice(done, done + count);
          const rotated = rotateInto(this.rotated, batch, nextPeople, count, n);
          const values = this.net.forward(rotated, count, n);
          for (let i = 0; i < count; i++) scored[done + i] = rewards[done + i] + discount * values[i];
          done += count;
          if (done < candidates.length) return false;
          let best = 0;
          for (let i = 1; i < scored.length; i++) if (scored[i] > scored[best]) best = i;
          job.result = { index: best, values: scored, attention };
          return true;
        },
      };
      return job;
    }

  }

  const cache = new Map();
  /** Runner for a checkpoint index, decoding its weights the first time it is used. */
  function runnerFor(checkpointIndex, settings) {
    if (!cache.has(checkpointIndex)) {
      const w = SARL_WEIGHTS;
      const entry = w.checkpoints[Math.min(checkpointIndex, w.checkpoints.length - 1)];
      cache.set(checkpointIndex, new Runner({ ...settings, gamma: w.gamma }, decodeCheckpoint(entry, w.layers)));
    }
    return cache.get(checkpointIndex);
  }

  return { Runner, runnerFor, buildActionSpace, available: typeof SARL_WEIGHTS !== 'undefined' };
})();
