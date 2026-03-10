import { useCallback, useMemo, useState } from "react";
import type { GroupNode, ObjectNode, PanelTree } from "../sigima/runtime";

interface Props {
  tree: PanelTree | null;
  selectedIds: string[];
  currentId: string | null;
  onSelectionChange: (ids: string[], current: string | null) => void;
  onRenameObject: (oid: string, name: string) => void;
  onRenameGroup: (gid: string, name: string) => void;
  onDeleteGroup: (gid: string) => void;
  onMoveObject: (oid: string, targetGroupId: string) => void;
}

type EditTarget =
  | { kind: "object"; id: string }
  | { kind: "group"; id: string }
  | null;

/**
 * Hierarchical object tree with multi-selection.
 *
 * Selection rules (mimic VS Code / desktop file lists):
 * - plain click: replace selection with the clicked object, set current
 * - Ctrl/Cmd-click: toggle the clicked object in the selection
 * - Shift-click: extend selection from current to clicked object (within
 *   the flat list of all visible objects)
 * - clicking a group header: replace selection with all objects of the group
 */
export function ObjectTree(props: Props) {
  const {
    tree,
    selectedIds,
    currentId,
    onSelectionChange,
    onRenameObject,
    onRenameGroup,
    onDeleteGroup,
    onMoveObject,
  } = props;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditTarget>(null);
  const [editValue, setEditValue] = useState("");

  // Flat ordered list of all visible objects (for Shift-click range select).
  const flatIds = useMemo(() => {
    if (!tree) return [] as string[];
    const ids: string[] = [];
    for (const g of tree.groups) {
      if (collapsed.has(g.gid)) continue;
      for (const o of g.objects) ids.push(o.id);
    }
    return ids;
  }, [tree, collapsed]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const handleObjectClick = useCallback(
    (oid: string, evt: React.MouseEvent) => {
      if (evt.shiftKey && currentId) {
        const a = flatIds.indexOf(currentId);
        const b = flatIds.indexOf(oid);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = flatIds.slice(lo, hi + 1);
          onSelectionChange(range, oid);
          return;
        }
      }
      if (evt.ctrlKey || evt.metaKey) {
        const next = new Set(selectedSet);
        if (next.has(oid)) next.delete(oid);
        else next.add(oid);
        onSelectionChange(Array.from(next), next.has(oid) ? oid : currentId);
        return;
      }
      onSelectionChange([oid], oid);
    },
    [selectedSet, currentId, flatIds, onSelectionChange],
  );

  const handleGroupClick = useCallback(
    (group: GroupNode) => {
      const ids = group.objects.map((o) => o.id);
      onSelectionChange(ids, ids[0] ?? null);
    },
    [onSelectionChange],
  );

  const toggleCollapsed = useCallback((gid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }, []);

  const startEdit = (target: EditTarget, current: string) => {
    setEditing(target);
    setEditValue(current);
  };

  const commitEdit = () => {
    if (!editing) return;
    const value = editValue.trim();
    if (value) {
      if (editing.kind === "object") onRenameObject(editing.id, value);
      else onRenameGroup(editing.id, value);
    }
    setEditing(null);
  };

  if (!tree || tree.groups.length === 0) {
    return (
      <div className="object-tree-empty">No signals yet.</div>
    );
  }

  return (
    <div className="object-tree">
      {tree.groups.map((group) => {
        const isCollapsed = collapsed.has(group.gid);
        return (
          <div key={group.gid} className="object-tree-group">
            <div
              className="object-tree-group-header"
              onClick={() => handleGroupClick(group)}
              onDoubleClick={() =>
                startEdit({ kind: "group", id: group.gid }, group.name)
              }
            >
              <button
                type="button"
                className="object-tree-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(group.gid);
                }}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
              {editing?.kind === "group" && editing.id === group.gid ? (
                <input
                  autoFocus
                  className="object-tree-edit"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="object-tree-group-name">{group.name}</span>
              )}
              <span className="object-tree-count">
                {group.objects.length}
              </span>
              <button
                type="button"
                className="object-tree-group-delete"
                title="Delete group"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteGroup(group.gid);
                }}
              >
                ×
              </button>
            </div>
            {!isCollapsed && (
              <ul className="object-tree-list">
                {group.objects.length === 0 && (
                  <li
                    className="object-tree-empty-group"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const oid = e.dataTransfer.getData("text/oid");
                      if (oid) onMoveObject(oid, group.gid);
                    }}
                  >
                    (empty — drop here)
                  </li>
                )}
                {group.objects.map((o: ObjectNode) => {
                  const isSelected = selectedSet.has(o.id);
                  const isCurrent = currentId === o.id;
                  const cls = [
                    "object-tree-item",
                    isSelected ? "selected" : "",
                    isCurrent ? "current" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <li
                      key={o.id}
                      className={cls}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/oid", o.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={(e) => handleObjectClick(o.id, e)}
                      onDoubleClick={() =>
                        startEdit({ kind: "object", id: o.id }, o.title)
                      }
                    >
                      {editing?.kind === "object" && editing.id === o.id ? (
                        <input
                          autoFocus
                          className="object-tree-edit"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <div className="object-tree-title">{o.title}</div>
                          <div className="object-tree-meta">
                            #{o.id} · {o.size} pts
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
