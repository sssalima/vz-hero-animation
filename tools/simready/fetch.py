#!/usr/bin/env python3
"""
Download an Omniverse / SimReady USD asset and everything it composes from the public
NVIDIA content bucket into a local mirror, so `usd2glb.py` can open it offline.

    PYTHONPATH=<usd-core site> python3 tools/simready/fetch.py Assets/Isaac/6.2/Isaac/SimReady/.../asset.usd

Layers (sublayers, references, payloads) are followed recursively. Texture maps can be
hundreds of MB each, so only colour maps are fetched: the 256 px `.thumbs` render NVIDIA
ships next to many textures when it exists, otherwise the source file if it is small.
Normal / ORM / roughness maps are skipped; the converter uses the material constants.

The mirror lives in $SIMREADY_CACHE (default /tmp/simready-cache) and mirrors bucket keys.
"""

import os
import posixpath
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from pxr import Sdf, UsdUtils

BUCKET = "https://omniverse-content-production.s3-us-west-2.amazonaws.com/"
CACHE = os.environ.get("SIMREADY_CACHE", "/tmp/simready-cache")
MAX_TEXTURE_BYTES = 3_000_000
LAYER_EXT = (".usd", ".usda", ".usdc", ".usdz")
# SimReady 6.x ships MuJoCo / Newton physics variants next to the default PhysX one; skip them
SKIP_LAYERS = ("instances_mujoco.", "instances_newton.", "/MuJoCo/enabled.", "/Newton/enabled.")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".tga", ".exr", ".hdr", ".tif", ".tiff", ".dds")
COLOR_HINTS = ("albedo", "_alb", "basecolor", "base_color", "diffuse", "_color", "_col", "_bc", "_d.", "opacity", "emissive", "_mask")
SKIP_HINTS = ("normal", "_nor", "_nrm", "_n.", "orm", "rough", "metal", "_ao", "height", "_disp", "spec")


def local_path(key: str) -> str:
    return os.path.join(CACHE, key)


def head(key: str):
    req = urllib.request.Request(BUCKET + urllib.parse.quote(key), method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.headers.get("Content-Length", "0"))
    except urllib.error.HTTPError:
        return None


def download(key: str) -> bool:
    dst = local_path(key)
    if os.path.exists(dst):
        return True
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(BUCKET + urllib.parse.quote(key), timeout=300) as r:
                data = r.read()
            break
        except urllib.error.HTTPError as e:
            print(f"  missing {key} ({e.code})", file=sys.stderr)
            return False
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            if attempt == 3:
                print(f"  failed {key}: {e}", file=sys.stderr)
                return False
            time.sleep(2 + attempt * 3)
    with open(dst + ".part", "wb") as f:
        f.write(data)
    os.replace(dst + ".part", dst)
    return True


def resolve(base_key: str, asset: str):
    """Resolve an asset path authored in layer `base_key` to a bucket key (None if external)."""
    asset = asset.strip()
    if not asset or asset.startswith(("omniverse://", "http://", "https://", "file:")):
        if asset.startswith(BUCKET):
            return urllib.parse.unquote(asset[len(BUCKET):])
        return None
    if asset.startswith("/"):
        return None
    asset = asset.replace("\\", "/")
    if asset.startswith("./"):
        asset = asset[2:]
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_key), asset))


def is_color_map(key: str) -> bool:
    name = posixpath.basename(key).lower()
    if any(h in name for h in SKIP_HINTS) and not any(h in name for h in COLOR_HINTS):
        return False
    return True


def fetch_texture(key: str):
    if "<UDIM>" in key or "<udim>" in key:
        key = key.replace("<UDIM>", "1001").replace("<udim>", "1001")
    if not is_color_map(key):
        return
    if os.path.exists(local_path(key)):
        return
    thumb = posixpath.join(posixpath.dirname(key), ".thumbs", "256x256", posixpath.basename(key) + ".auto.png")
    if os.path.exists(local_path(thumb)) or (head(thumb) and download(thumb)):
        return
    size = head(key)
    if size is not None and size <= MAX_TEXTURE_BYTES:
        download(key)


def fetch(root_key: str):
    seen = set()
    queue = [root_key]
    while queue:
        key = queue.pop()
        if key in seen:
            continue
        seen.add(key)
        if not download(key):
            continue
        try:
            layers, refs, payloads = UsdUtils.ExtractExternalReferences(local_path(key))
        except Exception as e:  # noqa: BLE001
            print(f"  could not parse {key}: {e}", file=sys.stderr)
            continue
        for asset in [*layers, *refs, *payloads]:
            dep = resolve(key, asset)
            if dep is None:
                continue
            low = dep.lower()
            if low.endswith(LAYER_EXT):
                if not any(k.lower() in low for k in SKIP_LAYERS):
                    queue.append(dep)
            elif low.endswith(IMAGE_EXT):
                fetch_texture(dep)
            elif low.endswith(".mdl"):
                # custom MDL materials carry their own texture paths; built-ins (OmniPBR) 404 harmlessly
                if download(dep):
                    scan_mdl(dep)
    print(f"fetched {root_key} ({len(seen)} layers)")


def scan_mdl(key: str):
    import re

    with open(local_path(key), "r", errors="ignore") as f:
        src = f.read()
    for m in re.finditer(r'texture_2d\(\s*"([^"]+)"', src):
        dep = resolve(key, m.group(1))
        if dep:
            fetch_texture(dep)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    Sdf.Layer  # noqa: B018  (import check)
    for k in sys.argv[1:]:
        fetch(k.lstrip("/"))
