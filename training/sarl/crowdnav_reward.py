"""CrowdNav's SARL reward as a SocNavGym reward file.

Same values as MultiHumanRL.compute_reward in CrowdNav (crowd_nav/policy/multi_human_rl.py),
which SARL uses to score actions during its one-step lookahead. The environment has to pay the
same reward, otherwise the lookahead and the learned values disagree.

    collision (or leaving the map)       -0.25   episode ends
    reaching the goal                    +1      episode ends
    closer than 0.2 m to a person        (distance - 0.2) * 0.5 * time_step
    otherwise                            0
"""
import numpy as np
import socnavgym
from socnavgym.envs.rewards.reward_api import RewardAPI


class Reward(RewardAPI):
    SUCCESS = 1.0
    COLLISION = -0.25
    DISCOMFORT_DIST = 0.2
    DISCOMFORT_FACTOR = 0.5

    def compute_reward(self, action, prev_obs, curr_obs):
        env = self.env
        collision_human, collision_object, collision_wall = env.check_robot_collision(env.robot)
        if collision_human or collision_object or collision_wall or self.check_out_of_map():
            reward = self.COLLISION
        elif self.check_reached_goal():
            reward = self.SUCCESS
        else:
            humans = list(env.static_humans) + list(env.dynamic_humans)
            for i in env.static_interactions + env.moving_interactions:
                humans.extend(i.humans)
            dmin = min((np.hypot(h.x - env.robot.x, h.y - env.robot.y) - h.width / 2 - env.ROBOT_RADIUS
                        for h in humans), default=float("inf"))
            reward = (dmin - self.DISCOMFORT_DIST) * self.DISCOMFORT_FACTOR * env.TIMESTEP \
                if dmin < self.DISCOMFORT_DIST else 0.0
        self.info["DISCOMFORT_SNGNN"] = 0.0
        self.info["DISCOMFORT_DSRNN"] = 0.0
        self.info["distance_reward"] = 0.0
        return float(reward)
