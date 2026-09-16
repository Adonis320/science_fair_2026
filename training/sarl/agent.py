"""Loading a saved SARL checkpoint and playing it greedily, for evaluation and export."""
from __future__ import annotations

from pathlib import Path

import torch

from .policy import BatchedSARL, load_policy_config
from .sarl_env import SarlSocNavEnv, STILL

HERE = Path(__file__).resolve().parent


def open_env(config):
    return SarlSocNavEnv(config)


class SarlAgent:
    """act(joint state) -> ActionRot, always the highest scoring move."""

    def __init__(self, checkpoint, env):
        policy_config = Path(checkpoint).resolve().parents[1] / "policy.config"
        if not policy_config.exists():
            policy_config = HERE / "policy.config"
        self.policy = BatchedSARL()
        self.policy.configure(load_policy_config(policy_config))
        self.policy.set_device(torch.device("cpu"))
        self.policy.set_phase("test")
        self.policy.time_step = env.time_step
        self.policy.get_model().load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))

    def act(self, state):
        return self.policy.predict(state)

    def attention(self, state):
        """Attention weight per person for this state, in the order of state.human_states."""
        return self.policy.attention(state)

    def decision(self):
        """(candidate moves as [speed m/s, turn rad], their scores, chosen index) for the last act(),
        or None when nothing was scored because the robot had already reached its goal."""
        if self.policy.action_values is None:
            return None
        actions = [[float(a.v), float(a.r)] for a in self.policy.action_space]
        return actions, [float(v) for v in self.policy.action_values], int(self.policy.chosen_index)


STILL_ACTION = STILL
