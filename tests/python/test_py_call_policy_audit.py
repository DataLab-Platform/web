# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Audit of the disk-guard policy against the Python functions it covers.

In on-disk storage mode, ``runtime.ts`` reconciles the OPFS store with the
model after the calls listed in ``DISK_SWEEP_CALLS`` (``pyCallPolicy.ts``):
on-disk copies of deleted objects are removed and objects left in memory are
spilled. A call that adds, deletes or replaces objects without being listed
leaks memory or disk space, or pages a stale copy in later.

This test finds, from the source code, every Python function called by
``runtime.ts`` that adds, deletes or replaces objects of the model (directly
or through the functions it calls) and checks that it is listed.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

RUNTIME_DIR = Path(__file__).resolve().parents[2] / "src" / "runtime"

#: Object-model methods that add, delete or replace objects.
MODEL_MUTATORS = {"add_object", "delete_object", "delete_group", "duplicate_object"}
#: Hooks installed by ``runtime.ts`` that reset or load the workspace.
WORKSPACE_HOOKS = {"_RESET_WORKSPACE", "_WORKSPACE_LOADER"}
#: Object-model containers whose ``clear()`` drops every object.
MODEL_CONTAINERS = {"_objects", "_panels"}

FunctionKey = tuple[str, str]


def _closing_index(text: str, start: int) -> int:
    """Return the index of the parenthesis closing the one at *start*."""
    depth, quote, index = 0, None, start
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 1
            elif char == quote:
                quote = None
        elif char in "\"'`":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise ValueError("Unbalanced parentheses in runtime.ts")


def called_python_functions() -> set[str]:
    """Return the names of the Python functions called through ``callPy``."""
    text = (RUNTIME_DIR / "runtime.ts").read_text(encoding="utf-8")
    names: set[str] = set()
    for match in re.finditer(r"this\.callPy(Latest)?\s*(?:<[\s\S]*?>)?\s*\(", text):
        args = text[match.end() : _closing_index(text, match.end() - 1)]
        literals = re.findall(r'"([^"]*)"', args)
        # ``callPyLatest`` takes a coalescing key before the function name.
        names.add(literals[1] if match.group(1) else literals[0])
    return names


def policy_set(name: str) -> set[str]:
    """Return the names listed by the ``pyCallPolicy.ts`` set *name*."""
    text = (RUNTIME_DIR / "pyCallPolicy.ts").read_text(encoding="utf-8")
    union = re.search(rf"export const {name}\b[^=]*=\s*unionOf\(([^)]*)\)", text)
    if union:
        return set().union(
            *(
                policy_set(item.strip())
                for item in union.group(1).split(",")
                if item.strip()
            )
        )
    block = re.search(
        rf"export const {name}\b[^=]*=\s*new Set<string>\(\[([\s\S]*?)\]\)", text
    )
    assert block is not None, f"{name} not found in pyCallPolicy.ts"
    return set(re.findall(r'"([A-Za-z_0-9]+)"', block.group(1)))


