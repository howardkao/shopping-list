import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown, ChevronRight, GripVertical, MoreVertical, Plus, Trash2,
} from 'lucide-react';
import { formatAisleNameForDisplay } from './aisleDisplay';

const MAX_CATEGORY_PREVIEW_ITEMS = 4;

/** Visible (shortcut) names first, then library-only names; deduped case-insensitively. Up to four examples plus ", ..." (always) so the line reads as a sample, not an exhaustive list. */
function categoryItemsCommaList(visibleItems, libraryItems) {
  const vis = visibleItems || [];
  const lib = libraryItems || [];
  const seen = new Set();
  const names = [];
  for (const i of vis) {
    const k = i.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(i.name);
  }
  for (const i of lib) {
    const k = i.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(i.name);
  }
  if (names.length === 0) return '';
  const shown = names.slice(0, MAX_CATEGORY_PREVIEW_ITEMS);
  return `${shown.join(', ')}, ...`;
}

// SuggestionsEditor
//
// Same component used by onboarding (wizard chrome) and Settings → Suggestions.
// Aisles reorder via drag handles (@dnd-kit); expand/caret and overflow menu always available.
//
// Props are pure data. The parent wires callbacks to Firebase writes.
//
//   aisles        : { [aisleId]: { name, order } }
//   categories    : { [catId]:   { name, aisleId } }
//   visibleItems  : { [catId]: Array<{id, name}> }
//   libraryItems  : { [catId]: Array<{id, name}> }
//
//   onRenameAisle(aisleId, name)
//   onAddAisle(name) -> aisleId
//   onDeleteAisle(aisleId)
//   onReorderAisles(orderedAisleIds)
//
//   onRenameCategory(catId, name)
//   onAddCategory(aisleId, name) -> catId
//   onMoveCategory(catId, aisleId)
//   onMergeCategory(fromCatId, intoCatId)  -- same aisle only; moves suggestions + library, removes source category
//
//   onboarding?     : boolean    -- shows wizard chrome
//   onDone?         : ()         -- primary CTA in wizard chrome
//   onReset?        : ()         -- secondary CTA in wizard chrome
//   resetEnabled?   : boolean
//   accordionAisles? : boolean   -- if true, only one aisle may be expanded (Settings; onboarding keeps false)

