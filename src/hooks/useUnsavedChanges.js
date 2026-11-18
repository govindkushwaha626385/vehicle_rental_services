import { useEffect } from 'react';

/**
 * Warn before a full-page unload while an admin form has unsaved changes.
 * In-app navigation is handled by the visible dirty-state indicator and by
 * keeping saves explicit; browsers do not allow custom text in this dialog.
 */
export function useUnsavedChanges(dirty, message = 'You have unsaved changes.') {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, message]);
}
