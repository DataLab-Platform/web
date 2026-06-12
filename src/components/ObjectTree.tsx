import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { GroupNode, ObjectNode, PanelTree } from "../runtime/runtime";
import { getEditIconUrl } from "../assets/editIcons";
import { useConfirm } from "./ConfirmDialog";
import { useListSelection } from "./useListSelection";
import { t } from "../i18n/translate";
import { TitleWithLinks } from "./TitleWithLinks";

const DELETE_ICON_URL = getEditIconUrl("delete.svg");

interface Props {
  tree: PanelTree | null;
  selectedIds: string[];
  /** Explicitly selected group ids (group-exclusive selection). Used to
   *  highlight group headers; mirrors DataLab desktop. */
  selectedGroupIds?: string[];
  currentId: string | null;
  onSelectionChange: (
    ids: string[],
    current: string | null,
    groupIds?: string[],
  ) => void;
  onRenameObject: (oid: string, name: string) => void;
  onRenameGroup: (gid: string, name: string) => void;
  onDeleteGroup: (gid: string) => void;
  onDeleteObjects: (ids: string[]) => void;
  /**
   * Move *oids* to *targetGroupId* at *targetIndex* (computed against the
   * destination group **after** removal of moved objects, ``-1`` to append).
   */
  onMoveObjects: (
    oids: string[],
    targetGroupId: string,
    targetIndex: number,
  ) => void;
  /** Open a context menu for object *oid* at viewport coordinates. */
  onObjectContextMenu?: (oid: string, x: number, y: number) => void;
}

/** Imperative API exposed by ``ObjectTree`` to parent components. */
export interface ObjectTreeHandle {
  /** Trigger inline rename on the object with id *oid*. */
  startRenameObject: (oid: string) => void;
}

type EditTarget =
  | { kind: "object"; id: string }
  | { kind: "group"; id: string }
  | null;

/** Visual drop indicator while dragging objects in the tree. */
type DropZone =
  | { kind: "group"; gid: string }
  | { kind: "before"; gid: string; oid: string }
  | { kind: "after"; gid: string; oid: string };