class _ModuleIndex:
    """Functions of the runtime modules and the functions they call."""

    def __init__(self) -> None:
        self.calls: dict[FunctionKey, set[FunctionKey]] = {}
        self.direct: set[FunctionKey] = set()
        trees = {
            path.stem: ast.parse(path.read_text(encoding="utf-8"))
            for path in RUNTIME_DIR.glob("*.py")
        }
        for module, tree in trees.items():
            self._index_module(module, tree, set(trees))

    def _index_module(self, module: str, tree: ast.Module, modules: set[str]) -> None:
        aliases: dict[str, str] = {}
        imported: dict[str, FunctionKey] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in modules:
                        aliases[alias.asname or alias.name] = alias.name
            elif isinstance(node, ast.ImportFrom) and node.module in modules:
                for alias in node.names:
                    imported[alias.asname or alias.name] = (node.module, alias.name)
        defined = {
            node.name
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }

        def resolve(func: ast.expr) -> FunctionKey | None:
            if isinstance(func, ast.Name):
                if func.id in defined:
                    return (module, func.id)
                return imported.get(func.id)
            if (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id in aliases
            ):
                return (aliases[func.value.id], func.attr)
            return None

        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.module in modules:
                # Module-level import, e.g. ``from dlw_macro_lint import lint_macro``.
                for alias in node.names:
                    self.calls[(module, alias.asname or alias.name)] = {
                        (node.module, alias.name)
                    }
            if isinstance(node, ast.Assign) and isinstance(
                node.value, (ast.Name, ast.Attribute)
            ):
                # Module-level alias, e.g. ``clear_image_results = clear_...``
                # or ``commit_interactive_fit = _ifit.commit_interactive_fit``.
                target = resolve(node.value)
                for name in node.targets:
                    if isinstance(name, ast.Name) and target is not None:
                        self.calls[(module, name.id)] = {target}
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            key = (module, node.name)
            calls = self.calls.setdefault(key, set())
            for sub in ast.walk(node):
                if isinstance(sub, ast.Call):
                    if _mutates(sub.func):
                        self.direct.add(key)
                    target = resolve(sub.func)
                    if target is not None:
                        calls.add(target)
                elif isinstance(sub, (ast.Assign, ast.AugAssign)):
                    targets = (
                        sub.targets if isinstance(sub, ast.Assign) else [sub.target]
                    )
                    if any(
                        isinstance(t, ast.Attribute) and t.attr == "obj"
                        for t in targets
                    ):
                        self.direct.add(key)

    def mutating(self) -> set[FunctionKey]:
        """Return every function that adds, deletes or replaces objects."""
        found = set(self.direct)
        changed = True
        while changed:
            changed = False
            for key, calls in self.calls.items():
                if key not in found and calls & found:
                    found.add(key)
                    changed = True
        return found

    def locate(self, name: str) -> FunctionKey | None:
        """Return the function a ``callPy`` name designates in Pyodide."""
        # ``bootstrap`` globals come first; ``runtime.ts`` then imports the
        # public functions of ``dlw_applications`` into them.
        for module in ("bootstrap", "dlw_applications"):
            if (module, name) in self.calls:
                return (module, name)
        return None


def _mutates(func: ast.expr) -> bool:
    """Return whether the call of *func* adds, deletes or replaces objects."""
    if isinstance(func, ast.Name):
        return func.id in WORKSPACE_HOOKS
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr in MODEL_MUTATORS:
        return True
    return (
        func.attr == "clear"
        and isinstance(func.value, ast.Attribute)
        and func.value.attr in MODEL_CONTAINERS
    )


def test_every_called_function_exists():
    index = _ModuleIndex()
    unknown = sorted(n for n in called_python_functions() if index.locate(n) is None)
    assert not unknown, f"runtime.ts calls unknown Python functions: {unknown}"


def test_audit_detects_known_model_mutations():
    """Guard against a silent breakage of the analysis itself."""
    mutating = _ModuleIndex().mutating()
    for key in [
        ("bootstrap", "delete_group"),
        ("bootstrap", "reset_all"),
        ("bootstrap", "set_object_pickled"),
        ("bootstrap", "apply_feature"),
        ("bootstrap", "h5_browser_import"),
        ("dlw_applications", "run_plugin_recipe"),
        ("dlw_applications", "open_plugin_example"),
        ("bootstrap", "commit_interactive_fit"),
    ]:
        assert key in mutating, key
    for key in [
        ("bootstrap", "get_signal_view_snapshot"),
        ("bootstrap", "h5_browser_preview"),
    ]:
        assert key not in mutating, key


def test_model_mutations_are_followed_by_a_disk_sweep():
    index = _ModuleIndex()
    mutating = index.mutating()
    sweep = policy_set("DISK_SWEEP_CALLS")
    missing = sorted(
        name
        for name in called_python_functions()
        if index.locate(name) in mutating and name not in sweep
    )
    assert not missing, (
        "These Python functions add, delete or replace objects but are not "
        f"listed in DISK_SWEEP_CALLS (src/runtime/pyCallPolicy.ts): {missing}"
    )
