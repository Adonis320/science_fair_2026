#!/usr/bin/env python3
"""Replay saved SARL checkpoints in SocNavGym and export the trajectories for the viewer (SCHEMA.md).

Every checkpoint plays the same scenario seeds, so episode k is the same room with the same people
at every stage of training. Positions are read from the environment's entity objects in the world
frame; the robot-centric state the network sees is not used for the export.

    conda activate socnavgym
    python export_trajectories.py training/runs/sarl_humans/checkpoints --seeds 5

Writes <out>/index.json and <out>/checkpoint_NNN.json, then bundles them into viewer/data.js.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "training"))

from socnav_common import (DEFAULT_CONFIG, PERSONAL_SPACE, all_humans, human_clearance,  # noqa: E402
                           outcome_from_info, run_config_for, select_seeds, wall_segment)
from bundle_data import bundle  # noqa: E402


def r3(v):
    return None if v is None else round(float(v), 3)


def checkpoint_steps(path: Path) -> int | None:
    m = re.search(r"(\d+)\.pt$", path.name)
    return int(m.group(1)) if m else None


def find_checkpoints(directory: Path) -> list[tuple[int, Path]]:
    found = []
    for p in directory.glob("*.pt"):
        steps = checkpoint_steps(p)
        if steps is None:
            print(f"skipping {p.name}: no step count in the file name")
            continue
        found.append((steps, p))
    return sorted(found)


def capture_scene(u) -> dict:
    objects = [{"type": "plant", "x": r3(p.x), "y": r3(p.y), "theta": 0.0, "radius": r3(p.radius)} for p in u.plants]
    for kind, items in (("table", u.tables), ("laptop", u.laptops), ("chair", getattr(u, "chairs", []))):
        for t in items:
            objects.append({"type": kind, "x": r3(t.x), "y": r3(t.y), "theta": r3(t.orientation),
                            "radius": r3(math.hypot(t.length / 2, t.width / 2)),
                            "length": r3(t.length), "width": r3(t.width)})
    walls = [[[r3(a[0]), r3(a[1])], [r3(b[0]), r3(b[1])]] for a, b in map(wall_segment, u.walls)]
    return {"goal": [r3(u.robot.goal_x), r3(u.robot.goal_y)], "goal_radius": r3(u.GOAL_THRESHOLD),
            "bounds": [r3(-u.MAP_X / 2), r3(u.MAP_X / 2), r3(-u.MAP_Y / 2), r3(u.MAP_Y / 2)],
            "walls": walls, "objects": objects}


def capture_room(env, seed: int) -> dict:
    """The room as it starts: layout, where the robot and every person stand, and where they head.
    The viewer simulates everything from there on."""
    env.reset(seed=seed)
    u = env.unwrapped
    return {
        "dt": r3(u.TIMESTEP),
        "scene": capture_scene(u),
        "robot": {"radius": r3(u.ROBOT_RADIUS), "start": [r3(u.robot.x), r3(u.robot.y), r3(u.robot.orientation)],
                  "goal": [r3(u.robot.goal_x), r3(u.robot.goal_y)]},
        "humans": [{"id": int(h.id), "radius": r3(h.width / 2), "start": [r3(h.x), r3(h.y), r3(h.orientation)],
                    "goal": [r3(h.goal_x), r3(h.goal_y)]} for h in all_humans(u)],
    }


def simulation_settings(u) -> dict:
    """Rules the viewer needs to run the room itself: robot dynamics and rewards, people's ORCA
    settings, and how new goals are drawn."""
    return {
        "time_step": r3(u.TIMESTEP), "episode_length": int(u.EPISODE_LENGTH),
        "map": [r3(-u.MAP_X / 2), r3(u.MAP_X / 2), r3(-u.MAP_Y / 2), r3(u.MAP_Y / 2)],
        "margin": r3(u.MARGIN),
        "v_pref": r3(u.MAX_ADVANCE_ROBOT), "goal_threshold": r3(u.GOAL_THRESHOLD), "goal_radius": r3(u.GOAL_RADIUS),
        "success_reward": 1.0, "collision_reward": -0.25, "discomfort_dist": 0.2, "discomfort_factor": 0.5,
        "human": {"max_speed": r3(u.MAX_ADVANCE_HUMAN), "radius": r3(u.HUMAN_DIAMETER / 2),
                  "goal_radius": r3(u.HUMAN_GOAL_RADIUS), "max_rotation_speed": r3(math.pi / 2),
                  "speed_threshold": r3(u.SPEED_THRESHOLD),
                  "orca": {"neighbor_dist": r3(2 * u.HUMAN_DIAMETER), "time_horizon": 5.0}},
    }


def run_episode(env, agent, seed: int) -> dict:
    obs = env.reset(seed=seed)
    u = env.unwrapped
    scene = capture_scene(u)
    humans = all_humans(u)
    groups = {id(h) for i in list(u.static_interactions) + list(u.moving_interactions) for h in i.humans}
    robot_frames = [[r3(u.robot.x), r3(u.robot.y), r3(u.robot.orientation)]]
    human_frames = [[[r3(h.x), r3(h.y), r3(h.orientation)]] for h in humans]

    total_return, intrusions, min_clear, ttc, min_obstacle = 0.0, 0, float("inf"), None, float("inf")
    info, n = {}, 0
    action_set, decisions, attention = None, [], []
    while True:
        weights = agent.attention(obs)
        attention.append(None if weights is None else [r3(w) for w in weights])
        action = agent.act(obs)
        d = agent.decision()
        if d is None:
            decisions.append(None)
        else:
            action_set = action_set or [[r3(v), r3(t)] for v, t in d[0]]
            decisions.append({"values": [r3(v) for v in d[1]], "chosen": d[2]})
        obs, reward, terminated, truncated, info = env.step(action)
        n += 1
        total_return += reward
        robot_frames.append([r3(u.robot.x), r3(u.robot.y), r3(u.robot.orientation)])
        for frames, h in zip(human_frames, humans):
            frames.append([r3(h.x), r3(h.y), r3(h.orientation)])
        clear = human_clearance(u)
        min_clear = min(min_clear, clear)
        intrusions += int(clear < PERSONAL_SPACE)
        if info.get("TIME_TO_COLLISION", -1) not in (-1, None):
            t = info["TIME_TO_COLLISION"] * u.TIMESTEP
            ttc = t if ttc is None else min(ttc, t)
        if info.get("MINIMUM_OBSTACLE_DISTANCE") is not None:
            min_obstacle = min(min_obstacle, info["MINIMUM_OBSTACLE_DISTANCE"])
        if terminated or truncated:
            break

    outcome = outcome_from_info(info, intrusions)
    return {
        "seed": seed,
        "outcome": outcome,
        "return": r3(total_return),
        "n_steps": n,
        "metrics": {
            "intrusions": intrusions,
            "min_dist": r3(max(0.0, min_clear)),
            "time_to_collision": r3(ttc),
            "personal_space_compliance": r3(info.get("PERSONAL_SPACE_COMPLIANCE")),
            "path_length": r3(info.get("PATH_LENGTH")),
            "spl": r3(info.get("SPL")),
            "stalled_time": r3(info.get("STALLED_TIME")),
            "min_obstacle_dist": r3(min_obstacle) if math.isfinite(min_obstacle) else None,
            "collision_human": bool(info.get("COLLISION_HUMAN")),
            "collision_object": bool(info.get("COLLISION_OBJECT")),
            "collision_wall": bool(info.get("COLLISION_WALL")),
        },
        "dt": r3(u.TIMESTEP),
        "scene": scene,
        "robot": {"radius": r3(u.ROBOT_RADIUS), "frames": robot_frames},
        "humans": [{"id": int(h.id), "radius": r3(h.width / 2), "group": id(h) in groups, "frames": f}
                   for h, f in zip(humans, human_frames)],
        "decisions": None if action_set is None else {"actions": action_set, "steps": decisions},
        "attention": attention if any(w is not None for w in attention) else None,
    }



def load_evaluation(path: Path) -> dict[int, dict]:
    """Rows of evaluate_checkpoints.py's evaluation.csv, keyed by training steps."""
    import csv
    rows = {}
    with open(path) as f:
        for r in csv.DictReader(f):
            rows[int(r["training_steps"])] = {
                "success": float(r["success"]), "too_close": float(r["too_close"]),
                "collision": float(r["collision"]), "timeout": float(r["timeout"]),
                "episodes": int(r["episodes"]) if r.get("episodes") else None}
    return rows


