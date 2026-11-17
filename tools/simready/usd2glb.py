#!/usr/bin/env python3
"""
Convert an Omniverse / SimReady USD asset (fetched with fetch.py) into a compact glTF
binary for the browser.

    PYTHONPATH=<usd-core site> python3 tools/simready/usd2glb.py <bucket key | path> out.glb [options]
    PYTHONPATH=<usd-core site> python3 tools/simready/usd2glb.py tools/simready/assets.json [names...]

What it does
  * composes the stage (instance proxies included), exports the default prim's subtree
  * bakes world transforms, converts Z-up / centimetre stages to Y-up metres
  * triangulates, keeps authored normals (or computes creased normals), flips UV v
  * maps OmniPBR / SimPBR / OmniGlass MDL and UsdPreviewSurface inputs onto glTF PBR
  * merges all geometry by material into one mesh, except subtrees named by --keep, which
    become separate nodes pivoting on their USD origin (wheels, forks, signal heads...)
  * hands off to optimize.mjs (gltf-transform): texture averaging / WebP, weld,
    meshoptimizer simplification, quantization and EXT_meshopt_compression
"""

import argparse
import json
import math
import os
import re
import struct
import subprocess
import sys

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("SIMREADY_CACHE", "/tmp/simready-cache")
UV_NAMES = ("st", "st0", "st_0", "UVMap", "uv", "uv0", "map1", "UVW")


# ------------------------------------------------------------------ materials


def tone_guess(name: str):
    """Fallback colour from SimReady material naming (m_opaque__plastic__glossy_white_a01)."""
    n = name.lower()
    table = [
        ("white", (0.78, 0.78, 0.78)),
        ("black", (0.035, 0.035, 0.035)),
        ("dark", (0.08, 0.08, 0.08)),
        ("chrome", (0.75, 0.75, 0.75)),
        ("stainless", (0.62, 0.62, 0.62)),
        ("steel", (0.5, 0.5, 0.5)),
        ("alumin", (0.7, 0.7, 0.7)),
        ("rubber", (0.04, 0.04, 0.04)),
        ("tire", (0.04, 0.04, 0.04)),
        ("glass", (0.9, 0.92, 0.93)),
        ("wood", (0.35, 0.24, 0.15)),
        ("cardboard", (0.45, 0.32, 0.2)),
        ("concrete", (0.45, 0.45, 0.43)),
        ("red", (0.45, 0.04, 0.04)),
        ("orange", (0.8, 0.3, 0.04)),
        ("yellow", (0.8, 0.6, 0.05)),
        ("green", (0.08, 0.35, 0.1)),
        ("blue", (0.05, 0.15, 0.45)),
        ("beige", (0.6, 0.52, 0.4)),
        ("gray", (0.3, 0.3, 0.3)),
        ("grey", (0.3, 0.3, 0.3)),
        ("silver", (0.65, 0.65, 0.65)),
        ("brass", (0.6, 0.45, 0.2)),
        ("copper", (0.6, 0.35, 0.2)),
        ("fabric", (0.35, 0.35, 0.35)),
        ("leather", (0.12, 0.1, 0.08)),
        ("plastic", (0.5, 0.5, 0.5)),
        ("metal", (0.55, 0.55, 0.55)),
    ]
    for key, rgb in table:
        if key in n:
            return rgb
    return (0.55, 0.55, 0.55)


def finish_guess(name: str):
    n = name.lower()
    metal = 0.0
    rough = 0.55
    if any(k in n for k in ("chrome", "stainless", "steel", "alumin", "metal", "brass", "copper", "silver")):
        metal, rough = 0.85, 0.35
        if "painted" in n or "powder" in n:
            metal, rough = 0.15, 0.5
    if "chrome" in n:
        rough = 0.12
    if "glossy" in n:
        rough = min(rough, 0.3)
    if any(k in n for k in ("rubber", "fabric", "tweed", "cloth", "foam", "cardboard", "concrete", "wood")):
        rough = 0.85
    return metal, rough


def input_value(shader, name, default=None):
    inp = shader.GetInput(name)
    if not inp:
        return default
    attrs = inp.GetValueProducingAttributes()
    for a in attrs:
        if a.GetPrim().IsA(UsdShade.Shader) and a.GetPrim() != shader.GetPrim():
            continue
        v = a.Get()
        if v is not None:
            return v, a
    v = inp.Get()
    if v is None:
        return default
    return v, inp.GetAttr()


