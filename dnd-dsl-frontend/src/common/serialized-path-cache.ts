import type { SerializedRef } from "@dnd-language/evaluation/dnd-dsl-serialized-types";

/**
 * Cache mapping serialized AST node objects → their "#/..." path strings.
 *
 * Uses WeakMap so entries for objects that are no longer referenced (e.g. after
 * structuredClone replaces the whole state) are garbage-collected automatically.
 *
 * Invalidation strategy
 * ─────────────────────
 * • invalidateAll()        — marks cache as unpopulated; old WeakMap entries GC'd
 *                            by the runtime as the old state objects go out of scope.
 *                            Use when the root state object is replaced entirely.
 *
 * • invalidateSubtree(node) — deletes the node + all descendants, then immediately
 *                             repopulates the subtree using the node's still-valid path.
 *                             O(subtree size). Use after in-place mutations of a branch.
 */
export class SerializedPathCache {
  private cache = new WeakMap<object, string>();
  private populated = false;

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Look up the path for a node. Populates the full cache on the first call
   * after an invalidation (lazy, one full walk).
   */
  getPath(root: object, target: object): string | undefined {
    this.ensurePopulated(root);
    return this.cache.get(target);
  }

  /** Build a SerializedRef for a node, or undefined if not found in the tree. */
  toRef(root: object, target: object): SerializedRef | undefined {
    const path = this.getPath(root, target);
    return path !== undefined ? { $ref: `#${path}` } : undefined;
  }

  /**
   * Invalidate a node and its entire subtree, then immediately repopulate that
   * branch so subsequent lookups on the same objects remain O(1).
   *
   * Call this after an in-place mutation of a branch (e.g. pushing a new exit
   * onto a location). The node's own path is preserved — only its descendants
   * are refreshed.
   */
  invalidateSubtree(node: object): void {
    const nodePath = this.cache.get(node);

    this.deleteSubtree(node);

    if (nodePath !== undefined) {
      // Re-populate just this branch; rest of cache remains valid.
      this.populate(node, nodePath);
    } else {
      // Node wasn't cached — we don't know its path, so fall back to a full
      // repopulation on next access.
      this.populated = false;
    }
  }

  /**
   * Discard the populated flag so the cache is rebuilt lazily on next access.
   * Old WeakMap entries for replaced objects are collected automatically.
   * Call when the root state object itself is replaced (e.g. undo/redo swap).
   */
  invalidateAll(): void {
    this.populated = false;
    // Intentionally do NOT clear the WeakMap — entries for the old state
    // objects will be GC'd as those objects go out of scope.
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private ensurePopulated(root: object): void {
    if (this.populated) return;
    this.populate(root, '');
    this.populated = true;
  }

  /** Recursively cache every object node in the subtree rooted at `node`. */
  private populate(node: any, path: string): void {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    this.cache.set(node, path);

    for (const key of Object.keys(node)) {
      if (key.startsWith('$')) continue; // skip $type, $ref, etc.
      const val = node[key];

      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          this.populate(val[i], `${path}/${key}/@${i}`);
        }
      } else if (typeof val === 'object' && val !== null) {
        this.populate(val, `${path}/${key}`);
      }
    }
  }

  /** Recursively remove every object node in the subtree from the cache. */
  private deleteSubtree(node: any): void {
    if (typeof node !== 'object' || node === null) return;
    this.cache.delete(node);

    for (const key of Object.keys(node)) {
      if (key.startsWith('$')) continue;
      const val = node[key];

      if (Array.isArray(val)) {
        for (const item of val) this.deleteSubtree(item);
      } else if (typeof val === 'object' && val !== null) {
        this.deleteSubtree(val);
      }
    }
  }
}
