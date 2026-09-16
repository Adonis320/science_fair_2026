"""SocNavGym seen through CrowdNav's eyes, for SARL.

SARL (crowd_nav/policy/sarl.py) expects a CrowdNav JointState:
  robot  FullState(px, py, vx, vy, radius, gx, gy, v_pref, theta)      world frame
  people [ObservableState(px, py, vx, vy, radius), ...]               world frame
and returns ActionRot(v, r) for a unicycle robot: turn by r, then drive v for one time step.
SARL rotates everything into its own agent-centric frame (CADRL.rotate).

SocNavGym's diff-drive robot does orientation += vel_a * dt, then moves vel_x * dt along the new
heading, which is exactly the unicycle update with vel_a = r / dt. The scenario config sets
max_rotation = (pi/4) / dt so SARL's +-pi/4 turns fit the action range.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
TRAINING = HERE.parent
sys.path.insert(0, str(TRAINING))

CROWDNAV = Path(os.environ.get("CROWDNAV_ROOT", "/home/adonis/Documents/Thesis/Code/CrowdNav"))
if str(CROWDNAV) not in sys.path:
    sys.path.insert(0, str(CROWDNAV))

import gymnasium as gym  # noqa: E402

from crowd_sim.envs.utils.action import ActionRot  # noqa: E402
from crowd_sim.envs.utils.state import FullState, JointState, ObservableState  # noqa: E402
from socnav_common import EpisodeStats, SeededReset, all_humans, usable_config  # noqa: E402

HUMANS_ONLY_CONFIG = TRAINING / "configs" / "humans_only.yaml"
STILL = ActionRot(0.0, 0.0)


class SarlSocNavEnv:
    """Gymnasium-style env whose observations are CrowdNav people states and actions ActionRot."""

    def __init__(self, config_path=HUMANS_ONLY_CONFIG):
        base = gym.make("SocNavGym-v1", config=usable_config(config_path), disable_env_checker=True)
        self.env = EpisodeStats(SeededReset(base))
        self.unwrapped = base.unwrapped
        self.last_v = 0.0

    # --- properties SARL needs -------------------------------------------------------------
    @property
    def time_step(self):
        return self.unwrapped.TIMESTEP

    @property
    def v_pref(self):
        return self.unwrapped.MAX_ADVANCE_ROBOT

    def robot_state(self) -> FullState:
        r = self.unwrapped.robot
        return FullState(r.x, r.y, self.last_v * math.cos(r.orientation), self.last_v * math.sin(r.orientation),
                         self.unwrapped.ROBOT_RADIUS, r.goal_x, r.goal_y, self.v_pref, r.orientation)

    def human_states(self) -> list[ObservableState]:
        return [ObservableState(h.x, h.y, h.speed * math.cos(h.orientation), h.speed * math.sin(h.orientation),
                                h.width / 2) for h in all_humans(self.unwrapped)]

    def joint_state(self) -> JointState:
        return JointState(self.robot_state(), self.human_states())

    # --- gym-style API -----------------------------------------------------------------------
    def reset(self, seed=None):
        self.env.reset(seed=seed)
        self.last_v = 0.0
        return self.joint_state()

    def step(self, action: ActionRot):
        u = self.unwrapped
        v = float(np.clip(action.v, -self.v_pref, self.v_pref))
        vel_a = action.r / u.TIMESTEP
        continuous = np.array([v / u.MAX_ADVANCE_ROBOT, 0.0, np.clip(vel_a / u.MAX_ROTATION, -1.0, 1.0)],
                              dtype=np.float32)
        _, reward, terminated, truncated, info = self.env.step(continuous)
        self.last_v = v
        return self.joint_state(), float(reward), terminated, truncated, info

    def orca_action(self) -> ActionRot:
        """What SocNavGym's ORCA would do for the robot, as a unicycle action (imitation learning)."""
        u = self.unwrapped
        vx, vy = u.compute_orca_velocity_robot(u.robot)
        speed = min(math.hypot(vx, vy), self.v_pref)
        if speed < 1e-6:
            return STILL
        turn = math.atan2(vy, vx) - u.robot.orientation
        turn = (turn + math.pi) % (2 * math.pi) - math.pi
        turn = max(-math.pi / 4, min(math.pi / 4, turn))
        return ActionRot(speed, turn)

    def close(self):
        self.env.close()