def asset_file(value, attr):
    """Resolve an asset-valued input to a local file, falling back to NVIDIA's 256px thumbnail."""
    if value is None:
        return None
    authored = value.path if isinstance(value, Sdf.AssetPath) else str(value)
    if not authored:
        return None
    authored = authored.replace("<UDIM>", "1001").replace("<udim>", "1001")
    candidates = []
    if isinstance(value, Sdf.AssetPath) and value.resolvedPath:
        candidates.append(value.resolvedPath.replace("<UDIM>", "1001"))
    for spec in attr.GetPropertyStack(Usd.TimeCode.Default()) if attr else []:
        layer = spec.layer
        if layer and not layer.anonymous:
            candidates.append(os.path.normpath(os.path.join(os.path.dirname(layer.realPath), authored)))
    for c in candidates:
        if os.path.isfile(c):
            return c
        thumb = os.path.join(os.path.dirname(c), ".thumbs", "256x256", os.path.basename(c) + ".auto.png")
        if os.path.isfile(thumb):
            return thumb
    return None


def material_info(material):
    name = material.GetPrim().GetName()
    info = {
        "name": name,
        "color": None,
        "tint": (1.0, 1.0, 1.0),
        "texture": None,
        "flatten": False,
        "metal": None,
        "rough": None,
        "opacity": 1.0,
        "emissive": (0.0, 0.0, 0.0),
        "glass": False,
    }
    shader = None
    for ctx in ("mdl", ""):
        src = material.ComputeSurfaceSource(ctx)
        if src and src[0]:
            shader = src[0]
            break
    if shader is None:
        return finalize(info)
    sub = (shader.GetSourceAssetSubIdentifier("mdl") or "").lower()
    asset = str(shader.GetSourceAsset("mdl") or "").lower()
    sid = str(shader.GetIdAttr().Get() or "")
    if "glass" in sub or "glass" in asset:
        info["glass"] = True
        gc = input_value(shader, "glass_color")
        if gc:
            info["color"] = tuple(gc[0])
        return finalize(info)
    if sid == "UsdPreviewSurface":
        dc = shader.GetInput("diffuseColor")
        if dc and dc.HasConnectedSource():
            src_shader = UsdShade.Shader(dc.GetConnectedSources()[0][0].source.GetPrim())
            f = input_value(src_shader, "file")
            if f:
                info["texture"] = asset_file(*f)
        elif dc and dc.Get() is not None:
            info["color"] = tuple(dc.Get())
        for key, field in (("roughness", "rough"), ("metallic", "metal"), ("opacity", "opacity")):
            v = input_value(shader, key)
            if v and not shader.GetInput(key).HasConnectedSource():
                info[field] = float(v[0])
        ec = input_value(shader, "emissiveColor")
        if ec:
            info["emissive"] = tuple(ec[0])
        return finalize(info)
    # OmniPBR / SimPBR / OmniSurface-ish MDL
    dcc = input_value(shader, "diffuse_color_constant") or input_value(shader, "diffuse_reflection_color")
    if dcc:
        info["color"] = tuple(dcc[0])
    tex = input_value(shader, "diffuse_texture")
    if tex and (tex[0].path if isinstance(tex[0], Sdf.AssetPath) else str(tex[0])):
        info["texture"] = asset_file(*tex)
        if info["texture"] is None:
            # MDL ignores the constant when a map is bound; approximate the unfetched map by name
            info["color"] = tone_guess(name)
        authored = tex[0].path if isinstance(tex[0], Sdf.AssetPath) else ""
        scale = input_value(shader, "texture_scale")
        tiled = scale is not None and (abs(scale[0][0] - 1) > 1e-3 or abs(scale[0][1] - 1) > 1e-3)
        info["flatten"] = "<UDIM>" in authored or "_tile_" in authored.lower() or tiled
    tint = input_value(shader, "diffuse_tint")
    if tint:
        info["tint"] = tuple(tint[0])
    rough = input_value(shader, "reflection_roughness_constant")
    if rough and shader.GetInput("reflection_roughness_constant").GetAttr().HasAuthoredValue():
        info["rough"] = float(rough[0])
    metal = input_value(shader, "metallic_constant")
    if metal and shader.GetInput("metallic_constant").GetAttr().HasAuthoredValue():
        info["metal"] = float(metal[0])
    en_op = input_value(shader, "enable_opacity")
    if en_op and en_op[0]:
        op = input_value(shader, "opacity_constant")
        if op and float(op[0]) < 0.99:
            info["opacity"] = float(op[0])
    en_em = input_value(shader, "enable_emission")
    if en_em and en_em[0]:
        ec = input_value(shader, "emissive_color")
        if ec:
            info["emissive"] = tuple(ec[0])
    return finalize(info)