const DRAG_MIME = "application/x-datalab-oids";

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
export const ObjectTree = forwardRef<ObjectTreeHandle, Props>(
  function ObjectTree(props, ref) {
    const {
      tree,
      selectedIds,
      selectedGroupIds,
      currentId,
      onSelectionChange,
      onRenameObject,
      onRenameGroup,
      onDeleteGroup,
      onDeleteObjects,
      onMoveObjects,
      onObjectContextMenu,
    } = props;

    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [editing, setEditing] = useState<EditTarget>(null);
    const [editValue, setEditValue] = useState("");
    const [draggedOids, setDraggedOids] = useState<string[] | null>(null);
    const [dropZone, setDropZone] = useState<DropZone | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        startRenameObject: (oid: string) => {
          // Locate the object in the tree to fetch its current title.
          if (!tree) return;
          for (const g of tree.groups) {
            const obj = g.objects.find((o) => o.id === oid);
            if (obj) {
              setEditing({ kind: "object", id: oid });
              setEditValue(obj.title);
              return;
            }
          }
        },
      }),
      [tree],
    );
    const confirm = useConfirm();

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

    const handleObjectClick = useListSelection(
      flatIds,
      selectedIds,
      currentId,
      onSelectionChange,
    );

    const handleGroupClick = useCallback(
      (group: GroupNode, evt: React.MouseEvent) => {
        // Plain click: select this group alone (objects XOR groups, like
        // desktop). Ctrl/Cmd-click: toggle this group in the selection,
        // so a processing can aggregate several groups (e.g. average).
        const multi = evt.ctrlKey || evt.metaKey;
        if (!multi || !tree) {
          const ids = group.objects.map((o) => o.id);
          onSelectionChange(ids, ids[0] ?? null, [group.gid]);
          return;
        }
        const current = new Set(selectedGroupIds ?? []);
        if (current.has(group.gid)) current.delete(group.gid);
        else current.add(group.gid);
        const nextGids = tree.groups
          .map((g) => g.gid)
          .filter((gid) => current.has(gid));
        const ids: string[] = [];
        for (const g of tree.groups) {
          if (current.has(g.gid)) for (const o of g.objects) ids.push(o.id);
        }
        onSelectionChange(ids, ids[ids.length - 1] ?? null, nextGids);
      },
      [onSelectionChange, selectedGroupIds, tree],
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

    /** Begin a drag from object *oid*, dragging the whole selection if
     * *oid* is part of it (mimics file-explorer behaviour). */
    const handleDragStart = useCallback(
      (oid: string, evt: React.DragEvent) => {
        const oids = selectedSet.has(oid) ? selectedIds : [oid];
        evt.dataTransfer.setData(DRAG_MIME, JSON.stringify(oids));
        evt.dataTransfer.effectAllowed = "move";
        setDraggedOids(oids);
      },
      [selectedIds, selectedSet],
    );

    const handleDragEnd = useCallback(() => {
      setDraggedOids(null);
      setDropZone(null);
    }, []);

    /** Compute the drop zone over an item from the cursor Y position. */
    const computeItemDropZone = useCallback(
      (gid: string, oid: string, evt: React.DragEvent): DropZone => {
        const rect = evt.currentTarget.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        return before
          ? { kind: "before", gid, oid }
          : { kind: "after", gid, oid };
      },
      [],
    );

    /** Resolve the drop into ``(targetGroupId, targetIndex)`` and apply it. */
    const applyDrop = useCallback(
      (zone: DropZone, oids: string[]) => {
        if (!tree) return;
        const moved = new Set(oids);
        const targetGroup = tree.groups.find((g) => g.gid === zone.gid);
        if (!targetGroup) return;
        // Remaining ids in destination after removing the moved set.
        const remaining = targetGroup.objects
          .map((o) => o.id)
          .filter((x) => !moved.has(x));
        let index = -1;
        if (zone.kind === "before" || zone.kind === "after") {
          // Drop relative to a sibling that may be itself one of the moved
          // items: in that case treat the drop as a no-op (append).
          if (moved.has(zone.oid)) {
            index = -1;
          } else {
            const pos = remaining.indexOf(zone.oid);
            index = pos < 0 ? -1 : pos + (zone.kind === "after" ? 1 : 0);
          }
        }
        onMoveObjects(oids, zone.gid, index);
      },
      [tree, onMoveObjects],
    );

    const handleDrop = useCallback(
      (zone: DropZone, evt: React.DragEvent) => {
        evt.preventDefault();
        evt.stopPropagation();
        let oids = draggedOids;
        if (!oids) {
          // Fallback: payload from dataTransfer (cross-render scenarios).
          const raw = evt.dataTransfer.getData(DRAG_MIME);
          if (raw) {
            try {
              oids = JSON.parse(raw);
            } catch {
              oids = null;
            }
          }
        }
        setDraggedOids(null);
        setDropZone(null);
        if (oids && oids.length > 0) applyDrop(zone, oids);
      },
      [draggedOids, applyDrop],
    );

    /** True when the active drag is over *zone*. */
    const isZone = (zone: DropZone): boolean => {
      if (!dropZone) return false;
      if (dropZone.kind !== zone.kind) return false;
      if (dropZone.gid !== zone.gid) return false;
      if (zone.kind === "group") return true;
      return (
        (dropZone as Extract<DropZone, { kind: "before" | "after" }>).oid ===
        (zone as Extract<DropZone, { kind: "before" | "after" }>).oid
      );
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
      const emptyLabel =
        tree?.kind === "image" ? t("No images yet.") : t("No signals yet.");
      return <div className="object-tree-empty">{emptyLabel}</div>;
    }

    return (
      <div className="object-tree">
        {tree.groups.map((group) => {
          const isCollapsed = collapsed.has(group.gid);
          const groupZone: DropZone = { kind: "group", gid: group.gid };
          const isGroupSelected = (selectedGroupIds ?? []).includes(group.gid);
          const headerCls = [
            "object-tree-group-header",
            isGroupSelected ? "selected" : "",
            draggedOids && isZone(groupZone) ? "drop-target" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={group.gid} className="object-tree-group">
              <div
                className={headerCls}
                onClick={(e) => handleGroupClick(group, e)}
                onDoubleClick={() =>
                  startEdit({ kind: "group", id: group.gid }, group.name)
                }
                onDragOver={(e) => {
                  if (!draggedOids) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropZone(groupZone);
                }}
                onDragLeave={(e) => {
                  // Only clear when actually leaving the header (not when
                  // moving to a child element).
                  const next = e.relatedTarget as Node | null;
                  if (next && e.currentTarget.contains(next)) return;
                  setDropZone((z) =>
                    z && z.kind === "group" && z.gid === group.gid ? null : z,
                  );
                }}
                onDrop={(e) => handleDrop(groupZone, e)}
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
                  <span className="object-tree-group-name">
                    <TitleWithLinks title={group.name} />
                  </span>
                )}
                <span className="object-tree-count">
                  {group.objects.length}
                </span>
                <button
                  type="button"
                  className="object-tree-group-delete"
                  title="Delete group"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const n = group.objects.length;
                    const message =
                      n > 0
                        ? `Delete group "${group.name}" and its ${n} object(s)?`
                        : `Delete group "${group.name}"?`;
                    const ok = await confirm({
                      title: "Delete group",
                      message,
                      confirmLabel: "Delete",
                      destructive: true,
                    });
                    if (!ok) return;
                    onDeleteGroup(group.gid);
                  }}
                >
                  {DELETE_ICON_URL ? (
                    <img src={DELETE_ICON_URL} alt="" aria-hidden="true" />
                  ) : (
                    "×"
                  )}
                </button>
              </div>
              {!isCollapsed && (
                <ul className="object-tree-list">
                  {group.objects.length === 0 && (
                    <li
                      className={
                        "object-tree-empty-group" +
                        (draggedOids && isZone(groupZone) ? " drop-target" : "")
                      }
                      onDragOver={(e) => {
                        if (!draggedOids) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropZone(groupZone);
                      }}
                      onDrop={(e) => handleDrop(groupZone, e)}
                    >
                      {t("(empty — drop here)")}
                    </li>
                  )}
                  {group.objects.map((o: ObjectNode) => {
                    const isSelected = selectedSet.has(o.id);
                    const isCurrent = currentId === o.id;
                    const isDragged = !!draggedOids?.includes(o.id);
                    const beforeZone: DropZone = {
                      kind: "before",
                      gid: group.gid,
                      oid: o.id,
                    };
                    const afterZone: DropZone = {
                      kind: "after",
                      gid: group.gid,
                      oid: o.id,
                    };
                    const dropBefore = !!draggedOids && isZone(beforeZone);
                    const dropAfter = !!draggedOids && isZone(afterZone);
                    const cls = [
                      "object-tree-item",
                      isSelected ? "selected" : "",
                      isCurrent ? "current" : "",
                      isDragged ? "dragging" : "",
                      dropBefore ? "drop-before" : "",
                      dropAfter ? "drop-after" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <li
                        key={o.id}
                        className={cls}
                        draggable
                        onDragStart={(e) => handleDragStart(o.id, e)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => {
                          if (!draggedOids) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDropZone(computeItemDropZone(group.gid, o.id, e));
                        }}
                        onDragLeave={(e) => {
                          const next = e.relatedTarget as Node | null;
                          if (next && e.currentTarget.contains(next)) return;
                          setDropZone((z) =>
                            z &&
                            (z.kind === "before" || z.kind === "after") &&
                            z.oid === o.id
                              ? null
                              : z,
                          );
                        }}
                        onDrop={(e) => {
                          const zone = computeItemDropZone(group.gid, o.id, e);
                          handleDrop(zone, e);
                        }}
                        onClick={(e) => handleObjectClick(o.id, e)}
                        onDoubleClick={() =>
                          startEdit({ kind: "object", id: o.id }, o.title)
                        }
                        onContextMenu={(e) => {
                          if (!onObjectContextMenu) return;
                          e.preventDefault();
                          // Right-click on a non-selected object replaces
                          // the selection with that single object.
                          if (!selectedSet.has(o.id)) {
                            onSelectionChange([o.id], o.id);
                          } else if (currentId !== o.id) {
                            onSelectionChange(selectedIds, o.id);
                          }
                          onObjectContextMenu(o.id, e.clientX, e.clientY);
                        }}
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
                            <TitleWithLinks
                              title={o.title}
                              className="object-tree-title"
                            />
                            <div className="object-tree-meta">
                              #{o.id} · {o.size} pts
                            </div>
                            <button
                              type="button"
                              className="object-tree-item-delete"
                              title="Delete"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const ids = selectedSet.has(o.id)
                                  ? selectedIds
                                  : [o.id];
                                const message =
                                  ids.length > 1
                                    ? `Delete ${ids.length} selected object(s)?`
                                    : `Delete "${o.title}"?`;
                                const ok = await confirm({
                                  title: "Delete",
                                  message,
                                  confirmLabel: "Delete",
                                  destructive: true,
                                });
                                if (!ok) return;
                                onDeleteObjects(ids);
                              }}
                            >
                              {DELETE_ICON_URL ? (
                                <img
                                  src={DELETE_ICON_URL}
                                  alt=""
                                  aria-hidden="true"
                                />
                              ) : (
                                "×"
                              )}
                            </button>
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
  },
);
