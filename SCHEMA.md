# Trajectory data schema

Single source of truth for `export_trajectories.py` and `viewer/`.

## Conventions

- **World frame**, metres, right-handed 2D: `x` to the right, `y` up when seen from above.
- **Angles** `theta` in radians, counter-clockwise from +x. Heading of the entity.
- All floats rounded to 3 decimals.
- Frame `k` is the state at time `k * dt`. Frame 0 is the state after `reset()`.
  All entities in one episode have the same number of frames (`n_steps + 1`).
- The viewer maps world `(x, y)` to three.js `(x, 0, -y)` and `theta` to `rotation.y`.

## Layout on disk

```
<out_dir>/
  index.json            # list of checkpoints, training order
  checkpoint_000.json   # one file per checkpoint
  checkpoint_001.json
  ...
viewer/data.js          # all of the above bundled, see bundle_data.py
```

## `index.json`

```json
{
  "source": "socnavgym",
  "algorithm": "sarl",
  "config": "humans_only.yaml",         // scenario config used
  "seeds": [0, 1, 2, 3, 4, 5, 6, 7],    // same seed list for every checkpoint
  "checkpoints": [
    {
      "checkpoint": 0,                  // 0-based position in training order
      "file": "checkpoint_000.json",
      "training_steps": 10000,
      "training_episodes": 412,         // optional: training episodes finished by this checkpoint (from episodes.csv)
      "n_episodes": 8,
      "aggregate": {
        "success_rate": 0.0,            // fraction of episodes, 0..1
        "collision_rate": 0.875,
        "timeout_rate": 0.125,
        "too_close_rate": 0.0,
        "mean_return": -12.3,
        "mean_intrusions": 5.1,         // mean of per-episode metrics.intrusions
        "mean_min_dist": 0.4            // mean of per-episode metrics.min_dist
      },
      "evaluation": {                   // optional, from evaluation.csv (learning curves); null if missing
        "success": 0.2, "too_close": 0.3, "collision": 0.45, "timeout": 0.05, "episodes": 40
      }
    }
  ]
}
```

### `simulation` and `rooms` (the live room)

The viewer runs the room itself (`viewer/world.js` for people, `viewer/sarl.js` with the weights from
`training/export_weights.py` for the robot). `index.json` gives it the rules and each room's start:

```json
"simulation": {
  "time_step": 0.25, "episode_length": 100, "map": [-5.0, 5.0, -5.0, 5.0], "margin": 0.6,
  "v_pref": 1.0, "goal_threshold": 0.3, "goal_radius": 0.3,
  "success_reward": 1.0, "collision_reward": -0.25, "discomfort_dist": 0.2, "discomfort_factor": 0.5,
  "human": {"max_speed": 1.0, "radius": 0.3, "goal_radius": 0.4, "max_rotation_speed": 1.571,
            "speed_threshold": 0.005, "orca": {"neighbor_dist": 1.2, "time_horizon": 5.0}}
},
"rooms": {
  "5": {
    "dt": 0.25,
    "scene": { ... },                              // same shape as an episode's scene
    "robot": {"radius": 0.3, "start": [-4.285, -2.493, -1.386], "goal": [3.664, 2.338]},
    "humans": [{"id": 1, "radius": 0.3, "start": [x, y, theta], "goal": [gx, gy]}]
  }
}
```

`episode_length` is the number of steps the robot gets to reach a goal before it counts as timed out.
The ORCA values are SocNavGym's nominal ones; SocNavGym adds random noise to them at every reset.

## `checkpoint_NNN.json`

```json
{
  "checkpoint": 0,
  "training_steps": 10000,
  "episodes": [
    {
      "seed": 3,
      "outcome": "collision",           // see below
      "return": -14.2,
      "n_steps": 57,
      "metrics": {
        "intrusions": 7,                // timesteps with a human inside personal space
        "min_dist": 0.21,               // min centre-to-centre robot-human distance minus radii, m
        "time_to_collision": null       // seconds, or null if unavailable
      },
      "dt": 0.25,
      "scene": {
        "goal": [4.0, 2.0],
        "goal_radius": 0.5,
        "bounds": [-6.0, 6.0, -6.0, 6.0],               // xmin, xmax, ymin, ymax of the map; used when walls is empty
        "walls": [[[-5, -4], [5, -4]]],             // list of segments [[x1,y1],[x2,y2]]
        "objects": [
          {"type": "plant", "x": 1.0, "y": 0.5, "theta": 0.0, "radius": 0.35},
          {"type": "table", "x": -2.0, "y": 1.5, "theta": 0.5, "radius": 1.006, "length": 1.8, "width": 0.9}
        ]
      },
      "robot": {"radius": 0.3, "frames": [[0.0, 0.0, 0.0]]},
      "humans": [
        {"id": 0, "radius": 0.3, "group": false, "frames": [[1.0, 1.0, 3.14]]}
      ]
    }
  ]
}
```

### `outcome` values

| value       | meaning shown to visitors | when |
|-------------|---------------------------|------|
| `collision` | "Collision"               | robot hit a human, wall or object |
| `timeout`   | "Timed out"               | step limit reached without reaching the goal |
| `too_close` | "Passed too close"        | reached the goal but intruded into personal space |
| `success`   | "Success"                 | reached the goal politely |

### Objects

`type` is `plant`, `table`, `laptop` or `chair`. Every object has a bounding `radius`.
Rectangular objects also have `length` (along `theta`) and `width`; the viewer draws them as
rectangles, and anything without them as a cylinder of `radius`.

### `decisions`

What the robot weighed at each step, for the "options" fan in the viewer:

```json
"decisions": {
  "actions": [[0.0, 0.0], [0.121, -0.785], ...],     // candidate moves: [speed m/s, turn rad] (turn first, then drive)
  "steps": [{"values": [0.41, 0.38, ...], "chosen": 57}, null, ...]
}
```

`steps[k]` is the decision taken at frame `k` (so `n_steps` entries); `values[i]` is SARL's score of
`actions[i]`: reward + discounted value of the predicted next state. `null` means nothing was scored
(for example the robot was already at its goal).

### `attention`

`attention[k]` lists SARL's attention weight for each person (same order as `humans`, sums to 1)
at frame `k`, for the robot's situation when it decided (`n_steps` entries).

### SocNavGym export specifics (`export_trajectories.py`)

- `humans` lists static people, walking people, then members of chatting groups (`group: true`).
- `metrics` also carries `personal_space_compliance`, `path_length`, `spl`, `stalled_time`,
  `min_obstacle_dist`, and `collision_human` / `collision_object` / `collision_wall` flags,
  all taken from SocNavGym's `info` dict at the last step.
- `time_to_collision` is the smallest positive `TIME_TO_COLLISION` seen during the run, in seconds.
- `intrusions` counts steps where a person's body edge is within 0.45 m of the robot's edge.
  A successful run with 3 or more such steps is `too_close`.
- `training_steps` is parsed from the checkpoint file name.

### Changes from the starting-point schema

- Added `n_steps` and `metrics.time_to_collision` (requested per-episode fields).
- Added `scene.goal_radius` and `objects[].theta` so the viewer can draw them to scale.
- Added `objects[].length` / `width` for rectangular furniture and `humans[].group`.
- Frames of every entity have equal length so the viewer can index them with one clock.
- `metrics` may carry extra keys from the SocNavGym `info` dict. The viewer ignores unknown keys.
