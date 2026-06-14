export type UndoRedoAction = "undo" | "redo";

/** match Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo), ignoring form fields. */
export function matchUndoRedoShortcut(e: KeyboardEvent): UndoRedoAction | null {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  // contenteditable hosts (rich-text editors) own their own undo stack
  if (target?.isContentEditable) return null;
  if (!(e.ctrlKey || e.metaKey)) return null;
  // shift flips e.key to uppercase "Z" on most browsers
  if (e.key.toLowerCase() !== "z") return null;
  return e.shiftKey ? "redo" : "undo";
}
