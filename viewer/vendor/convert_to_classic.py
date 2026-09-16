"""One-off tool: convert vendored three.js ES modules into classic <script> files.

Why: ?simple=1 must work when index.html is opened via file://, where browsers
block ES module imports. Classic scripts load fine from file://.
Run once after updating three.js sources in vendor/src. Output is committed;
the viewer itself has no build step.
"""
import re, pathlib

here = pathlib.Path(__file__).parent

# 1. three.module.min.js -> three.classic.js (window.THREE)
src = (here / "three.module.min.js").read_text()
m = re.search(r"export\{([^}]*)\};?\s*$", src)
pairs = []
for item in m.group(1).split(","):
    local, _, name = item.strip().partition(" as ")
    pairs.append(f"{name or local}:{local}")
body = src[: m.start()]
(here / "three.classic.js").write_text(
    "(function(){\n" + body + "\nwindow.THREE={" + ",".join(pairs) + "};\n})();\n"
)

# 2. addons -> classic scripts that read from and write to window.THREE
def convert(rel):
    code = (here / "src" / rel).read_text()
    code = re.sub(r"import\s*\{([^}]*)\}\s*from\s*'three';",
                  lambda mm: "const {" + mm.group(1) + "} = THREE;", code)
    code = re.sub(r"import\s*\{([^}]*)\}\s*from\s*'[^']*BufferGeometryUtils\.js';",
                  lambda mm: "const {" + mm.group(1) + "} = THREE.BufferGeometryUtils;", code)
    exported = []
    code = re.sub(r"^export function (\w+)", lambda mm: (exported.append(mm.group(1)), "function " + mm.group(1))[1], code, flags=re.M)
    def grab(mm):
        exported.extend(n.strip() for n in mm.group(1).split(",") if n.strip())
        return ""
    code = re.sub(r"^export\s*\{([^}]*)\};?", grab, code, flags=re.M)
    assert "import " not in code.split("\n", 3)[0] and not re.search(r"^\s*(import|export)\b", code, re.M), rel
    return code, sorted(set(exported))

out = []
for rel, ns in [("utils/BufferGeometryUtils.js", "BufferGeometryUtils"),
                ("utils/SkeletonUtils.js", "SkeletonUtils"),
                ("controls/OrbitControls.js", None),
                ("loaders/GLTFLoader.js", None)]:
    code, names = convert(rel)
    exports = ",".join(names)
    target = f"THREE.{ns}={{{exports}}};" if ns else f"Object.assign(THREE,{{{exports}}});"
    out.append(f"// ---- {rel} (three.js r170, MIT) ----\n(function(){{\n{code}\n{target}\n}})();\n")
(here / "three-addons.classic.js").write_text("\n".join(out))
print("ok")
