#!/usr/bin/env python3
"""Score every checkpoint of a run with the greedy policy on a fixed set of unseen rooms.

Training statistics include exploration noise; this shows what the saved networks actually do,
which is what the demo plays back. The viewer reads the resulting file for its learning curves.

    python training/evaluate_checkpoints.py training/runs/sarl_humans/checkpoints --episodes 40

Writes <checkpoint_dir>/../evaluation.csv and prints a table.
"""
from __future__ import annotations

import os

for _var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse
import csv
import re
from multiprocessing import Pool
from pathlib import Path

import numpy as np


def evaluate(job):
    path, seeds, config = job
    import torch
    torch.set_num_threads(1)
    from sarl.agent import SarlAgent, open_env
    env = open_env(config)
    agent = SarlAgent(path, env)
    rows = []
    for seed in seeds:
        obs = env.reset(seed=seed)
        ret, done = 0.0, False
        while not done:
            obs, r, term, trunc, info = env.step(agent.act(obs))
            ret += r
            done = term or trunc
        rows.append((info["outcome"], ret, info["intrusions"], env.unwrapped.ticks))
    env.close()
    return path, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("checkpoint_dir", type=Path)
    ap.add_argument("--episodes", type=int, default=40)
    ap.add_argument("--first-seed", type=int, default=50_000, help="disjoint from the training and export seeds")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--min-start-goal-dist", type=float, default=6.0, help="same room filter as the export")
    ap.add_argument("--config", default=None, help="scenario config (default: the one the run was trained with)")
    a = ap.parse_args()

    from sarl.agent import STILL_ACTION, open_env
    from socnav_common import DEFAULT_CONFIG, run_config_for, select_seeds
    config = a.config or run_config_for(a.checkpoint_dir) or str(DEFAULT_CONFIG)
    print(f"scenario: {config}")
    ckpts = sorted(a.checkpoint_dir.glob("*.pt"), key=lambda p: int(re.search(r"(\d+)", p.stem).group(1)))
    probe = open_env(config)
    seeds = select_seeds(probe, STILL_ACTION, a.first_seed, a.episodes, a.min_start_goal_dist, verbose=False)
    probe.close()
    with Pool(a.workers) as pool:
        results = dict(pool.map(evaluate, [(str(p), seeds, config) for p in ckpts]))

    out = a.checkpoint_dir.parent / "evaluation.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["training_steps", "success", "too_close", "collision", "timeout", "mean_return", "mean_intrusions", "mean_steps", "episodes"])
        print(f"{'steps':>9} {'success':>8} {'too_close':>9} {'collision':>9} {'timeout':>8} {'return':>7}")
        for p in ckpts:
            rows = results[str(p)]
            n = len(rows)
            rate = lambda o: sum(r[0] == o for r in rows) / n
            steps = int(re.search(r"(\d+)", p.stem).group(1))
            vals = [steps, rate("success"), rate("too_close"), rate("collision"), rate("timeout"),
                    np.mean([r[1] for r in rows]), np.mean([r[2] for r in rows]), np.mean([r[3] for r in rows])]
            w.writerow([vals[0]] + [round(float(v), 3) for v in vals[1:]] + [n])
            print(f"{steps:>9} {vals[1]:>8.2f} {vals[2]:>9.2f} {vals[3]:>9.2f} {vals[4]:>8.2f} {vals[5]:>7.1f}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
