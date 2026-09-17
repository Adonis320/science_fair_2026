# Fête de la Science: a robot learning to walk among people

A laptop demo for a science fair. A visitor drags a slider over training and watches a robot go from
crashing into people to crossing a crowded room politely. The room runs live in the browser, without
end, and nothing is fetched from the internet.

```bash
./run.sh                 # local web server + browser, http://localhost:8000/index.html
```

`run.bat` does the same on Windows. Opening `viewer/index.html?simple=1` as a file also works, with
simple shapes instead of the 3D characters, as a fallback if the models misbehave on the stand laptop.

The demo is in French. The "?" button in the corner opens the presenter guide, also available as
[`GUIDE_ANIMATEUR.md`](GUIDE_ANIMATEUR.md).

## What is shown

A 10 x 10 m room with 6 people walking and a TurtleBot-like robot that has to reach a goal.

- **People** walk with ORCA, ported from RVO2 and following SocNavGym's rules (`viewer/world.js`). They
  pick a new destination whenever they arrive and never step aside for the robot.
- **The robot** is driven by CrowdNav's SARL network, trained in SocNavGym and run in the browser
  (`viewer/sarl.js`, weights in `viewer/weights.js`). It gets a new goal each time it reaches one or
  after 25 s without reaching it, and reappears somewhere free after a collision.
- **The slider** picks the network: 22 checkpoints, from the untrained network to 13 000 training
  episodes. Moving it changes the robot's behaviour without stopping the room.
- **Clicking the floor** moves the robot's goal. **R** puts the room back to its starting state.
- **Layers** can be shown or hidden: the moves the robot weighs, its attention over people, three
  personal-space models, people's reactions, the reward rules, the learning curves.

The learning curves come from a separate evaluation on 40 test rooms (`training/evaluate_checkpoints.py`).
If `viewer/weights.js` is missing, the viewer falls back to playing the recorded trajectories.

## Layout

| Path | What it is |
|---|---|
| `viewer/index.html`, `app.js`, `style.css` | The demo page: plain HTML, CSS and JavaScript, no build step. |
| `viewer/world.js` | The live room: ORCA for people, goals, collisions and respawns. |
| `viewer/sarl.js` | SARL's value network and action search, same computation as CrowdNav. |
| `viewer/weights.js` | The network at every checkpoint, written by `training/export_weights.py`. |
| `viewer/data.js` | Room start, simulation rules, learning curves and recorded trajectories, written by `export_trajectories.py`. |
| `viewer/guide.html` | The presenter guide behind the "?" button, same content as `GUIDE_ANIMATEUR.md`. |
| `viewer/vendor/`, `viewer/assets/` | three.js and the 3D characters, both vendored. |
| `training/` | Scenario, SARL training, evaluation. See [`training/README.md`](training/README.md). |
| `sarl_one_room/` | The export behind `viewer/data.js` (room with seed 5). |
| `sarl_real_data/` | The same checkpoints exported over 8 rooms. |
| `export_trajectories.py` | Replays checkpoints, writes an export, then rebuilds `viewer/data.js`. |
| `bundle_data.py` | Packs an export directory into `viewer/data.js`. |
| `tools/prune_gltf.py` | Used once to trim the character models to their walk and idle animations. |
| `SCHEMA.md` | The data format. |
| `ASSETS.md` | Source and licence of three.js and of every 3D model. |

## Rebuilding the data

```bash
conda activate socnavgym
python training/evaluate_checkpoints.py training/runs/sarl_humans/checkpoints --episodes 40   # learning curves
python export_trajectories.py training/runs/sarl_humans/checkpoints --seeds 5                 # viewer/data.js
python training/export_weights.py training/runs/sarl_humans/checkpoints                       # viewer/weights.js
```

The evaluation and the weights only need rebuilding after a new training run. `--seeds` chooses the
room the demo starts from; `python bundle_data.py sarl_real_data` switches to an export that already
exists.
