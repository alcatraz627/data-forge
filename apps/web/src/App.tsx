import { CAPTURE_DEFAULTS, DURABILITY, FORMALITY, IMPORTANCE } from '@forge/core';
import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem('forge-theme') === 'light' ? 'light' : 'dark',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('forge-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function AxisRow({
  name,
  steps,
  active,
}: {
  name: string;
  steps: readonly string[];
  active: string;
}) {
  return (
    <div className="axis-row">
      <span className="axis-name">{name}</span>
      <div className="axis-chips">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            className={`chip${step === active ? ' chip-active' : ''}`}
          >
            {step}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="app">
      <header className="topbar">
        <h1>Data Forge</h1>
        <button type="button" className="ghost" onClick={toggleTheme}>
          {theme === 'dark' ? 'light mode' : 'dark mode'}
        </button>
      </header>

      <main>
        <section className="capture">
          <textarea placeholder="Drop a thought…" rows={3} autoFocus />
          <AxisRow name="durability" steps={DURABILITY} active={CAPTURE_DEFAULTS.durability} />
          <AxisRow name="formality" steps={FORMALITY} active={CAPTURE_DEFAULTS.formality} />
          <AxisRow name="importance" steps={IMPORTANCE} active={CAPTURE_DEFAULTS.importance} />
          <div className="capture-actions">
            <button
              type="button"
              className="primary"
              disabled
              title="Capture is not wired to the server yet"
            >
              Save
            </button>
          </div>
        </section>

        <section className="stream">
          <p className="empty">No notes yet. Capture gets wired to the server next.</p>
        </section>
      </main>
    </div>
  );
}
