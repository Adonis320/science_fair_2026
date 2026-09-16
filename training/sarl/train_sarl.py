#!/usr/bin/env python3
"""Train CrowdNav's SARL in the humans-only SocNavGym scenario.

Follows CrowdNav's crowd_nav/train.py and crowd_nav/utils/explorer.py:
  1. imitation learning: il_episodes with ORCA driving the robot, values = discounted returns,
     il_epochs of supervised training (SGD, momentum 0.9, il_learning_rate)
  2. reinforcement learning: train_episodes; each samples one epsilon-greedy episode, stores
     value targets r + gamma^(dt*v_pref) * V_target(next state) (only episodes that end in success
     or collision, as in CrowdNav), then runs train_batches minibatches; the target network is
     refreshed every target_update_interval episodes
Settings come from sarl/policy.config and sarl/train.config (copies of CrowdNav's).

Checkpoints for the time-lapse: the untrained network, the network after imitation learning,
and `--checkpoints` more spread over reinforcement learning (quadratic spacing).

    python training/sarl/train_sarl.py --run sarl_humans
Output: training/runs/<run>/checkpoints/step_XXXXXXXX.pt (+ checkpoints.csv), episodes.csv,
        validation.csv, run_config.json
"""
from __future__ import annotations

import os

for _var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse
import copy
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sarl.policy import BatchedSARL, load_policy_config  # noqa: E402
from sarl.sarl_env import HUMANS_ONLY_CONFIG, SarlSocNavEnv  # noqa: E402
from crowd_nav.utils.memory import ReplayMemory  # noqa: E402
from crowd_nav.utils.trainer import Trainer  # noqa: E402

HERE = Path(__file__).resolve().parent


