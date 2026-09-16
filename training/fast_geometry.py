"""Faster drop-in geometry for SocNavGym, applied at runtime (the installed package is not edited).

About two thirds of each simulation step is spent in Object.collides, which builds shapely buffers
for every pair check, and in get_nearest_point_from_rectangle, which inverts a 3x3 matrix per call.
Both are replaced by closed-form versions:

- circle vs circle:     centre distance <= r1 + r2
- circle vs rectangle:  distance from centre to the rectangle's nearest point <= r
- rectangle vs rectangle (only happens while spawning furniture): original shapely code

Shapely approximates circles with 64-sided polygons, so results can differ only for shapes that
touch within ~0.1% of a radius. Training and export both import socnav_common, which applies this
patch, so the robot is trained and played back under the same geometry.
"""
import math

import socnavgym.envs.socnavenv_v1 as _env_mod
import socnavgym.envs.utils.object as _object_mod
import socnavgym.envs.utils.utils as _utils_mod

_original_collides = _object_mod.Object.collides


def nearest_point_on_rectangle(center_x, center_y, length, width, orientation, point_x, point_y):
    c, s = math.cos(orientation), math.sin(orientation)
    dx, dy = point_x - center_x, point_y - center_y
    lx = c * dx + s * dy               # along the length axis
    ly = -s * dx + c * dy              # along the width axis
    lx = min(max(lx, -length / 2), length / 2)
    ly = min(max(ly, -width / 2), width / 2)
    return (center_x + c * lx - s * ly, center_y + s * lx + c * ly)


def _shape(obj):
    """('circle', x, y, r) or ('rect', x, y, length, width, theta), or None for anything else."""
    name = obj.name
    if name in ("plant", "robot"):
        return ("circle", obj.x, obj.y, obj.radius)
    if name == "human":
        return ("circle", obj.x, obj.y, obj.width / 2)
    if name in ("laptop", "table", "chair"):
        return ("rect", obj.x, obj.y, obj.length, obj.width, obj.orientation)
    if name == "wall":
        return ("rect", obj.x, obj.y, obj.length, obj.thickness, obj.orientation)
    return None


def fast_collides(self, obj):
    if obj.name in ("human-human-interaction", "human-laptop-interaction"):
        return obj.collides(self)
    a, b = _shape(self), _shape(obj)
    if a is None or b is None or (a[0] == "rect" and b[0] == "rect"):
        return _original_collides(self, obj)
    if a[0] == "circle" and b[0] == "circle":
        return math.hypot(a[1] - b[1], a[2] - b[2]) <= a[3] + b[3]
    circle, rect = (a, b) if a[0] == "circle" else (b, a)
    px, py = nearest_point_on_rectangle(rect[1], rect[2], rect[3], rect[4], rect[5], circle[1], circle[2])
    return math.hypot(circle[1] - px, circle[2] - py) <= circle[3]


def apply():
    _object_mod.Object.collides = fast_collides
    _utils_mod.get_nearest_point_from_rectangle = nearest_point_on_rectangle
    _env_mod.get_nearest_point_from_rectangle = nearest_point_on_rectangle
