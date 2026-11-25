"""Maintenance only: target-specific solve using bounded official metadata."""

from __future__ import annotations

import argparse
import asyncio
import email
import hashlib
import json
import platform
import re
import tarfile
import shutil
import subprocess
from collections import deque
from contextlib import ExitStack
from datetime import timedelta
from zipfile import ZipFile

import msgpack
import rattler as r
import zstandard
from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name, parse_wheel_filename
from packaging.version import Version

from artifacts import (
    CACHE,
    CF,
    EF,
    PYJS,
    ROOT,
    TARGET,
    artifact,
    check,
    download,
    write_json,
)

# Reviewed conda-forge noarch shards only; missing dependencies fail the solver.
SHARDS = """
ca-certificates certifi charset-normalizer cycler idna imageio lazy-loader lazy_loader networkx
packaging pip platformdirs pooch pyparsing python-dateutil python-tzdata python_abi
pytz requests six typing_extensions urllib3
""".split()
COMPILED = set("numpy scipy scikit-image pandas pywavelets h5py pillow rpds-py".split())
TARGET_PY = "3.14.3"
MARKERS = dict(
    sys_platform="emscripten",
    os_name="posix",
    platform_machine="wasm64",
    platform_system="Emscripten",
    platform_release="",
    platform_version="",
    implementation_name="cpython",
    implementation_version=TARGET_PY,
    platform_python_implementation="CPython",
    python_version="3.14",
    python_full_version=TARGET_PY,
    extra="",
)


def document(url, name, limit=8 << 20):
    path = CACHE / name
    download(url, path, limit)
    return path


def unpack(path):
    with path.open("rb") as f, zstandard.ZstdDecompressor().stream_reader(f) as stream:
        data = stream.read((12 << 20) + 1)
    check(len(data) <= 12 << 20, "Oversize repodata shard")
    return msgpack.unpackb(data)


def sparse_indexes():
    indexes = []
    for sub in (TARGET, "noarch"):
        path = document(f"{EF}/{sub}/repodata.json", sub + ".json")
        indexes.append(r.SparseRepoData(r.Channel(EF), sub, path))
    base = CF + "/noarch/"
    index = unpack(document(base + "repodata_shards.msgpack.zst", "shards.zst"))
    check(index["info"]["shards_base_url"] in ("", "./"), "Unknown shard URL layout")
    data = {"info": {"subdir": "noarch"}, "packages": {}, "packages.conda": {}}
    for name in SHARDS:
        digest = index["shards"][name].hex()
        shard = CACHE / (digest + ".msgpack.zst")
        if not shard.is_file():
            download(base + shard.name, shard, 2 << 20)
        check(hashlib.sha256(shard.read_bytes()).hexdigest() == digest, shard)
        records = unpack(shard)
        for key in ("packages", "packages.conda"):
            for fn, rec in records.get(key, {}).items():
                if fn not in records.get("removed", ()):
                    data[key][fn] = {
                        k: (v.hex() if isinstance(v, bytes) else v)
                        for k, v in rec.items()
                        if k != "run_exports"
                    }
    path = CACHE / "cf-noarch-subset.json"
    write_json(path, data)
    indexes.append(r.SparseRepoData(r.Channel(CF), "noarch", path))
    return indexes


def wheel(req):
    name = canonicalize_name(req.name)
    exact = next((s.version for s in req.specifier if s.operator == "=="), None)
    url = f"https://pypi.org/pypi/{name}" + ("/" + exact if exact else "") + "/json"
    release = json.loads(document(url, f"{name}.json").read_bytes())
    version = release["info"]["version"]
    check(
        version in req.specifier,
        f"Select a compatible release for {req}, found {version}",
    )
    for item in release["urls"]:
        if item["yanked"] or not item["filename"].endswith(".whl"):
            continue
        n, v, _, tags = parse_wheel_filename(item["filename"])
        if not any(
            t.interpreter == "py3" and t.abi == "none" and t.platform == "any"
            for t in tags
        ):
            continue
        check(n == name and v == Version(version), item["filename"])
        rec = dict(
            name=name,
            version=version,
            url=item["url"],
            size=item["size"],
            sha256=item["digests"]["sha256"],
        )
        with ZipFile(artifact(rec)) as z:
            [meta] = [p for p in z.namelist() if p.endswith(".dist-info/METADATA")]
            msg = email.message_from_bytes(z.read(meta))
            check(
                canonicalize_name(msg["Name"]) == n and Version(msg["Version"]) == v,
                meta,
            )
            return rec, active_requirements(msg)
    raise ValueError(f"No pure py3-none-any wheel for {name} {version}")


def app_roots():
    out = []
    for name in ("sigima", "guidata", "datalab-capsule"):
        manifest = json.loads((ROOT / f"{name}-dependency.json").read_bytes())
        check(manifest["developmentRef"] is None, "Unqualified development wheel")
        out.append(Requirement(manifest["publishedRequirement"]))
    return out


def active_requirements(msg):
    check(
        TARGET_PY in SpecifierSet(msg.get("Requires-Python", "")),
        f"{msg['Name']} {msg['Version']}: Requires-Python {msg['Requires-Python']}",
    )
    deps = [Requirement(s) for s in msg.get_all("Requires-Dist", [])]
    return [d for d in deps if d.marker is None or d.marker.evaluate(MARKERS)]


