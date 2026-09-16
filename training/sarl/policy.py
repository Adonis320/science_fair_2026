"""CrowdNav's SARL with the action search batched.

MultiHumanRL.predict (crowd_nav/policy/multi_human_rl.py) loops over the 81 actions and runs the
value network once per action. This subclass evaluates all actions in one forward pass. The maths
is the same: propagate the robot with each action, propagate people at constant velocity
(query_env = false), score with compute_reward, and pick
    argmax_a  reward(a) + gamma^(time_step * v_pref) * V(next joint state | a)
The network, rotate(), transform() and training targets are CrowdNav's own code.
"""
from __future__ import annotations

import configparser

import numpy as np
import torch

from .sarl_env import CROWDNAV, STILL  # noqa: F401  (puts CrowdNav on sys.path)
from crowd_nav.policy.sarl import SARL  # noqa: E402
from crowd_sim.envs.utils.action import ActionRot  # noqa: E402


def load_policy_config(path):
    cfg = configparser.RawConfigParser()
    cfg.read(path)
    return cfg


class BatchedSARL(SARL):
    def predict(self, state):
        if self.phase is None or self.device is None:
            raise AttributeError("Phase, device attributes have to be set!")
        if self.phase == "train" and self.epsilon is None:
            raise AttributeError("Epsilon attribute has to be set in training phase")
        assert self.kinematics == "unicycle" and not self.query_env and not self.with_om
        self.action_values, self.chosen_index = None, None     # set only when the actions are scored

        if self.reach_destination(state):
            max_action = ActionRot(0, 0)
        else:
            if self.action_space is None:
                self.build_action_space(state.self_state.v_pref)
            if self.phase == "train" and np.random.random() < self.epsilon:
                max_action = self.action_space[np.random.choice(len(self.action_space))]
            else:
                self.chosen_index = self._best_action_index(state)
                max_action = self.action_space[self.chosen_index]

        if self.phase == "train":
            self.last_state = self.transform(state)
        return max_action

    def attention(self, state):
        """SARL's attention weights over people for the current joint state (sums to 1), in the
        order of state.human_states. This is what the SARL paper visualises."""
        with torch.no_grad():
            self.model(self.transform(state).unsqueeze(0))
        return [float(w) for w in self.model.attention_weights]

    def _best_action_index(self, state):
        s, dt = state.self_state, self.time_step
        humans = state.human_states
        acts = np.array([[a.v, a.r] for a in self.action_space])                  # (A, 2)
        theta = s.theta + acts[:, 1]
        nvx, nvy = acts[:, 0] * np.cos(theta), acts[:, 0] * np.sin(theta)
        npx, npy = s.px + nvx * dt, s.py + nvy * dt                                # next robot, (A,)
        h = np.array([[p.px + p.vx * dt, p.py + p.vy * dt, p.vx, p.vy, p.radius] for p in humans])  # (H, 5)

        # compute_reward (MultiHumanRL), vectorised over actions
        dist = np.hypot(npx[:, None] - h[None, :, 0], npy[:, None] - h[None, :, 1]) - s.radius - h[None, :, 4]
        collision = (dist < 0).any(axis=1)
        dmin = dist.min(axis=1)
        reaching = np.hypot(npx - s.gx, npy - s.gy) < s.radius
        reward = np.where(collision, -0.25, np.where(reaching, 1.0,
                          np.where(dmin < 0.2, (dmin - 0.2) * 0.5 * dt, 0.0)))

        A, H = len(acts), len(humans)
        robot = np.stack([npx, npy, nvx, nvy, np.full(A, s.radius), np.full(A, s.gx), np.full(A, s.gy),
                          np.full(A, s.v_pref), theta], axis=1)                   # (A, 9)
        joint = np.concatenate([np.repeat(robot[:, None, :], H, axis=1), np.repeat(h[None], A, axis=0)], axis=2)
        batch = torch.as_tensor(joint.reshape(A * H, 14), dtype=torch.float32, device=self.device)
        with torch.no_grad():
            rotated = self.rotate(batch).view(A, H, -1)
            values = self.model(rotated).view(A).cpu().numpy()
        total = reward + pow(self.gamma, dt * s.v_pref) * values
        self.action_values = list(total)
        return int(np.argmax(total))
