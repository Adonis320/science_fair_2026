# SARL (CrowdNav) in SocNavGym

CrowdNav's SARL policy (`crowd_nav/policy/sarl.py`, Chen et al. 2019) trained in a humans-only
SocNavGym room, then played back in the demo viewer.

```bash
conda activate socnavgym
cd ~/Documents/fete_science/demo
python training/sarl/train_sarl.py --run sarl_humans                     # about 100 min on the laptop
python training/evaluate_checkpoints.py training/runs/sarl_humans/checkpoints --episodes 40 --min-start-goal-dist 6
python export_trajectories.py training/runs/sarl_humans/checkpoints --episodes 8 --min-start-goal-dist 6
```

CrowdNav is imported from `/home/adonis/Documents/Thesis/Code/CrowdNav` (override with
`CROWDNAV_ROOT`); nothing in that repository is modified.

## Scenario: `configs/humans_only.yaml`

- 10 x 10 m map, **no walls, no furniture**, 6 walking people (ORCA).
- CrowdNav sizes and timing: 0.25 s steps, radius 0.3 m, robot and people at 1 m/s, 25 s limit.
- People ignore the robot (CrowdNav's invisible robot).
- Leaving the map counts as a collision, like hitting a person.

## What SARL sees and does: `sarl_env.py`

SARL takes CrowdNav's `JointState` and returns `ActionRot(v, r)`. The wrapper builds, after every step:

| CrowdNav field | From SocNavGym |
|---|---|
| robot `FullState(px, py, vx, vy, radius, gx, gy, v_pref, theta)` | `robot.x/y`, last commanded speed along `robot.orientation`, `ROBOT_RADIUS`, `robot.goal_x/y`, `MAX_ADVANCE_ROBOT`, `robot.orientation` |
| each person `ObservableState(px, py, vx, vy, radius)` | `h.x/y`, `h.speed` along `h.orientation`, `h.width / 2` |

All in the world frame; SARL's own `rotate()` makes them agent-centric (13 numbers per person).

Actions: SARL's unicycle action space (5 exponentially spaced speeds x 16 turns in [-pi/4, pi/4],
plus stop = 81 actions). `ActionRot(v, r)` becomes SocNavGym's diff-drive command
`[v / max_advance_robot, 0, (r / time_step) / max_rotation]`. SocNavGym's robot turns first and then
drives, which is CrowdNav's unicycle update; `max_rotation = (pi/4) / time_step` makes the turns fit.

## Policy: `policy.py`, `policy.config`

`BatchedSARL` subclasses CrowdNav's `SARL` and only changes how `predict` searches: all 81 actions in
one forward pass instead of one pass each. Tested against CrowdNav's `predict`: 52 of 52 decisions identical.

`policy.config` is CrowdNav's with two changes:
- `kinematics = unicycle` (diff-drive robot; CrowdNav's default is holonomic),
- `query_env = false`: people are predicted at constant velocity for the lookahead, SARL's standard
  mode when the simulator cannot be queried. Copying SocNavGym 81 times per step would be far too slow.

## Reward: `crowdnav_reward.py`

CrowdNav's SARL reward as a SocNavGym reward file: +1 goal, -0.25 collision, (d - 0.2) * 0.5 * dt when
closer than 0.2 m to a person, else 0. SARL scores candidate actions with exactly this function during its
lookahead (`MultiHumanRL.compute_reward`), so the environment must pay the same reward. SocNavGym's
DSRNN reward is therefore not used for SARL.

## Training: `train_sarl.py`, `train.config`

`train.config` is CrowdNav's file, unchanged values. The loop mirrors `crowd_nav/train.py`:

1. **Imitation learning**: 3000 episodes with SocNavGym's ORCA driving the robot (converted to unicycle
   actions), values = discounted returns, 50 epochs, SGD lr 0.01.
2. **Reinforcement learning**: 10000 episodes, epsilon 0.05, one episode then 100 minibatches of 100,
   SGD lr 0.001 momentum 0.9, value targets `r + 0.9^(dt * v_pref) * V_target(next)`, target network every
   50 episodes, only episodes ending in success or collision are stored (as in CrowdNav), capacity 100000.
3. Validation on 100 fixed rooms every 1000 episodes (`validation.csv`).

Checkpoints (`checkpoints/step_<env steps>.pt`, listed with their phase in `checkpoints.csv`):
untrained network, after imitation learning, and 20 during reinforcement learning (quadratic spacing).

Differences from CrowdNav worth knowing:
- The ORCA demonstrator is SocNavGym's robot ORCA; people ignore the robot, so demonstrations collide in
  about 37% of episodes (CrowdNav's ORCA demos collide too, for the same reason).
- One process, one episode at a time, as in CrowdNav.

## Result of `sarl_humans`

Greedy evaluation, 40 rooms with the goal at least 6 m from the start (`runs/sarl_humans/evaluation.csv`):

| Checkpoint | Goal reached | Collisions |
|---|---|---|
| untrained | 0% | 62% (38% timeouts) |
| after imitation learning | 55% | 45% |
| RL episode 1000 | 57% | 42% |
| RL episode 3000 | 83% | 15% |
| RL episode 10000 | 97% | 3% |

Most arrivals count as "passed too close" in the demo, whose personal-space rule is 0.45 m between
bodies; SARL's own reward only penalises distances under 0.2 m.
