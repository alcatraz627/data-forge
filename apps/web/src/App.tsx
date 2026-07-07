import { useEffect, useMemo, useState } from 'react';
import { filterDocs, startSync, useForge } from './store';
import { Capture, EditorPanel, NoteCard } from './ui';

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

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const snap = useForge();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => startSync(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      }
      if (e.key === 'n') {
        e.preventDefault();
        document.getElementById('capture')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const docs = useMemo(() => filterDocs(snap.docs, query), [snap.docs, query]);
  const openDoc = (openId && snap.docs.find((d) => d.id === openId)) || null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Data Forge</h1>
        <div className="topbar-right">
          {snap.notice && <span className="notice">{snap.notice}</span>}
          <span
            className={`sync-dot${snap.connected ? ' on' : ''}`}
            title={snap.connected ? 'live sync' : 'reconnecting…'}
          />
          <button type="button" className="ghost" onClick={toggleTheme}>
            {theme === 'dark' ? 'light mode' : 'dark mode'}
          </button>
        </div>
      </header>

      <main>
        <Capture />
        <input
          id="search"
          className="search"
          type="search"
          placeholder="Search…  ( / )"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <section className="stream">
          {docs.length === 0 ? (
            <p className="empty">
              {!snap.loaded
                ? 'Connecting…'
                : query
                  ? 'No matches.'
                  : 'Nothing here yet. Drop your first thought above.'}
            </p>
          ) : (
            docs.map((d) => <NoteCard key={d.id} doc={d} onOpen={() => setOpenId(d.id)} />)
          )}
        </section>
      </main>

      {openDoc && <EditorPanel doc={openDoc} onClose={() => setOpenId(null)} />}
    </div>
  );
}