export default function SuggestionsEditor(props) {
  const {
    aisles = {}, categories = {}, visibleItems = {}, libraryItems = {},
    onRenameAisle, onAddAisle, onDeleteAisle, onReorderAisles,
    onRenameCategory, onAddCategory, onMoveCategory, onMergeCategory,
    onboarding = false, onDone, onReset, resetEnabled = false,
    accordionAisles = false,
  } = props;

  const [expandedAisles, setExpandedAisles] = useState(() => new Set());
  const [addingAisle, setAddingAisle] = useState(false);
  const [addingCategoryIn, setAddingCategoryIn] = useState(null); // aisleId
  const [menu, setMenu] = useState(null);          // { kind: 'aisle'|'category', id }
  const [renameTarget, setRenameTarget] = useState(null); // { kind, id }
  const [moveSheetCatId, setMoveSheetCatId] = useState(null);
  const [mergeSheet, setMergeSheet] = useState(null);     // { fromCatId }
  const [aisleDeleteConfirmId, setAisleDeleteConfirmId] = useState(null); // aisleId

  // --- Derived: ordered aisle list + categories by aisle ----------------------
  const orderedAisleIds = useMemo(() => {
    return Object.keys(aisles)
      .sort((a, b) => (aisles[a]?.order ?? 0) - (aisles[b]?.order ?? 0));
  }, [aisles]);

  const catsByAisle = useMemo(() => {
    const out = {};
    for (const aid of orderedAisleIds) out[aid] = [];
    for (const [cid, c] of Object.entries(categories)) {
      if (!c?.aisleId || !out[c.aisleId]) continue;
      out[c.aisleId].push(cid);
    }
    // Stable ordering inside an aisle: insertion order (Object.entries is insertion order for string keys).
    return out;
  }, [categories, orderedAisleIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleAisleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedAisleIds.indexOf(active.id);
    const newIndex = orderedAisleIds.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderAisles?.(arrayMove(orderedAisleIds, oldIndex, newIndex));
  }

  // --- Library items across all categories (for autocomplete) ---------------
  // Derived lazily per category inside the visible-items editor.

  function toggleAisle(id) {
    setExpandedAisles((prev) => {
      if (accordionAisles) {
        if (prev.has(id)) return new Set();
        return new Set([id]);
      }
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  // --- Render --------------------------------------------------------------
  return (
    <div className="max-w-2xl mx-auto px-4 pb-32">
      {onboarding && (
        <div className="pt-6 pb-4">
          <div className="text-xs uppercase tracking-wider text-gray-500">Step 2 of 2</div>
          <h2 className="text-2xl font-semibold mt-1">Map the app to how you shop</h2>
          <p className="text-gray-600 mt-2">
            Drag aisles into the order you walk your store. You can rearrange or edit anything later in Settings.
          </p>
        </div>
      )}

      {!onboarding && (
        <div className="pt-6 pb-4">
          <h2 className="text-xl font-semibold">Shortcuts</h2>
        </div>
      )}

      {/* Aisle list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleAisleDragEnd}
      >
        <div className="space-y-2">
          <SortableContext items={orderedAisleIds} strategy={verticalListSortingStrategy}>
            {orderedAisleIds.map((aid) => (
              <SortableAisleRow
                key={aid}
                aisleId={aid}
                aisle={aisles[aid]}
                categoryIds={catsByAisle[aid] || []}
                categories={categories}
                visibleItems={visibleItems}
                libraryItems={libraryItems}
                expanded={expandedAisles.has(aid)}
                toggleAisle={toggleAisle}
                openMenu={(kind, id) => setMenu({ kind, id })}
                renameTarget={renameTarget}
                setRenameTarget={setRenameTarget}
                onRenameAisle={onRenameAisle}
                onRenameCategory={onRenameCategory}
                addingCategoryIn={addingCategoryIn}
                setAddingCategoryIn={setAddingCategoryIn}
                onAddCategory={onAddCategory}
              />
            ))}
          </SortableContext>

          {addingAisle && (
            <InlineAddRow
              placeholder="Aisle name"
              onCommit={(name) => { onAddAisle?.(name); setAddingAisle(false); }}
              onCancel={() => setAddingAisle(false)}
            />
          )}

          {!addingAisle && (
            <button
              type="button"
              onClick={() => setAddingAisle(true)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mt-2"
            >
              <Plus size={16} /> Add aisle
            </button>
          )}
        </div>
      </DndContext>

      {/* Wizard chrome */}
      {onboarding && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4 flex items-center justify-between">
          <button
            onClick={onReset}
            disabled={!resetEnabled}
            className="text-sm text-gray-600 disabled:text-gray-300"
          >
            Reset to defaults
          </button>
          <button
            onClick={onDone}
            className="px-4 py-2 bg-gray-900 text-white rounded-md font-medium"
          >
            Done
          </button>
        </div>
      )}

      {/* Overflow menu */}
      {menu && (
        <OverflowMenu
          menu={menu}
          categories={categories}
          catsByAisle={catsByAisle}
          onClose={() => setMenu(null)}
          onRenameClick={() => { setRenameTarget({ kind: menu.kind, id: menu.id }); setMenu(null); }}
          onDeleteAisleClick={() => { setAisleDeleteConfirmId(menu.id); setMenu(null); }}
          onMoveClick={() => { setMoveSheetCatId(menu.id); setMenu(null); }}
          onMergeClick={() => { setMergeSheet({ fromCatId: menu.id }); setMenu(null); }}
        />
      )}

      {/* Move-to-aisle sheet */}
      {moveSheetCatId && (
        <MoveToAisleSheet
          categoryName={categories[moveSheetCatId]?.name}
          currentAisleId={categories[moveSheetCatId]?.aisleId}
          aisles={aisles}
          orderedAisleIds={orderedAisleIds}
          onClose={() => setMoveSheetCatId(null)}
          onPick={(aisleId) => {
            onMoveCategory?.(moveSheetCatId, aisleId);
            setMoveSheetCatId(null);
          }}
        />
      )}

      {mergeSheet && (
        <MergeCategorySheet
          fromCategoryName={categories[mergeSheet.fromCatId]?.name}
          targetCategoryIds={(catsByAisle[categories[mergeSheet.fromCatId]?.aisleId] || [])
            .filter((id) => id !== mergeSheet.fromCatId)}
          categories={categories}
          onClose={() => setMergeSheet(null)}
          onPick={(intoCatId) => {
            onMergeCategory?.(mergeSheet.fromCatId, intoCatId);
            setMergeSheet(null);
          }}
        />
      )}

      {/* Delete aisle confirm */}
      {aisleDeleteConfirmId && (
        <DeleteAisleConfirmModal
          name={formatAisleNameForDisplay(aisles[aisleDeleteConfirmId]?.name)}
          onCancel={() => setAisleDeleteConfirmId(null)}
          onConfirm={() => {
            onDeleteAisle?.(aisleDeleteConfirmId);
            setAisleDeleteConfirmId(null);
          }}
        />
      )}
    </div>
  );
}

// --- Sortable aisle wrapper ----------------------------------------------------
function SortableAisleRow(props) {
  const { aisleId, ...rowProps } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: aisleId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.88 : undefined,
    zIndex: isDragging ? 2 : undefined,
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={style}>
      <AisleRow
        {...rowProps}
        aisleId={aisleId}
        dragHandleProps={{ ...listeners, ...attributes }}
      />
    </div>
  );
}

// --- Aisle row -----------------------------------------------------------------
function AisleRow({
  aisleId, aisle, categoryIds, categories, visibleItems, libraryItems,
  expanded, dragHandleProps,
  toggleAisle, openMenu,
  renameTarget, setRenameTarget, onRenameAisle, onRenameCategory,
  addingCategoryIn, setAddingCategoryIn, onAddCategory,
}) {
  if (!aisle) return null;

  const isRenaming = renameTarget?.kind === 'aisle' && renameTarget.id === aisleId;

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <div className="flex items-center gap-1 px-2 py-3 sm:px-3">
        <button
          type="button"
          className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none shrink-0"
          aria-label="Drag to reorder"
          {...dragHandleProps}
        >
          <GripVertical size={18} />
        </button>
        <button
          type="button"
          onClick={() => toggleAisle(aisleId)}
          className="p-1 text-gray-500 shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <InlineRename
              initial={aisle.name}
              onCommit={(v) => { onRenameAisle?.(aisleId, v); setRenameTarget(null); }}
              onCancel={() => setRenameTarget(null)}
            />
          ) : (
            <button
              type="button"
              onClick={expanded ? () => setRenameTarget({ kind: 'aisle', id: aisleId }) : () => toggleAisle(aisleId)}
              className="text-left w-full font-semibold text-gray-900 truncate"
            >
              {formatAisleNameForDisplay(aisle.name)}
            </button>
          )}
          <div className="text-xs text-gray-500">
            {categoryIds.length} {categoryIds.length === 1 ? 'category' : 'categories'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => openMenu('aisle', aisleId)}
          className="p-1 text-gray-400 hover:text-gray-700 shrink-0"
          aria-label="Aisle options"
        >
          <MoreVertical size={18} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1">
          {categoryIds.map(cid => (
            <CategoryRow
              key={cid}
              catId={cid}
              category={categories[cid]}
              visibleItems={visibleItems[cid] || []}
              libraryItems={libraryItems[cid] || []}
              openMenu={openMenu}
              renameTarget={renameTarget}
              setRenameTarget={setRenameTarget}
              onRenameCategory={onRenameCategory}
            />
          ))}

          {addingCategoryIn === aisleId ? (
            <InlineAddRow
              placeholder="Category name"
              onCommit={(name) => { onAddCategory?.(aisleId, name); setAddingCategoryIn(null); }}
              onCancel={() => setAddingCategoryIn(null)}
            />
          ) : (
            <button
              onClick={() => setAddingCategoryIn(aisleId)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
            >
              <Plus size={14} /> Add category
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Category row --------------------------------------------------------------
function CategoryRow({
  catId, category, visibleItems, libraryItems,
  openMenu, renameTarget, setRenameTarget, onRenameCategory,
}) {
  const isRenaming = renameTarget?.kind === 'category' && renameTarget.id === catId;
  const itemsLine = categoryItemsCommaList(visibleItems, libraryItems);

  return (
    <div className="border border-gray-100 rounded-md">
      <div className="flex items-start px-2 py-2 gap-2">
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <InlineRename
              initial={category.name}
              onCommit={(v) => { onRenameCategory?.(catId, v); setRenameTarget(null); }}
              onCancel={() => setRenameTarget(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setRenameTarget({ kind: 'category', id: catId })}
              className="text-left w-full text-xs text-gray-800 font-medium truncate"
            >
              {category.name}
            </button>
          )}
          <div className="text-xs text-gray-500 mt-0.5 break-words">
            {itemsLine || <span className="italic text-gray-400">No shortcuts or library items</span>}
          </div>
        </div>

        <button
          type="button"
          onClick={() => openMenu('category', catId)}
          className="p-1 text-gray-400 hover:text-gray-700 flex-shrink-0"
        >
          <MoreVertical size={16} />
        </button>
      </div>
    </div>
  );
}

// --- Inline rename / add -------------------------------------------------------
function InlineRename({ initial, onCommit, onCancel }) {
  const [v, setV] = useState(initial);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  function commit() { const s = v.trim(); if (s) onCommit(s); else onCancel(); }
  return (
    <input
      ref={ref}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      className="w-full text-xs font-semibold text-gray-900 bg-transparent border-b border-gray-300 focus:outline-none focus:border-gray-700"
    />
  );
}

function InlineAddRow({ placeholder, onCommit, onCancel }) {
  const [v, setV] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  function commit() { const s = v.trim(); if (s) onCommit(s); else onCancel(); }
  return (
    <input
      ref={ref}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
    />
  );
}

// --- Overflow menu (bottom sheet) ---------------------------------------------
function OverflowMenu({
  menu, categories, catsByAisle,
  onClose, onRenameClick, onDeleteAisleClick, onMoveClick, onMergeClick,
}) {
  const items = [];

  if (menu.kind === 'aisle') {
    const hasCategories = (catsByAisle[menu.id] || []).length > 0;
    items.push({ label: 'Rename', onClick: onRenameClick });
    items.push({
      label: 'Delete aisle',
      onClick: onDeleteAisleClick,
      disabled: hasCategories,
      hint: hasCategories ? 'Merge or move this aisle\'s categories first.' : null,
      destructive: true,
    });
  } else if (menu.kind === 'category') {
    const aisleId = categories[menu.id]?.aisleId;
    const siblingCount = aisleId ? (catsByAisle[aisleId] || []).length : 0;
    const mergeDisabled = siblingCount <= 1;
    items.push({ label: 'Rename', onClick: onRenameClick });
    items.push({ label: 'Move to…', onClick: onMoveClick });
    items.push({
      label: 'Merge into…',
      onClick: onMergeClick,
      disabled: mergeDisabled,
      hint: mergeDisabled ? 'Add another category in this aisle first.' : null,
    });
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="absolute bottom-0 inset-x-0 bg-white rounded-t-xl p-2 pb-safe"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto my-2" />
        {items.map((it, i) => (
          <button
            key={i}
            onClick={it.disabled ? undefined : it.onClick}
            disabled={it.disabled}
            className={`w-full text-left px-4 py-3 rounded-md text-base ${
              it.destructive ? 'text-red-600' : 'text-gray-900'
            } ${it.disabled ? 'opacity-40' : 'hover:bg-gray-50'}`}
          >
            <div>{it.label}</div>
            {it.hint && <div className="text-xs text-gray-500 mt-0.5">{it.hint}</div>}
          </button>
        ))}
        <button
          onClick={onClose}
          className="w-full text-center px-4 py-3 mt-1 rounded-md text-gray-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Move-to-aisle sheet -------------------------------------------------------
function MoveToAisleSheet({ categoryName, currentAisleId, aisles, orderedAisleIds, onClose, onPick }) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="absolute bottom-0 inset-x-0 bg-white rounded-t-xl p-2 pb-safe max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto my-2" />
        <div className="px-4 pt-1 pb-3">
          <div className="font-semibold">
            Move {categoryName}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Categories don&apos;t remember their original aisle.
          </div>
        </div>
        <div className="overflow-auto">
          {orderedAisleIds.map(aid => (
            <button
              key={aid}
              onClick={() => onPick(aid)}
              disabled={aid === currentAisleId}
              className={`w-full text-left px-4 py-3 rounded-md text-base ${
                aid === currentAisleId ? 'opacity-40' : 'hover:bg-gray-50'
              }`}
            >
              {formatAisleNameForDisplay(aisles[aid].name)}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full text-center px-4 py-3 mt-1 rounded-md text-gray-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Merge into category (same aisle) -----------------------------------------
function MergeCategorySheet({
  fromCategoryName,
  targetCategoryIds,
  categories,
  onClose,
  onPick,
}) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="absolute bottom-0 inset-x-0 bg-white rounded-t-xl p-2 pb-safe max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto my-2" />
        <div className="px-4 pt-1 pb-3">
          <div className="font-semibold">
            Merge {fromCategoryName ? `“${fromCategoryName}”` : 'category'} into…
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Shortcuts and library items move to the category you pick. This category is removed.
          </div>
        </div>
        <div className="overflow-auto">
          {targetCategoryIds.map((cid) => (
            <button
              key={cid}
              onClick={() => onPick(cid)}
              className="w-full text-left px-4 py-3 rounded-md text-base hover:bg-gray-50"
            >
              {categories[cid]?.name || cid}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full text-center px-4 py-3 mt-1 rounded-md text-gray-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Delete aisle confirm modal ------------------------------------------------
function DeleteAisleConfirmModal({ name, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-lg max-w-sm w-full p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-red-600 mb-2">
          <Trash2 size={18} />
          <div className="font-semibold">Delete aisle?</div>
        </div>
        <p className="text-sm text-gray-700">
          Delete <span className="font-medium">{name}</span>? This aisle has no categories, so nothing else is lost.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            Delete aisle
          </button>
        </div>
      </div>
    </div>
  );
}
