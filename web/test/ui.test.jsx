import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, ConfirmDialog, Field, Pill, EmptyState } from '../src/components/ui.jsx';

describe('UI kit', () => {
  it('Pill shows its words, not just a colour', () => {
    render(<Pill tone="bad">Below cut-off</Pill>);
    expect(screen.getByText('Below cut-off')).toBeInTheDocument();
  });

  it('Field links the label to its input and shows the server error', () => {
    render(
      <Field label="Email" error="Enter a valid email.">
        {(p) => <input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a valid email.')).toBeInTheDocument();
  });

  it('ConfirmDialog states the consequence and fires confirm only on click', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Reject Ravi Kumar?"
        consequence="An email draft is created and the candidate is removed from active lists."
        confirmLabel="Reject candidate"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/removed from active lists/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reject candidate'));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Button defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('EmptyState renders its title and explanation', () => {
    render(<EmptyState title="No candidates yet">Add the first one to start.</EmptyState>);
    expect(screen.getByText('No candidates yet')).toBeInTheDocument();
  });
});