class Explorer:
    """crowd_nav/utils/explorer.py adapted to SarlSocNavEnv (same bookkeeping and value targets)."""

    def __init__(self, env, policy, memory, gamma, log):
        self.env, self.policy, self.memory, self.gamma, self.log = env, policy, memory, gamma, log
        self.target_model = None
        self.total_steps = 0

    def update_target_model(self, model):
        self.target_model = copy.deepcopy(model)

    def run_k_episodes(self, k, phase, update_memory=False, imitation_learning=False, seeds=None, episode=None):
        self.policy.set_phase(phase)
        outcomes, returns = [], []
        for i in range(k):
            state = self.env.reset(seed=None if seeds is None else seeds[i])
            done, states, rewards = False, [], []
            while not done:
                if imitation_learning:
                    action = self.env.orca_action()
                    states.append(self.policy.transform(state))
                else:
                    action = self.policy.predict(state)
                    if phase == "train":
                        states.append(self.policy.last_state)
                state, reward, terminated, truncated, info = self.env.step(action)
                rewards.append(reward)
                done = terminated or truncated
            if phase == "train":
                self.total_steps += len(rewards)
            outcome = info["outcome"]
            outcomes.append(outcome)
            dt_v = self.env.time_step * self.env.v_pref
            returns.append(sum(pow(self.gamma, t * dt_v) * r for t, r in enumerate(rewards)))
            ended = outcome in ("success", "too_close", "collision")   # CrowdNav: ReachGoal or Collision
            if update_memory and ended:
                self.update_memory(states, rewards, imitation_learning)
            if self.log is not None and phase == "train":
                self.log.writerow([episode if episode is not None else i, "il" if imitation_learning else "rl",
                                   self.total_steps, outcome, len(rewards), round(returns[-1], 4)])
        return {"success": sum(o in ("success", "too_close") for o in outcomes) / k,
                "collision": outcomes.count("collision") / k, "timeout": outcomes.count("timeout") / k,
                "return": float(np.mean(returns))}

    def update_memory(self, states, rewards, imitation_learning):
        dt_v = self.env.time_step * self.env.v_pref
        for i, state in enumerate(states):
            if imitation_learning:
                value = sum(pow(self.gamma, max(t - i, 0) * dt_v) * r * (1 if t >= i else 0)
                            for t, r in enumerate(rewards))
            elif i == len(states) - 1:
                value = rewards[i]
            else:
                with torch.no_grad():
                    value = rewards[i] + pow(self.gamma, dt_v) * self.target_model(states[i + 1].unsqueeze(0)).item()
            self.memory.push((state, torch.Tensor([value])))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", default="sarl_humans")
    ap.add_argument("--config", default=str(HUMANS_ONLY_CONFIG))
    ap.add_argument("--policy-config", default=str(HERE / "policy.config"))
    ap.add_argument("--train-config", default=str(HERE / "train.config"))
    ap.add_argument("--train-episodes", type=int, default=None, help="override train.config")
    ap.add_argument("--il-episodes", type=int, default=None, help="override train.config")
    ap.add_argument("--checkpoints", type=int, default=20, help="checkpoints during reinforcement learning")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    a.config = str(Path(a.config).resolve())

    torch.set_num_threads(1)
    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    run_dir = HERE.parent / "runs" / a.run
    ckpt_dir = run_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    tc = load_policy_config(a.train_config)
    t = {k: tc.get(sec, k) for sec in ("trainer", "imitation_learning", "train") for k in tc.options(sec)}
    il_episodes = a.il_episodes if a.il_episodes is not None else int(t["il_episodes"])
    train_episodes = a.train_episodes if a.train_episodes is not None else int(t["train_episodes"])
    eps_start, eps_end, eps_decay = float(t["epsilon_start"]), float(t["epsilon_end"]), float(t["epsilon_decay"])

    env = SarlSocNavEnv(a.config)
    device = torch.device("cpu")
    policy = BatchedSARL()
    policy.configure(load_policy_config(a.policy_config))
    policy.set_device(device)
    policy.time_step = env.time_step
    model = policy.get_model()

    memory = ReplayMemory(int(t["capacity"]))
    trainer = Trainer(model, memory, device, int(t["batch_size"]))
    episodes_csv = open(run_dir / "episodes.csv", "w", newline="")
    log = csv.writer(episodes_csv)
    log.writerow(["episode", "phase", "total_steps", "outcome", "length", "discounted_return"])
    val_csv = open(run_dir / "validation.csv", "w", newline="")
    val_log = csv.writer(val_csv)
    val_log.writerow(["rl_episode", "total_steps", "success", "collision", "timeout", "return"])
    ckpt_csv = open(ckpt_dir / "checkpoints.csv", "w", newline="")
    ckpt_log = csv.writer(ckpt_csv)
    ckpt_log.writerow(["file", "phase", "rl_episode", "total_steps"])
    explorer = Explorer(env, policy, memory, policy.gamma, log)

    rl_save_at = sorted({int(round(train_episodes * (i / a.checkpoints) ** 2)) for i in range(1, a.checkpoints + 1)})
    (run_dir / "run_config.json").write_text(json.dumps(
        {"args": vars(a), "algorithm": "SARL (CrowdNav)", "train_config": t, "il_episodes": il_episodes,
         "train_episodes": train_episodes, "rl_checkpoint_episodes": rl_save_at}, indent=2))

    def save(phase, rl_episode):
        name = f"step_{explorer.total_steps:08d}.pt"
        torch.save(model.state_dict(), ckpt_dir / name)
        ckpt_log.writerow([name, phase, rl_episode, explorer.total_steps])
        ckpt_csv.flush()
        print(f"[checkpoint] {name} ({phase}, rl episode {rl_episode})", flush=True)

    val_seeds = list(range(50_000, 50_100))
    t0 = time.time()
    save("untrained", 0)
    env.reset(seed=100_000 + a.seed)        # training rooms continue from this seed

    # 1. imitation learning
    trainer.set_learning_rate(float(t["il_learning_rate"]))
    stats = explorer.run_k_episodes(il_episodes, "train", update_memory=True, imitation_learning=True)
    print(f"[il] {il_episodes} ORCA episodes: success {stats['success']:.2f} collision {stats['collision']:.2f}, "
          f"memory {len(memory)}, {time.time() - t0:.0f}s", flush=True)
    loss = trainer.optimize_epoch(int(t["il_epochs"]))
    print(f"[il] {t['il_epochs']} epochs, last average loss {loss:.2e}, {time.time() - t0:.0f}s", flush=True)
    save("imitation", 0)
    explorer.update_target_model(model)

    # 2. reinforcement learning
    trainer.set_learning_rate(float(t["rl_learning_rate"]))
    train_batches, target_every = int(t["train_batches"]), int(t["target_update_interval"])
    evaluation_interval = int(t["evaluation_interval"])
    for episode in range(train_episodes):
        policy.set_epsilon(eps_start + (eps_end - eps_start) / eps_decay * episode if episode < eps_decay else eps_end)
        if episode % evaluation_interval == 0:
            v = explorer.run_k_episodes(len(val_seeds), "val", seeds=val_seeds)
            val_log.writerow([episode, explorer.total_steps, v["success"], v["collision"], v["timeout"], round(v["return"], 4)])
            val_csv.flush()
            print(f"[val] rl episode {episode}: success {v['success']:.2f} collision {v['collision']:.2f} "
                  f"timeout {v['timeout']:.2f} return {v['return']:.3f}, {time.time() - t0:.0f}s", flush=True)
        explorer.run_k_episodes(int(t["sample_episodes"]), "train", update_memory=True, episode=episode)
        trainer.optimize_batch(train_batches)
        if (episode + 1) % target_every == 0:
            explorer.update_target_model(model)
        if episode + 1 in rl_save_at:
            save("reinforcement", episode + 1)
        if (episode + 1) % 250 == 0:
            episodes_csv.flush()

    v = explorer.run_k_episodes(len(val_seeds), "val", seeds=val_seeds)
    val_log.writerow([train_episodes, explorer.total_steps, v["success"], v["collision"], v["timeout"], round(v["return"], 4)])
    print(f"[val] final: success {v['success']:.2f} collision {v['collision']:.2f} timeout {v['timeout']:.2f}, "
          f"{time.time() - t0:.0f}s", flush=True)
    for f in (episodes_csv, val_csv, ckpt_csv):
        f.close()
    env.close()
    print("done", flush=True)


if __name__ == "__main__":
    main()