def finalize(info):
    name = info["name"]
    metal, rough = finish_guess(name)
    if info["metal"] is None:
        info["metal"] = metal
    if info["rough"] is None:
        info["rough"] = rough
    if info["color"] is None or (info["texture"] is None and sum(info["color"]) < 1e-4 and "black" not in name.lower()):
        if info["texture"] is None:
            info["color"] = tone_guess(name)
        else:
            info["color"] = (1.0, 1.0, 1.0)
    if info["texture"] is not None:
        info["color"] = (1.0, 1.0, 1.0)
    if "trans__" in name.lower() or "glass" in name.lower():
        info["glass"] = True
    if info["glass"]:
        info["opacity"] = min(info["opacity"], 0.28)
        info["rough"] = 0.08
        info["metal"] = 0.0
        info["texture"] = None
        info["color"] = tuple(max(0.75, c) for c in info["color"])
    if "emissive" in name.lower() and max(info["emissive"]) == 0:
        info["emissive"] = tuple(c * 0.6 for c in tone_guess(name))
    return info


# ------------------------------------------------------------------ geometry


def flattened(primvar, time):
    if not primvar or not primvar.HasValue():
        return None, None
    v = primvar.ComputeFlattened(time)
    if v is None:
        return None, None
    return np.asarray(v, dtype=np.float64), primvar.GetInterpolation()


def gather(values, interp, corners, face_of_corner, point_of_corner):
    if values is None:
        return None
    if interp in ("vertex", "varying"):
        idx = point_of_corner[corners]
    elif interp == "faceVarying":
        idx = corners
    elif interp == "uniform":
        idx = face_of_corner[corners]
    else:  # constant
        return np.repeat(values[:1], len(corners), axis=0)
    if idx.max(initial=-1) >= len(values):
        return None
    return values[idx]


def creased_normals(P, tri_pts, crease_deg):
    """Per-corner normals: average adjacent face normals within the crease angle."""
    a, b, c = P[tri_pts[:, 0]], P[tri_pts[:, 1]], P[tri_pts[:, 2]]
    fn = np.cross(b - a, c - a)
    fu = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-20)
    T = len(tri_pts)
    cv = tri_pts.reshape(-1)
    cf = np.repeat(np.arange(T), 3)
    order = np.argsort(cv, kind="stable")
    sv = cv[order]
    starts = np.flatnonzero(np.r_[True, sv[1:] != sv[:-1]])
    sizes = np.diff(np.r_[starts, len(sv)])
    if (sizes.astype(np.int64) ** 2).sum() > 40_000_000:
        # pathological valence: fall back to flat shading
        return np.repeat(fu, 3, axis=0)
    group_of = np.repeat(np.arange(len(starts)), sizes)
    reps = sizes[group_of]
    i = np.repeat(np.arange(len(sv)), reps)
    offs = np.arange(len(i)) - np.repeat(np.cumsum(reps) - reps, reps)
    j = starts[group_of[i]] + offs
    fi = cf[order[i]]
    fj = cf[order[j]]
    ok = (fu[fi] * fu[fj]).sum(1) >= math.cos(math.radians(crease_deg))
    acc = np.zeros((len(sv), 3))
    np.add.at(acc, i[ok], fn[fj[ok]])
    out = np.zeros((len(cv), 3))
    out[order] = acc
    n = np.linalg.norm(out, axis=1, keepdims=True)
    out = np.where(n > 1e-20, out / np.maximum(n, 1e-20), np.repeat(fu, 3, axis=0))
    return out


def convert_axes(v, up):
    if up == "Z":
        return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)
    return v


