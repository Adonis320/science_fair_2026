"""SocNavGym setup shared by training, evaluation and export.

Holds what must be identical between training and playback: how the environment is built,
how it is seeded, and how an episode is summarised.
"""
from __future__ import annotations

import math
import os
import random
import tempfile
from pathlib import Path

import gymnasium as gym
import numpy as np

import socnavgym  # noqa: F401  (registers SocNavGym-v1)

import fast_geometry

fast_geometry.apply()

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "configs" / "humans_only.yaml"

# Personal space used for the "intrusions" metric and the too_close outcome.
PERSONAL_SPACE = 0.45          # metres between body edges (SEAN 2.0 value used by SocNavGym)
TOO_CLOSE_MIN_STEPS = 3        # a successful run with at least this many intrusion steps is "too_close"


def run_config_for(checkpoint_dir) -> str | None:
    """Scenario config a run was trained with, from runs/<run>/run_config.json."""
    rc = Path(checkpoint_dir).resolve().parent / "run_config.json"
    if not rc.exists():
        return None
    import json
    config = Path(json.loads(rc.read_text())["args"]["config"])
    if not config.is_absolute():
        config = config if config.exists() else HERE.parent / config
    return str(config.resolve())


def usable_config(config_path: str | os.PathLike) -> str:
    """Config file with an absolute reward_file path.

    SocNavGym opens reward_file relative to the current directory, while the configs here give it
    relative to training/. The rewritten copy is cached in the temp directory; the write is atomic
    because parallel workers may resolve the same config at the same moment.
    """
    import yaml
    import zlib
    cfg = yaml.safe_load(Path(config_path).read_text())
    reward = cfg["env"].get("reward_file", "")
    if reward in ("dsrnn", "sngnn") or Path(reward).is_absolute():
        return str(config_path)
    cfg["env"]["reward_file"] = str((HERE / reward).resolve())
    text = yaml.safe_dump(cfg)
    out = Path(tempfile.gettempdir()) / "socnav_demo_configs" / f"{Path(config_path).stem}_{zlib.crc32(text.encode()):08x}.yaml"
    out.parent.mkdir(exist_ok=True)
    if not out.exists():
        tmp = out.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(text)
        os.replace(tmp, out)
    return str(out)


class SeededReset(gym.Wrapper):
    """Makes reset(seed=s) fully reproducible.

    SocNavGym seeds its own generators, but human groups and human.update() also draw from
    Python's `random` and NumPy's global generator, so those are seeded as well.
    """

    def reset(self, *, seed=None, options=None):
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed % 2**32)
        return self.env.reset(seed=seed, options=options)


def all_humans(u):
    """Every human in a stable order: static, dynamic, then members of interactions."""
    humans = list(u.static_humans) + list(u.dynamic_humans)
    for i in list(u.moving_interactions) + list(u.static_interactions):
        humans.extend(i.humans)
    for i in u.h_l_interactions:
        humans.append(i.human)
    return humans


def wall_segment(w):
    c, s = math.cos(w.orientation), math.sin(w.orientation)
    return ((w.x - c * w.length / 2, w.y - s * w.length / 2), (w.x + c * w.length / 2, w.y + s * w.length / 2))


def human_clearance(u) -> float:
    """Smallest distance between the robot's body and a person's body."""
    r = u.robot
    return min((math.hypot(h.x - r.x, h.y - r.y) - h.width / 2 - u.ROBOT_RADIUS for h in all_humans(u)),
               default=float("inf"))


def start_goal_distance(u) -> float:
    """Straight-line distance from the robot to its goal, right after reset."""
    return math.hypot(u.robot.goal_x - u.robot.x, u.robot.goal_y - u.robot.y)


def outcome_from_info(info: dict, intrusion_steps: int) -> str:
    """SocNavGym's terminal info flags mapped to the four outcomes the viewer shows."""
    if info.get("SUCCESS"):
        return "too_close" if intrusion_steps >= TOO_CLOSE_MIN_STEPS else "success"
    if info.get("COLLISION") or info.get("COLLISION_HUMAN") or info.get("COLLISION_OBJECT") \
            or info.get("COLLISION_WALL") or info.get("OUT_OF_MAP"):
        return "collision"
    return "timeout"


def select_seeds(env, still_action, first_seed: int, count: int, min_start_goal_dist: float = 6.0,
                 grace_steps: int = 6, verbose: bool = True) -> list[int]:
    """The first `count` seeds, from first_seed up, that make a fair demo room:

    - the robot starts at least min_start_goal_dist metres from its goal, so every run is a real
      crossing of the room;
    - a robot that stands still is not walked into during the first grace_steps steps.
    """
    seeds, seed = [], first_seed
    while len(seeds) < count:
        env.reset(seed=seed)
        reason = None
        dist = start_goal_distance(env.unwrapped)
        if dist < min_start_goal_dist:
            reason = f"goal only {dist:.1f} m from the start"
        else:
            for _ in range(grace_steps):
                _, _, terminated, truncated, info = env.step(still_action)
                if terminated or truncated:
                    if info.get("COLLISION") or info.get("COLLISION_HUMAN"):
                        reason = "a person walks into the robot at the start"
                    break
        if reason is None:
            seeds.append(seed)
        elif verbose:
            print(f"seed {seed}: skipped, {reason}")
        seed += 1
    return seeds


class EpisodeStats(gym.Wrapper):
    """Adds `outcome`, `intrusions` and `min_clearance` to info at the end of each episode."""

    def reset(self, **kwargs):
        self._intrusions = 0
        self._min_clear = float("inf")
        return self.env.reset(**kwargs)

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        clear = human_clearance(self.env.unwrapped)
        self._min_clear = min(self._min_clear, clear)
        self._intrusions += int(clear < PERSONAL_SPACE)
        if terminated or truncated:
            info["outcome"] = outcome_from_info(info, self._intrusions)
            info["intrusions"] = self._intrusions
            info["min_clearance"] = self._min_clear
        return obs, reward, terminated, truncated, info
