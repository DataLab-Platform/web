"""Fixed inputs and independent oracle for the private qualification build."""

from __future__ import annotations

import itertools
import time
from functools import wraps

import numpy as np
import sigima

TIERS = {"smoke": 577, "2048": 2048, "8192": 8192, "18432": 18432}
LIMIT = 2**32


def _check(condition, message):
    if not condition:
        raise ValueError(message)


def boundary_indices(start, size, itemsize, threshold=LIMIT):
    """Element starts on either side of threshold, or first high element."""
    first = max(0, (threshold - start + itemsize - 1) // itemsize)
    if first >= size:
        return []
    return [first - 1, first] if first else [0]


def _bands(n):
    columns = np.arange(n, dtype=np.int32)
    step = max(1, 65536 // n)
    for begin in range(0, n, step):
        end = min(begin + step, n)
        yield slice(begin, end), np.arange(begin, end, dtype=np.int32)[:, None], columns


class Qualification:
    """One pair per fresh worker. Only prepare and verify are bound as RPCs."""

    def __init__(self, namespace):
        self.ns = namespace
        self.tier = None
        self.sources = []
        self.timings = {}

    def timed(self, name, fn):
        @wraps(fn)
        def measured(*args, **kwargs):
            begin = time.time_ns() // 1_000_000
            try:
                return fn(*args, **kwargs)
            finally:
                # Preserve epoch milliseconds across pyjs, like the address witnesses.
                self.timings[name] = [str(begin), str(time.time_ns() // 1_000_000)]

        return measured

    def prepare(self, tier, consent):
        _check(type(tier) is str and tier in TIERS, "Unknown fixed tier")
        _check(consent == f"DEDICATED:{tier}", "Missing tier-specific consent")
        _check(self.ns["_WASM64_VIEW"], "Requires actual WASM64")
        _check(sigima.__version__ == "1.4.1", "Requalify the allocation budget first")
        model = self.ns["_MODEL"]
        _check(self.tier is None and not model._objects, "Use a fresh empty workspace")
        provenance = self.ns["_PROVENANCE"]
        _check(
            provenance.available and not provenance.ledger.activities,
            "Provenance required",
        )
        self.tier = tier  # Never retry after a partial allocation.
        n = TIERS[tier]
        a, b = (np.empty((n, n), dtype=np.float32) for _ in range(2))
        for band, i, j in _bands(n):
            a[band] = 2 * i + j
            b[band] = i + 4 * j
        for name, data in zip(("A", "B"), (a, b)):
            image = sigima.create_image(title=f"WASM64 {name}", data=data)
            image.x0, image.y0, image.dx, image.dy = 3.0, -5.0, 0.25, 0.75
            self.sources.append(model.add_object("image", image))
        # Time the unchanged application paths, not a replacement for Sigima.
        proc = self.ns["_PROCESSOR"]
        proc.apply = self.timed("compute", proc.apply)
        for name in (
            "_begin_provenance",
            "_complete_provenance",
            "get_image_view_snapshot",
        ):
            self.ns[name] = self.timed(name, self.ns[name])
        return list(self.sources)

    def verify(self):
        _check(self.tier in TIERS, "No benchmark pair")
        n = TIERS[self.tier]
        model = self.ns["_MODEL"]
        output = set(model._objects) - set(self.sources)
        _check(
            len(output) == 1 and len(model._objects) == 3, "Expected three live objects"
        )
        ids = [*self.sources, output.pop()]
        last = self.ns["_LAST_PROCESSING"][ids[-1]]
        _check(
            last["feature_id"] == "image:addition"
            and set(last["source_ids"]) == set(self.sources),
            "Wrong operation/inputs",
        )
        provenance = self.ns["_PROVENANCE"]
        (activity,) = provenance.ledger.activities
        operation = activity["call"]["operation"]["id"]
        _check(
            operation == "sigima.image.addition" and not provenance.capture_failures,
            "Missing or failed addition provenance",
        )
        arrays = [model.get(oid).data for oid in ids]
        descriptors = []
        points = {
            (0, 0),
            (0, n - 1),
            (n - 1, 0),
            (n - 1, n - 1),
            (n // 3, n // 5),
            (n - 2, n // 7),
        }
        for a, dtype in zip(arrays, ("float32", "float32", "float64")):
            _check(
                a.shape == (n, n) and a.dtype == dtype and a.flags.c_contiguous,
                "Unexpected shape, dtype or contiguity",
            )
            start = int(a.__array_interface__["data"][0])
            descriptors.append(
                dict(
                    shape=a.shape,
                    strides=a.strides,
                    dtype=str(a.dtype),
                    nbytes=str(a.nbytes),
                    start=str(start),
                    end=str(start + a.nbytes),
                )
            )
            points.update(
                divmod(k, n) for k in boundary_indices(start, a.size, a.itemsize)
            )
        _check(
            all(
                not np.shares_memory(x, y) for x, y in itertools.combinations(arrays, 2)
            ),
            "Aliased image storage",
        )
        mismatches = [0, 0, 0]
        low, high = np.inf, -np.inf
        for band, i, j in _bands(n):
            for k, (a, ref) in enumerate(
                zip(arrays, (2 * i + j, i + 4 * j, 3 * i + 5 * j))
            ):
                mismatches[k] += int(np.count_nonzero(a[band] != ref))
            c = arrays[-1][band]
            low, high = min(low, c.min()), max(high, c.max())
        _check(
            not any(mismatches) and (low, high) == (0, 8 * (n - 1)),
            f"Numerical failure; mismatch counts {mismatches}, extrema {low}, {high}",
        )
        probes = []
        for i, j in sorted(points):
            addresses = [
                int(d["start"]) + (i * n + j) * a.itemsize
                for d, a in zip(descriptors, arrays)
            ]
            values = [int(a[i, j]) for a in arrays]
            _check(
                values == [2 * i + j, i + 4 * j, 3 * i + 5 * j], "Bad address witness"
            )
            probes.append(
                dict(
                    index=[str(i), str(j)],
                    values=list(map(str, values)),
                    addresses=list(map(str, addresses)),
                )
            )
        total = sum(a.nbytes for a in arrays)
        if self.tier == "18432":
            _check(
                total > LIMIT
                and any(int(v) >= LIMIT for p in probes for v in p["addresses"]),
                "No numerical witness beyond 4 GiB",
            )
        return dict(
            tier=self.tier,
            ids=ids,
            arrays=descriptors,
            probes=probes,
            nbytes=str(total),
            extrema=[int(low), int(high)],
            mismatches=mismatches,
            catalog=last["feature_id"],
            operation=operation,
            timings=self.timings,
            capture_failures=provenance.capture_failures,
        )
