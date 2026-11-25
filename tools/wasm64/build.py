"""Build the local J1 environment from the reviewed lock, without a solver."""

from __future__ import annotations

import argparse
import email
import json
import re
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo

from artifacts import (
    CACHE,
    HERE,
    MIRROR,
    PYJS,
    ROOT,
    TARGET,
    artifact,
    check,
    fingerprint,
    verify,
    write_json,
)

LOCK = HERE / "environment.lock.json"
PUBLIC = ROOT / "build/wasm64/public"
ARCHIVE = "python-wheels.zip"
SITE = "/lib/python3.14/site-packages"


def tree(path):
    return {
        p.relative_to(path).as_posix(): fingerprint(p)
        for p in sorted(path.rglob("*"))
        if p.is_file()
    }


def runtime_files():
    result = {f"wasm64/{n}": v for n, v in tree(PYJS / "assets/wasm64").items()}
    result.update({f"dist/{n}": v for n, v in tree(PYJS / "dist").items()})
    result["LICENSE"] = fingerprint(PYJS / "LICENSE")
    return result


def npm_package():
    package = json.loads((PYJS / "package.json").read_bytes())
    name = package["name"]
    lock = json.loads((HERE / "package-lock.json").read_bytes())["packages"]
    check(
        name == "@derthorsten/pyjs"
        and package["version"] == lock[""]["dependencies"][name] == "5.2.0",
        "Expected isolated pyjs 5.2.0 (install with npm ci)",
    )
    return lock["node_modules/" + name]


def wheel_archive(records, dest, mirror, offline):
    seen = set()
    total = 0
    with ZipFile(dest, "w") as out:
        for rec in sorted(records, key=lambda r: r["name"]):
            path = artifact(rec, mirror, offline)
            check(path.name.endswith("-none-any.whl"), f"Not a pure wheel: {path}")
            with ZipFile(path) as z:
                [wheel] = [n for n in z.namelist() if n.endswith(".dist-info/WHEEL")]
                msg = email.message_from_bytes(z.read(wheel))
                check(
                    msg["Root-Is-Purelib"] == "true"
                    and "py3-none-any" in msg.get_all("Tag", ()),
                    path,
                )
                for member in sorted(z.infolist(), key=lambda m: m.filename):
                    n = member.filename
                    if member.is_dir():
                        continue
                    check(
                        not ({"", ".", ".."} & set(n.split("/")))
                        and "\\" not in n
                        and ":" not in n,
                        n,
                    )
                    check(
                        not n.split("/", 1)[0].endswith(".data"),
                        f"Wheel layout requires an installer: {n}",
                    )
                    check(
                        not n.lower().endswith(
                            (".so", ".pyd", ".dll", ".dylib", ".wasm")
                        ),
                        f"Not pure Python: {n}",
                    )
                    check(n not in seen, f"Wheel install conflict: {n}")
                    seen.add(n)
                    total += member.file_size
                    check(total < 128 << 20, "Wheel archive exceeds build budget")
                    # Stored ZIP + fixed timestamp, permissions and ordering: independent of OS and zlib.
                    entry = ZipInfo(n)
                    entry.create_system = 3
                    entry.external_attr = 0o100644 << 16
                    with z.open(member) as src, out.open(entry, "w") as dst:
                        shutil.copyfileobj(src, dst)
    for app in ("guidata", "sigima"):
        check(
            f"{app}/locale/fr/LC_MESSAGES/{app}.mo" in seen,
            f"Missing translation: {app}",
        )


def finish_lock(lock):
    """Maintenance only; publish a lock only after verifying the assembled artifact."""
    lock["npmPackage"] = npm_package()
    lock["copyAssetsCli"] = fingerprint(PYJS / "bin/pyjs.mjs")
    lock["runtime"] = runtime_files()
    with TemporaryDirectory(dir=CACHE) as tmp:
        path = Path(tmp) / ARCHIVE
        wheel_archive(lock["wheels"], path, MIRROR, offline=True)
        lock["wheelArchive"] = fingerprint(path)
        manifest = Path(tmp) / "environment.json"
        write_json(manifest, served_manifest(lock))
        lock["servedManifest"] = fingerprint(manifest)
        candidate = Path(tmp) / LOCK.name
        write_json(candidate, lock)
        candidate.replace(LOCK)
    print(
        f"Locked {len(lock['conda'])} conda artifacts + {len(lock['wheels'])} pure wheels: {LOCK}"
    )


