import { Children, Fragment, isValidElement, useRef, useState } from 'react';
import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

// Radix does not allow an empty string as an item value, so the empty choice uses a stand-in.
const EMPTY = '__empty__';
const toItemValue = (v) => (v === '' || v == null ? EMPTY : String(v));

/** Reads <option> and <optgroup> children, so call sites stay the same as with a native select. */
function readOptions(children) {
  const items = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') {
      items.push({ group: child.props.label, options: readOptions(child.props.children) });
    } else if (child.type === Fragment) {
      items.push(...readOptions(child.props.children));
    } else if (child.type === 'option') {
      const { value, children: label, disabled } = child.props;
      items.push({ value: value ?? String(label), label, disabled });
    }
  });
  return items;
}

/**
 * Drop-in replacement for <Select>. Same props and the same onChange(event) shape,
 * but the list is styled: a clear trigger, a hairline panel, and a highlighted row on hover.
 */
export function Select({ value, onChange, children, disabled, id, className = '', placeholder, ...aria }) {
  const rootRef = useRef(null);
  const [container, setContainer] = useState(null);
  const items = readOptions(children);
  const current = toItemValue(value ?? '');
  const selected = items.flatMap((i) => (i.group ? i.options : [i])).find((i) => toItemValue(i.value) === current);
  const shown = selected?.label ?? placeholder ?? 'Choose';

  return (
    <div ref={rootRef} className={`select ${className}`}>
      <RSelect.Root
        value={current}
        disabled={disabled}
        onOpenChange={(open) => {
          // A native <dialog> sits in the top layer, so the list must open inside it to be visible.
          if (open) setContainer(rootRef.current?.closest('dialog') ?? document.body);
        }}
        onValueChange={(v) => onChange?.({ target: { value: v === EMPTY ? '' : v } })}
      >
        <RSelect.Trigger id={id} className="select-trigger" aria-label={aria['aria-label']} aria-invalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']}>
          <RSelect.Value placeholder={shown}>{shown}</RSelect.Value>
          <RSelect.Icon className="select-icon"><ChevronDown size={16} aria-hidden="true" /></RSelect.Icon>
        </RSelect.Trigger>
        <RSelect.Portal container={container ?? undefined}>
          <RSelect.Content className="select-content" position="popper" sideOffset={6}>
            <RSelect.Viewport className="select-viewport">
              {items.map((it, idx) => it.group ? (
                <RSelect.Group key={`g${idx}`}>
                  <RSelect.Label className="select-label">{it.group}</RSelect.Label>
                  {it.options.map((o) => <Item key={toItemValue(o.value)} o={o} />)}
                </RSelect.Group>
              ) : <Item key={toItemValue(it.value)} o={it} />)}
            </RSelect.Viewport>
          </RSelect.Content>
        </RSelect.Portal>
      </RSelect.Root>
    </div>
  );
}

function Item({ o }) {
  return (
    <RSelect.Item value={toItemValue(o.value)} disabled={o.disabled} className="select-item">
      <RSelect.ItemText>{o.label}</RSelect.ItemText>
      <RSelect.ItemIndicator className="select-check"><Check size={14} aria-hidden="true" /></RSelect.ItemIndicator>
    </RSelect.Item>
  );
}
