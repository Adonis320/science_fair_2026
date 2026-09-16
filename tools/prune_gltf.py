#!/usr/bin/env python3
"""Strip a .gltf (embedded buffers) down to selected animations and write a compact .glb.

Used once to vendor the Quaternius characters: each source file has 17 animation clips,
the viewer only needs Walk and Idle. Unused accessors/bufferViews are dropped.
Usage: python tools/prune_gltf.py in.gltf out.glb Walk Idle
"""
import base64, json, struct, sys


def main(src, dst, keep):
    d = json.load(open(src))
    raw = [base64.b64decode(b["uri"].split(",", 1)[1]) for b in d["buffers"]]
    d["animations"] = [a for a in d.get("animations", []) if a["name"] in keep]
    missing = set(keep) - {a["name"] for a in d["animations"]}
    assert not missing, f"{src}: missing animations {missing}"

    used = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("accessor", "input", "output", "indices", "inverseBindMatrices") and isinstance(v, int):
                    used.add(v)
                elif k in ("attributes", "targets"):
                    for vv in (v.values() if isinstance(v, dict) else [x for t in v for x in t.values()]):
                        used.add(vv)
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    for key in ("meshes", "skins", "animations"):
        walk(d.get(key, []))

    new_acc, acc_map, blob, bv_list = [], {}, bytearray(), []
    for i in sorted(used):
        acc = dict(d["accessors"][i])
        bv = d["bufferViews"][acc["bufferView"]]
        data = raw[bv["buffer"]][bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        while len(blob) % 4:
            blob.append(0)
        nbv = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
        if "byteStride" in bv: nbv["byteStride"] = bv["byteStride"]
        if "target" in bv: nbv["target"] = bv["target"]
        blob.extend(data)
        acc["bufferView"] = len(bv_list)
        bv_list.append(nbv)
        acc_map[i] = len(new_acc)
        new_acc.append(acc)

    def remap(o):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k in ("accessor", "input", "output", "indices", "inverseBindMatrices") and isinstance(v, int):
                    o[k] = acc_map[v]
                elif k == "attributes":
                    o[k] = {a: acc_map[x] for a, x in v.items()}
                elif k == "targets":
                    o[k] = [{a: acc_map[x] for a, x in t.items()} for t in v]
                else:
                    remap(v)
        elif isinstance(o, list):
            for v in o:
                remap(v)
    for key in ("meshes", "skins", "animations"):
        remap(d.get(key, []))
    d["accessors"], d["bufferViews"] = new_acc, bv_list
    while len(blob) % 4:
        blob.append(0)
    d["buffers"] = [{"byteLength": len(blob)}]

    js = json.dumps(d, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], set(sys.argv[3:]))
