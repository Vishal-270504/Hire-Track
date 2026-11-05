import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderAt, USERS } from './utils.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const signedOut = { 'GET /api/auth/me': () => [401, { error: 'Please sign in to continue.', code: 'unauthorised', fields: {} }] };
const demo = { 'GET /api/auth/demo-accounts': () => [200, { accounts: [] }] };

describe('sign in', () => {
  it('shows a plain message for every empty required field, without calling the server', async () => {
    const { calls } = mockApi({ ...signedOut, ...demo });
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter the email you were given.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/auth/login')).toBe(false);
  });

  it('shows the server message when the password is wrong', async () => {
    mockApi({
      ...signedOut,
      ...demo,
      'POST /api/auth/login': () => [401, { error: 'Email or password is not right. Check both and try again.', code: 'bad_login', fields: {} }],
    });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Work email'), 'hr@x.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Email or password is not right/);
  });

  it('demo role buttons fill in the account for quick testing', async () => {
    mockApi({
      ...signedOut,
      'GET /api/auth/demo-accounts': () => [200, { accounts: [{ name: 'Priya Raman', email: 'hr@hiretrack.local', role: 'HR' }] }],
    });
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: /Priya Raman/ }));
    expect(screen.getByLabelText('Work email')).toHaveValue('hr@hiretrack.local');
    expect(screen.getByLabelText('Password')).toHaveValue('hiretrack-demo');
  });
});

describe('navigation follows permissions', () => {
  it('a non-admin does not see Team in the menu', async () => {
    mockApi({ 'GET /api/auth/me': () => [200, { user: USERS.HR }] });
    renderAt('/');
    expect(await screen.findByText('Today', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Team/ })).toBeNull();
  });

  it('an admin sees Team', async () => {
    mockApi({ 'GET /api/auth/me': () => [200, { user: USERS.ADMIN }] });
    renderAt('/');
    expect(await screen.findByRole('link', { name: /Team/ })).toBeInTheDocument();
  });

  it('opening the Team page as HR shows the role message, not the table', async () => {
    mockApi({ 'GET /api/auth/me': () => [200, { user: USERS.HR }] });
    renderAt('/team');
    expect(await screen.findByText('This area is not open to your role')).toBeInTheDocument();
  });

  it('signed-out visitors are sent to the sign-in page', async () => {
    mockApi({ ...signedOut, ...demo });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Sign in to HireTrack' })).toBeInTheDocument();
  });
});

describe('team administration', () => {
  const people = [
    { id: 1, name: 'Priya Raman', email: 'hr@x.test', role: 'HR', active: true },
    { id: 3, name: 'Sana Iqbal', email: 'int@x.test', role: 'INTERVIEWER', active: false },
  ];

  it('lists people with plain role names and their access state', async () => {
    mockApi({
      'GET /api/auth/me': () => [200, { user: USERS.ADMIN }],
      'GET /api/users': () => [200, { users: people }],
    });
    renderAt('/team');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Priya Raman')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(within(table).getByText('Off')).toBeInTheDocument();
    expect(within(table).getByDisplayValue('Interviewer')).toBeInTheDocument();
  });

  it('turning off access asks first and states the consequence', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => [200, { user: USERS.ADMIN }],
      'GET /api/users': () => [200, { users: people }],
      'PATCH /api/users/1': () => [200, { user: { ...people[0], active: false } }],
    });
    renderAt('/team');
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off access' }));
    expect(await screen.findByText(/cannot sign in until you turn access back on/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'PATCH /api/users/1')).toBe(false);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn off access' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/users/1')).toBe(true));
  });

  it('the add-person form shows each server field error next to its input', async () => {
    mockApi({
      'GET /api/auth/me': () => [200, { user: USERS.ADMIN }],
      'GET /api/users': () => [200, { users: people }],
      'POST /api/users': () => [400, {
        error: 'Please check the highlighted fields.', code: 'validation',
        fields: { password: 'Use at least 10 characters.' },
      }],
    });
    renderAt('/team');
    await userEvent.click(await screen.findByRole('button', { name: /Add person/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'New Person');
    await userEvent.type(within(dialog).getByLabelText('Work email'), 'new@x.test');
    await userEvent.type(within(dialog).getByLabelText('Starting password'), 'short');
    fireEvent.submit(dialog.querySelector('form'));
    expect(await within(dialog).findByText('Use at least 10 characters.')).toBeInTheDocument();
  });

  it('validates the add-person form before any request is sent', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => [200, { user: USERS.ADMIN }],
      'GET /api/users': () => [200, { users: people }],
    });
    renderAt('/team');
    await userEvent.click(await screen.findByRole('button', { name: /Add person/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(dialog.querySelector('form'));
    expect(await within(dialog).findByText('Enter a valid work email.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/users')).toBe(false);
  });
});