def episode_counter(run_dir: Path):
    """steps -> number of training episodes finished by then, from the run's episodes.csv
    (imitation episodes included). None when the run has no episode log."""
    import bisect
    import csv
    path = run_dir / "episodes.csv"
    if not path.exists():
        return None
    with open(path) as f:
        ends = sorted(int(r["total_steps"]) for r in csv.DictReader(f))
    return lambda steps: bisect.bisect_right(ends, steps)


def aggregate(episodes: list[dict]) -> dict:
    rate = lambda o: r3(sum(e["outcome"] == o for e in episodes) / len(episodes))
    return {"success_rate": rate("success"), "collision_rate": rate("collision"),
            "timeout_rate": rate("timeout"), "too_close_rate": rate("too_close"),
            "mean_return": r3(np.mean([e["return"] for e in episodes])),
            "mean_intrusions": r3(np.mean([e["metrics"]["intrusions"] for e in episodes])),
            "mean_min_dist": r3(np.mean([e["metrics"]["min_dist"] for e in episodes]))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("checkpoint_dir", type=Path, help="directory of *.pt checkpoints with step counts in their names")
    ap.add_argument("--episodes", type=int, default=8, help="episodes per checkpoint")
    ap.add_argument("--first-seed", type=int, default=0, help="seeds are taken from here upwards")
    ap.add_argument("--seeds", type=int, nargs="+", default=None,
                    help="play exactly these scenario seeds (skips seed selection and --episodes)")
    ap.add_argument("--grace-steps", type=int, default=6,
                    help="skip seeds where a still robot is hit within this many steps (0 disables)")
    ap.add_argument("--min-start-goal-dist", type=float, default=6.0,
                    help="skip seeds where the robot starts closer than this to its goal, metres (0 disables)")
    ap.add_argument("--config", default=None, help="scenario config (default: the one the run was trained with)")
    ap.add_argument("--out", type=Path, default=HERE / "sarl_one_room")
    ap.add_argument("--no-bundle", action="store_true", help="do not write viewer/data.js")
    ap.add_argument("--evaluation", type=Path, default=None,
                    help="evaluation.csv for the learning curves (default: next to the checkpoint directory)")
    a = ap.parse_args()

    from sarl.agent import SarlAgent, STILL_ACTION, open_env

    checkpoints = find_checkpoints(a.checkpoint_dir)
    if not checkpoints:
        sys.exit(f"no checkpoints found in {a.checkpoint_dir}")
    a.config = a.config or run_config_for(a.checkpoint_dir) or str(DEFAULT_CONFIG)
    print(f"scenario: {a.config}")
    env = open_env(a.config)
    env.still_action = STILL_ACTION
    seeds = a.seeds or select_seeds(env, STILL_ACTION, a.first_seed, a.episodes,
                                    a.min_start_goal_dist, a.grace_steps)
    a.out.mkdir(parents=True, exist_ok=True)
    count_episodes = episode_counter(a.checkpoint_dir.resolve().parent)
    eval_csv = a.evaluation or a.checkpoint_dir.resolve().parent / "evaluation.csv"
    evaluation = load_evaluation(eval_csv) if eval_csv.exists() else {}
    print(f"learning curves: {eval_csv if evaluation else 'none (run training/evaluate_checkpoints.py first)'}")
    index = {"source": "socnavgym", "algorithm": "sarl", "config": Path(a.config).name, "seeds": seeds,
             "simulation": None, "rooms": {}, "checkpoints": []}
    for seed in seeds:
        index["rooms"][str(seed)] = capture_room(env, seed)
    index["simulation"] = simulation_settings(env.unwrapped)

    for c, (steps, path) in enumerate(checkpoints):
        agent = SarlAgent(path, env)
        episodes = [run_episode(env, agent, seed) for seed in seeds]
        fname = f"checkpoint_{c:03d}.json"
        (a.out / fname).write_text(json.dumps({"checkpoint": c, "training_steps": steps, "episodes": episodes},
                                              separators=(",", ":")))
        index["checkpoints"].append({"checkpoint": c, "file": fname, "training_steps": steps,
                                     "training_episodes": count_episodes(steps) if count_episodes else None,
                                     "n_episodes": len(episodes), "aggregate": aggregate(episodes),
                                     "evaluation": evaluation.get(steps)})
        print(f"checkpoint {c:2d} ({steps:>8d} steps): " + " ".join(e["outcome"] for e in episodes), flush=True)

    (a.out / "index.json").write_text(json.dumps(index, indent=1))
    env.close()
    if not a.no_bundle:
        bundle(a.out, HERE / "viewer" / "data.js")


if __name__ == "__main__":
    main()