def export(src, out, opts):
    path = src if os.path.isfile(src) else os.path.join(CACHE, src.lstrip("/"))
    stage = Usd.Stage.Open(path)
    up = UsdGeom.GetStageUpAxis(stage)
    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 1.0
    root = stage.GetPrimAtPath(opts.root) if opts.root else stage.GetDefaultPrim()
    if not root:
        root = stage.GetPseudoRoot()
    exclude = re.compile(opts.exclude) if opts.exclude else None
    keep = re.compile(opts.keep) if opts.keep else None
    time = Usd.TimeCode.EarliestTime()
    xcache = UsdGeom.XformCache(time)
    bbox = UsdGeom.BBoxCache(time, ["default", "render"])

    mats = {}  # material path -> index
    mat_list = []
    groups = {}  # (node, mat) -> lists
    pivots = {}  # node name -> pivot (y-up metres)
    yaw = math.radians(opts.yaw)
    cy, sy = math.cos(yaw), math.sin(yaw)

    def to_out(v):
        v = convert_axes(v, up) * (mpu * opts.scale)
        if yaw:
            x, z = v[:, 0].copy(), v[:, 2].copy()
            v[:, 0] = cy * x + sy * z
            v[:, 2] = -sy * x + cy * z
        return v

    def to_out_dir(v):
        v = convert_axes(v, up)
        if yaw:
            x, z = v[:, 0].copy(), v[:, 2].copy()
            v[:, 0] = cy * x + sy * z
            v[:, 2] = -sy * x + cy * z
        return v

    def material_index(mat):
        if not mat:
            key = "__default__"
            if key not in mats:
                mats[key] = len(mat_list)
                mat_list.append(finalize({"name": "default", "color": None, "tint": (1, 1, 1), "texture": None, "flatten": False, "metal": None, "rough": None, "opacity": 1.0, "emissive": (0, 0, 0), "glass": False}))
            return mats[key]
        key = str(mat.GetPath())
        if key not in mats:
            mats[key] = len(mat_list)
            mat_list.append(material_info(mat))
        return mats[key]

    it = iter(Usd.PrimRange(root, Usd.TraverseInstanceProxies()))
    tri_total = 0
    for prim in it:
        p = prim.GetPath().pathString
        if exclude and exclude.search(p):
            it.PruneChildren() if hasattr(it, "PruneChildren") else None
            continue
        if prim.IsA(UsdGeom.Imageable):
            img = UsdGeom.Imageable(prim)
            if img.ComputePurpose() in ("guide", "proxy") or img.ComputeVisibility(time) == "invisible":
                continue
        if not prim.IsA(UsdGeom.Mesh):
            continue
        # node assignment: nearest ancestor (or self) whose name matches --keep
        node = ""
        if keep:
            anc = prim
            while anc and anc != root.GetParent():
                if keep.search(anc.GetName()):
                    node = anc.GetName()
                    if node not in pivots:
                        m = np.array(xcache.GetLocalToWorldTransform(anc))
                        pivots[node] = to_out(m[3:4, :3])[0]
                    break
                anc = anc.GetParent()
        mesh = UsdGeom.Mesh(prim)
        pts = mesh.GetPointsAttr().Get(time)
        counts = mesh.GetFaceVertexCountsAttr().Get(time)
        fvi = mesh.GetFaceVertexIndicesAttr().Get(time)
        if not pts or not counts or not fvi:
            continue
        P = np.asarray(pts, dtype=np.float64)
        counts = np.asarray(counts, dtype=np.int64)
        fvi = np.asarray(fvi, dtype=np.int64)
        F = len(counts)
        valid = counts >= 3
        ntri = np.where(valid, counts - 2, 0)
        face_start = np.cumsum(counts) - counts
        tri_face = np.repeat(np.arange(F), ntri)
        if len(tri_face) == 0:
            continue
        k = np.arange(len(tri_face)) - np.repeat(np.cumsum(ntri) - ntri, ntri) + 1
        c0 = face_start[tri_face]
        c1 = c0 + k
        c2 = c1 + 1
        corners = np.stack([c0, c1, c2], axis=1)
        if mesh.GetOrientationAttr().Get() == "leftHanded":
            corners = corners[:, [0, 2, 1]]
        face_of_corner = np.repeat(np.arange(F), counts)
        tri_pts = fvi[corners]
        # world transform
        M = np.array(xcache.GetLocalToWorldTransform(prim))
        B = M[:3, :3]
        if np.linalg.det(B) < 0:
            corners = corners[:, [0, 2, 1]]
            tri_pts = tri_pts[:, [0, 2, 1]]
        flat_c = corners.reshape(-1)
        # normals
        pv = UsdGeom.PrimvarsAPI(prim)
        nvals, ninterp = flattened(pv.GetPrimvar("normals"), time)
        if nvals is None:
            na = mesh.GetNormalsAttr().Get(time)
            if na:
                nvals, ninterp = np.asarray(na, dtype=np.float64), mesh.GetNormalsInterpolation()
        N = gather(nvals, ninterp, flat_c, face_of_corner, fvi) if nvals is not None and nvals.ndim == 2 else None
        if N is None:
            N = creased_normals(P, tri_pts, opts.crease)
        # uvs
        UV = None
        for nm in UV_NAMES:
            uvv, uvi = flattened(pv.GetPrimvar(nm), time)
            if uvv is not None and uvv.ndim == 2 and uvv.shape[1] >= 2:
                UV = gather(uvv[:, :2], uvi, flat_c, face_of_corner, fvi)
                break
        if UV is None:
            for prv in pv.GetPrimvars():
                if str(prv.GetTypeName()) in ("texCoord2f[]", "float2[]") and prv.HasValue():
                    uvv, uvi = flattened(prv, time)
                    if uvv is not None:
                        UV = gather(uvv[:, :2], uvi, flat_c, face_of_corner, fvi)
                        break
        Pw = P[tri_pts.reshape(-1)] @ B + M[3, :3]
        Nw = N @ np.linalg.inv(B).T
        Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-20)
        Pw = to_out(Pw)
        Nw = to_out_dir(Nw)
        # material per face
        bind = UsdShade.MaterialBindingAPI(prim)
        base_mat = material_index(bind.ComputeBoundMaterial()[0])
        face_mat = np.full(F, base_mat, dtype=np.int64)
        for subset in bind.GetMaterialBindSubsets():
            ids = subset.GetIndicesAttr().Get(time)
            if ids is None or len(ids) == 0:
                continue
            mi = material_index(UsdShade.MaterialBindingAPI(subset.GetPrim()).ComputeBoundMaterial()[0])
            ids = np.asarray(ids, dtype=np.int64)
            face_mat[ids[ids < F]] = mi
        tri_mat = face_mat[tri_face]
        for mi in np.unique(tri_mat):
            sel = np.repeat(tri_mat == mi, 3)
            g = groups.setdefault((node, int(mi)), {"P": [], "N": [], "UV": []})
            g["P"].append(Pw[sel])
            g["N"].append(Nw[sel])
            g["UV"].append(UV[sel] if UV is not None else np.zeros((int(sel.sum()), 2)))
        tri_total += len(tri_face)

    if not groups:
        sys.exit(f"no geometry exported from {src}")

    # recentre
    allP = np.concatenate([np.concatenate(g["P"]) for g in groups.values()])
    lo, hi = allP.min(0), allP.max(0)
    shift = np.zeros(3)
    if opts.center in ("base", "xz"):
        shift[0] = -(lo[0] + hi[0]) / 2
        shift[2] = -(lo[2] + hi[2]) / 2
    if opts.center in ("base", "floor"):
        shift[1] = -lo[1]
    if opts.tris:
        opts.ratio = min(1.0, opts.tris / max(tri_total, 1))
    write_gltf(out, groups, mat_list, pivots, shift, opts)
    size = hi - lo
    print(f"  {os.path.basename(out)}: {tri_total} tris, {len(mat_list)} materials, size {size.round(3).tolist()} m")


