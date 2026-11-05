import { useMe, hasPermission } from '../lib/auth.js';
import { EmptyState } from './ui.jsx';

/** Hides a page from people without the permission. The server still enforces it on every call. */
export function RequirePermission({ action, children }) {
  const me = useMe();
  if (!me.data) return null;
  if (!hasPermission(me.data, action)) {
    return (
      <EmptyState title="This area is not open to your role">
        Ask an admin if you need access.
      </EmptyState>
    );
  }
  return children;
}
