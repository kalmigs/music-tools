import { useContext, useEffect } from 'react';

import {
  KeyboardShortcutsContext,
  type KeyboardShortcut,
  type KeyboardShortcutsContextValue,
} from '@/lib/keyboard-shortcuts-context';

export function useKeyboardShortcuts(): KeyboardShortcutsContextValue {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error('useKeyboardShortcuts must be used within a KeyboardShortcutsProvider');
  }
  return context;
}

/**
 * Hook for pages to register their keyboard shortcuts.
 * Shortcuts are automatically unregistered when the component unmounts.
 */
export function useRegisterShortcuts(shortcuts: KeyboardShortcut[]) {
  const { registerPageShortcuts } = useKeyboardShortcuts();

  useEffect(() => {
    if (shortcuts.length === 0) return;
    return registerPageShortcuts(shortcuts);
  }, [shortcuts, registerPageShortcuts]);
}