# ------------------------------------------------------------------ glTF writer


def write_gltf(out, groups, mat_list, pivots, shift, opts):
    import tempfile

    stem = os.path.join(tempfile.gettempdir(), os.path.basename(out))
    work = stem + ".tmp.gltf"
    binpath = stem + ".tmp.bin"
    blob = bytearray()
    accessors, views, meshes, nodes, materials, images, textures = [], [], [], [], [], [], []

    def add(arr, comp, typ, target=None, minmax=False):
        data = arr.astype(np.float32 if comp == 5126 else np.uint32).tobytes()
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), **({"target": target} if target else {})})
        blob.extend(data)
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": len(arr), "type": typ}
        if minmax:
            acc["min"] = arr.min(0).tolist()
            acc["max"] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    tex_index = {}
    for m in mat_list:
        pbr = {
            "baseColorFactor": [*[float(c * t) for c, t in zip(m["color"], m["tint"])], float(m["opacity"])],
            "metallicFactor": float(m["metal"]),
            "roughnessFactor": float(min(max(m["rough"], 0.04), 1.0)),
        }
        if m["texture"]:
            tpath = m["texture"]
            if tpath not in tex_index:
                images.append({"uri": os.path.relpath(tpath, os.path.dirname(work)).replace(os.sep, "/")})
                textures.append({"source": len(images) - 1, "sampler": 0})
                tex_index[tpath] = len(textures) - 1
            pbr["baseColorTexture"] = {"index": tex_index[tpath]}
            # tint still applies on top of the texture
            pbr["baseColorFactor"] = [float(t) for t in m["tint"]] + [float(m["opacity"])]
        mat = {"name": m["name"], "pbrMetallicRoughness": pbr, "extras": {"flatten": bool(m["flatten"])}}
        if m["opacity"] < 0.99:
            mat["alphaMode"] = "BLEND"
        if max(m["emissive"]) > 0:
            mat["emissiveFactor"] = [float(min(1.0, c)) for c in m["emissive"]]
        if m["glass"] or opts.double_sided:
            mat["doubleSided"] = True
        materials.append(mat)

    by_node = {}
    for (node, mi), g in groups.items():
        by_node.setdefault(node, []).append((mi, g))
    scene_nodes = []
    for node, items in sorted(by_node.items(), key=lambda kv: kv[0]):
        pivot = (pivots.get(node, np.zeros(3)) + shift) if node else np.zeros(3)
        prims = []
        for mi, g in items:
            P = np.concatenate(g["P"]) + shift - pivot
            N = np.concatenate(g["N"])
            UV = np.concatenate(g["UV"])
            attrs = {"POSITION": add(P, 5126, "VEC3", 34962, True), "NORMAL": add(N, 5126, "VEC3", 34962)}
            if mat_list[mi]["texture"]:
                uv = UV.copy()
                uv[:, 1] = 1.0 - uv[:, 1]
                attrs["TEXCOORD_0"] = add(uv, 5126, "VEC2", 34962)
            ind = add(np.arange(len(P)), 5125, "SCALAR", 34963)
            prims.append({"attributes": attrs, "indices": ind, "material": mi})
        meshes.append({"name": node or "body", "primitives": prims})
        nd = {"name": node or "body", "mesh": len(meshes) - 1}
        if node:
            nd["translation"] = pivot.tolist()
        nodes.append(nd)
        scene_nodes.append(len(nodes) - 1)

    doc = {
        "asset": {"version": "2.0", "generator": "tools/simready/usd2glb.py"},
        "scene": 0,
        "scenes": [{"nodes": scene_nodes}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"uri": os.path.basename(binpath), "byteLength": len(blob)}],
    }
    if images:
        doc["images"] = images
        doc["textures"] = textures
        doc["samplers"] = [{"wrapS": 10497, "wrapT": 10497}]
    with open(binpath, "wb") as f:
        f.write(blob)
    with open(work, "w") as f:
        json.dump(doc, f)
    cmd = [
        "node",
        os.path.join(HERE, "optimize.mjs"),
        work,
        out,
        "--ratio", str(opts.ratio),
        "--error", str(opts.error),
        "--tex", str(opts.tex),
    ]
    subprocess.run(cmd, check=True)
    os.remove(work)
    os.remove(binpath)


