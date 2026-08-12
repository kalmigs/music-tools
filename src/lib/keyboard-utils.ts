// Constants
// Input types that accept no text, so page shortcuts stay live while they hold focus.
const NON_TEXT_INPUT_TYPES = new Set(['range', 'checkbox', 'radio']);

// Main API
/**
 * True when a keydown target is text entry and page-level shortcuts should stand down.
 * Sliders, checkboxes, and radios are not text entry, so shortcuts still fire for them.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;

  switch (el.tagName) {
    case 'TEXTAREA':
    case 'SELECT':
      return true;
    case 'INPUT':
      return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
    default:
      return false;
  }
}
