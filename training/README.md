# Training the robot for the demo

CrowdNav's SARL policy learns to cross a room full of walking people in SocNavGym
(the SocNavGym-V2 fork). Checkpoints saved during training become the time-lapse in the viewer.

Everything runs in the `socnavgym` conda environment (Python 3.11, SocNavGym-V2 editable install,
PyTorch). CrowdNav is imported from `~/Documents/Thesis/Code/CrowdNav` (override with `CROWDNAV_ROOT`);
neither repository is modified.

```bash
conda activate socnavgym
cd ~/Documents/fete_science/demo

# 1. train: 3000 imitation episodes + 10000 reinforcement episodes, about 100 min
python training/sarl/train_sarl.py --run sarl_humans

# 2. score every checkpoint on 40 unseen rooms, about 1 min (the viewer's learning curves)
python training/evaluate_checkpoints.py training/runs/sarl_humans/checkpoints --episodes 40

# 3. export one room for every checkpoint and rebuild viewer/data.js
python export_trajectories.py training/runs/sarl_humans/checkpoints --seeds 5

# 4. watch
./run.sh
```

## Files

| File | What it is |
|---|---|
| `configs/humans_only.yaml` | The scenario: 10 x 10 m, 6 walking people (ORCA, 1 m/s), no walls or furniture, 0.25 s steps, 25 s limit. |
| `socnav_common.py` | Environment setup shared by training, evaluation and export: config resolution, seeding, outcome labels, room selection. |
| `fast_geometry.py` | Runtime replacement for SocNavGym's shapely collision checks, about 5x faster steps and identical results on 20 000 random tests. The installed package is not modified. |
| `sarl/` | Everything specific to SARL: environment wrapper, policy, reward, training loop. See [`sarl/README.md`](sarl/README.md). |
| `evaluate_checkpoints.py` | Greedy evaluation of every checkpoint on fixed unseen rooms, writes `evaluation.csv`. |
| `export_weights.py` | Writes `viewer/weights.js`, the network at every checkpoint, which drives the robot of the live room in the viewer. |
| `runs/sarl_humans/` | Checkpoints, per-episode log, validation log, evaluation results and run settings. |

## Design choices

- **People ignore the robot** (`prob_to_avoid_robot: 0`), as in CrowdNav where the robot is invisible.
  The robot has to be the polite one, and the crowd moves identically at every checkpoint in a given room.
- **Seeds.** Training rooms come from seeds 100000 and up, the evaluation uses 50000 and up, the export
  uses small seeds. Evaluation and export keep only rooms where the robot starts at least 6 m from its
  goal (`--min-start-goal-dist`) and nobody walks into a robot that stands still during the first
  3 seconds (`--grace-steps`).
- **Reproducibility.** Group members and human noise draw from Python's and NumPy's global generators,
  so `SeededReset` seeds those as well. Same seed, same room, same crowd.
- **People move with ORCA, not the social-force model.** Social-force speed scales with `time_step`, so
  a normal walking pace needs a high speed cap, and after every contact people shoot off at up to that
  cap and overlap each other. Measured over 12 rooms, ORCA at 1 m/s caps speed, has no person-obstacle
  overlap and about 5 times fewer deep person-person overlaps. The few remaining brushes come from
  SocNavGym solving ORCA separately for each person; the viewer nudges people apart on screen.
- **Known SocNavGym quirk.** People pick a new destination after 15 s of real wall-clock time
  (`MAX_TIME_TO_REACH_GOAL` in `human.py`), not simulated time. Episodes run far faster than that
  during training and export, so it does not trigger in practice.

## Result of `sarl_humans`

Greedy evaluation on 40 rooms with the goal at least 6 m from the start (`runs/sarl_humans/evaluation.csv`):

| Checkpoint | Goal reached | Collisions |
|---|---|---|
| untrained | 0% | 62% (38% timeouts) |
| after imitation learning | 55% | 45% |
| 1000 reinforcement episodes | 57% | 42% |
| 3000 | 83% | 15% |
| 10000 | 98% | 2% |

Most arrivals count as "passed too close" in the demo, whose personal-space rule is 0.45 m between
bodies; SARL's own reward only penalises distances under 0.2 m.