# ------------------------------------------------------------------ cli


def parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out", nargs="?")
    ap.add_argument("names", nargs="*")
    ap.add_argument("--root", help="prim path to export (default: the stage default prim)")
    ap.add_argument("--exclude", default="", help="regex on prim paths to skip")
    ap.add_argument("--keep", default="", help="regex on prim names to keep as separate pivoted nodes")
    ap.add_argument("--tris", type=int, default=20000, help="target triangle budget (sets --ratio)")
    ap.add_argument("--ratio", type=float, default=1.0, help="meshopt simplify target ratio")
    ap.add_argument("--error", type=float, default=0.01, help="meshopt simplify error (relative)")
    ap.add_argument("--tex", type=int, default=256, help="max texture size")
    ap.add_argument("--crease", type=float, default=40.0)
    ap.add_argument("--yaw", type=float, default=0.0, help="rotate about +Y (degrees)")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--center", choices=["none", "base", "xz", "floor"], default="base")
    ap.add_argument("--double-sided", action="store_true")
    return ap


def main():
    ap = parser()
    args = ap.parse_args()
    if args.src.endswith(".json"):
        with open(args.src) as f:
            manifest = json.load(f)
        out_dir = os.path.join(os.path.dirname(HERE), "..", "public", "models")
        wanted = ([args.out] if args.out else []) + args.names
        for name, spec in manifest.items():
            if name.startswith("_") or (wanted and name not in wanted):
                continue
            opts = ap.parse_args([spec["src"], "x", *spec.get("args", [])])
            export(spec["src"], os.path.normpath(os.path.join(out_dir, name + ".glb")), opts)
        return
    if not args.out:
        ap.error("out is required")
    export(args.src, args.out, args)


if __name__ == "__main__":
    main()
