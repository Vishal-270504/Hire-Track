# HireTrack design system

Direction: calm, precise and quick, for people who use the tool all day. Warm paper and ink surfaces, one deep teal accent, and colour used only where it carries meaning. No gradients, glass, glow, decorative illustration or emoji icons.

## Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#f6f4ef` | `#161614` | Page background |
| `--surface` | `#ffffff` | `#1f1e1b` | Cards, tables, dialogs, menus |
| `--sunk` | `#eeebe3` | `#191816` | Sidebar, table headers, column backgrounds |
| `--line` / `--line-strong` | `#dcd7cb` / `#b9b3a4` | `#34322d` / `#4a463e` | Hairlines and borders |
| `--ink` / `--ink-2` / `--ink-3` | `#1d1c19` / `#4f4b43` / `#757064` | `#ece9e1` / `#bdb8ac` / `#958f83` | Primary, secondary and quiet text |
| `--accent` | `#0f5c55` (deep teal) | `#5fb3a8` | Primary buttons, selection, the active step |
| `--ok`, `--warn`, `--bad`, `--info` | green, amber, brick, slate | lighter versions | Status only, always with words |

Colour is never the only signal: every status is a pill with a word in it.

## Shape

- One radius everywhere: `--radius` (6 px). Only avatars and the notification count are round (`--radius-round`).
- Borders are 1 px hairlines; shadows are avoided (dialogs and menus get a soft shadow for lift only).

## Type

- One family: Public Sans (self-hosted, variable). Not a display face in labels or buttons.
- A fixed scale: `--t-xs` 0.78 rem, `--t-sm` 0.875, `--t-md` 1, `--t-lg` 1.125, `--t-xl` 1.4, `--t-2xl` 1.8.
- Numbers (scores, money, days, dates in tables) use tabular figures (`.num`) so columns line up.
- Labels above fields are semibold; upper-case small labels mark facts and table headers.

## Space

A 4 px scale: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s6` 24, `--s8` 32, `--s12` 48. Sections are separated by generous space, and related items sit close together.

## Components (in `web/src/components/`)

- `ui.jsx`: `Pill`, `Button` (primary, secondary, ghost, danger), `Field` (label, hint, server error), `PageHeader`, `DataTable` (loading, error with retry, empty), `Dialog`, `ConfirmDialog`, `EmptyState`, `Skeleton`.
- `kit.jsx`: `TabBar` (accessible tabs), `ActionMenu` (the ⋯ menu), `ChipInput` (skills), `Steps` (wizard), `Facts` (key/value list), `Score`, `Section`.
- `AppShell.jsx`: the signed-in frame (navigation filtered by permission, the reminder bell, the account menu).
- Every dialog that changes something uses `ActionDialog` (`features/candidates/dialogs.jsx`): the consequence is stated, server messages appear next to the right field, and the button shows progress.

## Motion and feedback

- Transitions are 150 to 250 ms and only show state. Reduced-motion preferences switch them off.
- Success is a short toast; a reversible action (rejection) offers Undo for the whole undo window.

## Responsive

- Tables collapse to labelled stacked rows under 800 px.
- The board scrolls horizontally, column by column.
- Touch targets are at least 40 px.

## Accessibility

- Tabs and menus use Radix primitives (keyboard, roles and focus handled).
- Every input has a label; errors are linked with `aria-describedby` and `aria-invalid`.
- Focus is shown with a visible ring (`--focus`).