def served_manifest(lock):
    urls = []
    for rec in lock["conda"]:
        filename = rec["url"].rsplit("/", 1)[-1]
        urls.append(
            {"url": f"./conda/{rec['sha256']}/{filename}", "sha256": rec["sha256"]}
        )
    digest = lock["wheelArchive"]["sha256"]
    check(re.fullmatch("[0-9a-f]{64}", digest), "Bad wheel archive digest")
    return {
        "urls": urls,
        "archives": [
            {"url": f"./archives/{digest}/{ARCHIVE}", "path": SITE, "sha256": digest}
        ],
    }


def stage(lock, dest, mirror, offline, allow_kiwi):
    from kiwi_workaround import distribution_version

    check(
        lock["format"] == 1 and lock["target"] == TARGET and lock["python"] == "3.14.3",
        "Wrong lock target",
    )
    check(
        lock["pyjs"] == "5.2.0" and npm_package() == lock["npmPackage"],
        "npm lock mismatch",
    )
    check(
        runtime_files() == lock["runtime"],
        "Installed pyjs bytes do not match lock; run npm ci",
    )
    verify(PYJS / "bin/pyjs.mjs", lock["copyAssetsCli"])
    env = json.loads((PYJS / "assets/wasm64/empack_env_meta.json").read_bytes())
    check(env["packages"] == lock["embedded"], "Embedded interpreter changed")
    roots = []
    for n in ("sigima", "guidata", "datalab-capsule"):
        spec = json.loads((ROOT / f"{n}-dependency.json").read_bytes())
        check(spec["developmentRef"] is None, "Unqualified development dependency")
        roots.append(spec["publishedRequirement"])
    check(
        roots == lock["roots"], "Application requirements changed; regenerate the lock"
    )
    packages = {p["name"] for p in lock["embedded"]}
    distributions = set()
    for p in lock["conda"]:
        check(
            p["subdir"] in (TARGET, "noarch") and p["name"] not in packages, p["name"]
        )
        packages.add(p["name"])
        for d in p.get("distributions", []):
            name = d["name"]
            check(name not in distributions, f"Duplicate distribution: {name}")
            distributions.add(name)
            checked = distribution_version(p, name, d["metadataVersion"], allow_kiwi)
            check(
                checked == d["checkedVersion"],
                f"{name}: lock requires --allow-kiwi-metadata",
            )
    wheel_names = [w["name"] for w in lock["wheels"]]
    check(
        len(set(wheel_names)) == len(wheel_names)
        and not distributions.intersection(wheel_names),
        "Duplicate wheel/conda distribution",
    )
    pyjs = dest / "pyjs"
    subprocess.run(
        [
            "node",
            str(PYJS / "bin/pyjs.mjs"),
            "copy-assets",
            str(pyjs),
            "--arch",
            "wasm64",
        ],
        check=True,
    )
    shutil.copytree(PYJS / "dist", pyjs / "dist")
    shutil.copyfile(PYJS / "LICENSE", pyjs / "LICENSE")
    check(tree(pyjs) == lock["runtime"], "Copied runtime integrity mismatch")
    manifest = served_manifest(lock)
    write_json(dest / "environment.json", manifest)
    verify(dest / "environment.json", lock["servedManifest"])
    for rec, entry in zip(lock["conda"], manifest["urls"], strict=True):
        src = artifact(rec, mirror, offline)
        stem = f"{rec['name']}-{rec['version']}-{rec['build']}"
        check(
            src.name in (stem + ".conda", stem + ".tar.bz2")
            and rec["url"].split("/")[-2] == rec["subdir"],
            src,
        )
        dst = dest / entry["url"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        verify(dst, rec)
    path = dest / manifest["archives"][0]["url"]
    path.parent.mkdir(parents=True)
    wheel_archive(lock["wheels"], path, mirror, offline)
    verify(path, lock["wheelArchive"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Reject missing mirror artifacts; never download",
    )
    parser.add_argument(
        "--mirror",
        type=Path,
        default=MIRROR,
        help="Flat directory of upstream artifact filenames",
    )
    parser.add_argument("--allow-kiwi-metadata", action="store_true")
    args = parser.parse_args()
    lock = json.loads(LOCK.read_bytes())
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=PUBLIC.parent) as tmp:
        scratch = Path(tmp)
        stage(lock, scratch, args.mirror, args.offline, args.allow_kiwi_metadata)
        PUBLIC.mkdir(exist_ok=True)
        # The manifest is the completion marker. Preserve any unrelated static probe files.
        (PUBLIC / "environment.json").unlink(missing_ok=True)
        for name in ("pyjs", "conda", "archives"):
            target = PUBLIC / name
            if target.exists():
                target.rename(scratch / ("previous-" + name))
            (scratch / name).rename(target)
        (scratch / "environment.json").replace(PUBLIC / "environment.json")
    print(f"Ready: {PUBLIC / 'environment.json'}")


if __name__ == "__main__":
    main()
