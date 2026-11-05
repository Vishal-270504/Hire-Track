import { useEffect, useState } from 'react';

const KEY = 'hiretrack-theme';

function readChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** 'system' removes the override so the CSS media query decides. */
export function useTheme() {
  const [choice, setChoiceState] = useState(readChoice);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Private mode can block storage; the choice still applies for this visit.
    }
  }, [choice]);

  return { choice, setChoice: setChoiceState };
}
