import { useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Toaster } from 'sonner';
import { CalendarCheck, UsersRound, LogOut, Sun, Moon, Monitor, ChevronsUpDown, Users, Briefcase, SlidersHorizontal, Columns3, UserRoundCheck, BarChart3, Bell as BellIcon, KeyRound } from 'lucide-react';
import { useDigest } from '../lib/data.js';
import { PasswordDialog } from './PasswordDialog.jsx';
import { useMe, useLogout, hasPermission } from '../lib/auth.js';
import { ROLE_LABEL } from '../lib/labels.js';
import { BrandMark } from './Brand.jsx';
import { Skeleton } from './ui.jsx';
import { useTheme } from '../lib/theme.js';

/** Each entry shows only when the server says this person has the permission. */
const NAV = [
  { to: '/', label: 'Today', icon: CalendarCheck, end: true },
  { to: '/candidates', label: 'Candidates', icon: Users, permission: 'candidate.read' },
  { to: '/board', label: 'Board', icon: Columns3, permission: 'candidate.read' },
  { to: '/probation', label: 'Probation', icon: UserRoundCheck, permission: 'probation.read' },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'reports.read' },
  { to: '/requisitions', label: 'Roles', icon: Briefcase, permission: 'requisition.read' },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal, permission: 'settings.read' },
  { to: '/team', label: 'Team', icon: UsersRound, permission: 'users.manage' },
];

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return <div className="fullpage"><Skeleton rows={4} /></div>;
  }
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell user={me.data} />;
}

function AppShell({ user }) {
  const items = NAV.filter((i) => !i.permission || hasPermission(user, i.permission));
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <BrandMark />
        <nav>
          <ul className="nav-list">
            {items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className="nav-link">
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <UserMenu user={user} />
      </aside>
      <Bell />
      <main className="content" id="main">
        <Outlet />
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}

/** Reminders waiting for this person. Opens Today, where each one can be done. */
function Bell() {
  const digest = useDigest();
  const count = digest.data?.count ?? 0;
  return (
    <NavLink to="/" className="bell" aria-label={`Reminders: ${count} waiting`}>
      <BellIcon size={18} aria-hidden="true" />
      {count > 0 && <span className="bell-count num">{count > 99 ? '99+' : count}</span>}
    </NavLink>
  );
}

function UserMenu({ user }) {
  const logout = useLogout();
  const [changing, setChanging] = useState(false);
  const navigate = useNavigate();
  const { choice, setChoice } = useTheme();

  return (
    <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="user-trigger" aria-label={`Account menu for ${user.name}`}>
        <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
        <span className="user-meta">
          <span className="user-name">{user.name}</span>
          <span className="user-role">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronsUpDown size={16} aria-hidden="true" className="muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" side="top" align="start" sideOffset={8}>
          <DropdownMenu.Label className="menu-label">Appearance</DropdownMenu.Label>
          {[['system', 'Match my computer', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([value, label, Icon]) => (
            <DropdownMenu.CheckboxItem
              key={value}
              className="menu-item"
              checked={choice === value}
              onCheckedChange={() => setChoice(value)}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </DropdownMenu.CheckboxItem>
          ))}
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item className="menu-item" onSelect={() => setChanging(true)}>
            <KeyRound size={16} aria-hidden="true" /> Change password
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item
            className="menu-item"
            onSelect={async () => {
              await logout.mutateAsync().catch(() => {});
              navigate('/login', { replace: true });
            }}
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
      <PasswordDialog open={changing} onClose={() => setChanging(false)} />
    </>
  );
}

const initials = (name) => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