def inspect_conda(rec):
    """Read package payloads, not upstream host PyPI metadata or build-string guesses."""
    path = artifact(rec)
    print(f"Checking {path.name}", flush=True)
    with ExitStack() as stack:
        if path.suffix == ".conda":
            z = stack.enter_context(ZipFile(path))
            [part] = [
                n
                for n in z.namelist()
                if n.startswith("pkg-") and n.endswith(".tar.zst")
            ]
            reader = stack.enter_context(
                zstandard.ZstdDecompressor().stream_reader(
                    stack.enter_context(z.open(part))
                )
            )
            tar = stack.enter_context(tarfile.open(fileobj=reader, mode="r|"))
        else:
            tar = stack.enter_context(tarfile.open(path, "r|bz2"))
        for member in tar:
            name = member.name
            if ".cpython-" in name and name.endswith(".so"):
                check(
                    name.endswith(".cpython-314-wasm64-emscripten.so"),
                    f"Wrong CPython extension: {name}",
                )
            if name.endswith(".so") and member.isfile():
                check(
                    rec["subdir"] == TARGET
                    and tar.extractfile(member).read(4) == b"\0asm",
                    f"Not a target library: {name}",
                )
            if re.search(r"(?:^|/)lib/python\d+\.\d+/", name):
                check(
                    "lib/python3.14/" in name, f"Wrong Python library directory: {name}"
                )
            if name.endswith(".dist-info/METADATA") and member.isfile():
                yield email.message_from_bytes(tar.extractfile(member).read())


def solve(specs, env):
    embedded = {p["name"]: p for p in env["packages"]}
    check(
        embedded["python"]["version"] == TARGET_PY
        and embedded["python"]["subdir"] == TARGET,
        embedded["python"],
    )
    specs = sorted(
        set(specs) | {f"{n} =={p['version']} {p['build']}" for n, p in embedded.items()}
    )
    records = asyncio.run(
        r.solve_with_sparse_repodata(
            specs,
            sparse_indexes(),
            timeout=timedelta(seconds=40),
            virtual_packages=[
                r.GenericVirtualPackage(
                    r.PackageName("__unix"), r.Version("0"), r.BuildString("0")
                )
            ],
        )
    )
    out = []
    for p in r.RepoDataRecord.sort_topologically(records):
        if p.name.normalized in embedded:
            continue
        rec = json.loads(p.to_json())
        check(rec["subdir"] in (TARGET, "noarch"), rec)
        out.append(
            {
                k: rec[k]
                for k in ("name", "version", "build", "subdir", "url", "size", "sha256")
            }
        )
    return out


def main():
    from kiwi_workaround import distribution_version

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-kiwi-metadata", action="store_true")
    args = parser.parse_args()
    roots = app_roots()
    requirements = []
    wheels = {}
    for req in roots:
        rec, deps = wheel(req)
        print(f"{rec['name']} {rec['version']}: {', '.join(map(str, deps))}")
        wheels[rec["name"]] = rec
        requirements.extend(deps)
    specs = [
        canonicalize_name(d.name) + " " + str(d.specifier)
        for d in requirements
        if canonicalize_name(d.name) in COMPILED
    ]
    env = json.loads((PYJS / "assets/wasm64/empack_env_meta.json").read_bytes())
    conda = solve(specs + sorted(COMPILED), env)
    print(
        f"Conda solved: {len(conda)} additional artifacts, {len(env['packages'])} embedded packages pinned"
    )
    versions = {}
    pending = deque(
        ("application", d) for d in roots + requirements + [Requirement("tifffile")]
    )
    for p in conda:
        for msg in inspect_conda(p):
            n = canonicalize_name(msg["Name"])
            check(n not in versions, f"Duplicate conda Python distribution: {n}")
            versions[n] = distribution_version(
                p, n, msg["Version"], args.allow_kiwi_metadata
            )
            p.setdefault("distributions", []).append(
                {
                    "name": n,
                    "metadataVersion": msg["Version"],
                    "checkedVersion": versions[n],
                }
            )
            pending.extend((n, d) for d in active_requirements(msg))
    check(
        COMPILED <= versions.keys(),
        f"Missing compiled distributions: {COMPILED - versions.keys()}",
    )
    while pending:
        owner, req = pending.popleft()
        name = canonicalize_name(req.name)
        check(
            not req.extras and req.url is None,
            f"Unreviewed requirement from {owner}: {req}",
        )
        if name not in versions and name not in wheels:
            rec, deps = wheel(req)
            wheels[name] = rec
            pending.extend((name, d) for d in deps)
        version = versions.get(name) or wheels[name]["version"]
        if version not in req.specifier:
            raise SystemExit(
                f"BLOCKED: {owner} requires {req}; checked distribution version is {version}"
            )
    check(not versions.keys() & wheels.keys(), "Duplicate wheel/conda distribution")
    from build import finish_lock

    finish_lock(
        {
            "format": 1,
            "target": TARGET,
            "python": TARGET_PY,
            "pyjs": "5.2.0",
            "host": platform.platform(),
            "maintenancePython": platform.python_version(),
            "node": subprocess.check_output(["node", "-v"], text=True).strip(),
            "npm": subprocess.check_output(
                [shutil.which("npm.cmd") or "npm", "-v"], text=True
            ).strip(),
            "roots": [str(d) for d in roots],
            "embedded": env["packages"],
            "conda": conda,
            "wheels": sorted(wheels.values(), key=lambda w: w["name"]),
        }
    )


if __name__ == "__main__":
    main()
