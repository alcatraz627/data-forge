import { DEFAULT_VIEWS, type ServerDoc, type ViewDef, matchesView } from '@forge/core';
import { useEffect, useMemo, useState } from 'react';
import { filterDocs, startSync, useForge } from './store';
import {
  BottomBar,
  Capture,
  EditorPanel,
  type MobileScreen,
  NoteCard,
  ViewChips,
  useIsMobile,
} from './ui';

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

const ALL_VIEW: ViewDef = { id: 'all', name: 'All', filter: {} };

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const snap = useForge();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [viewId, setViewId] = useState('all');
  const [screen, setScreen] = useState<MobileScreen>('notes');
  // Captured at click time: the editor works on a stable snapshot (its own
  // baseRev handles concurrent changes), so a live delete elsewhere can't
  // yank the panel out from under in-progress typing.
  const [openDoc, setOpenDoc] = useState<ServerDoc | null>(null);

  useEffect(() => startSync(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
        const v = DEFAULT_VIEWS[Number(e.key) - 1];
        if (v) {
          e.preventDefault();
          setViewId(v.id);
        }
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === '/') {
        e.preventDefault();
        setScreen('search');
        setTimeout(() => document.getElementById('search')?.focus(), 0);
      }
      if (e.key === 'n') {
        e.preventDefault();
        setScreen('capture');
        setTimeout(() => document.getElementById('capture')?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeView = DEFAULT_VIEWS.find((v) => v.id === viewId) ?? ALL_VIEW;
  const viewDocs = useMemo(
    () => snap.docs.filter((d) => matchesView(d, activeView)),
    [snap.docs, activeView],
  );
  // Search always spans everything; the view scopes only the browse stream.
  const docs = useMemo(
    () => (query.trim() ? filterDocs(snap.docs, query) : viewDocs),
    [snap.docs, viewDocs, query],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of DEFAULT_VIEWS) c[v.id] = snap.docs.filter((d) => matchesView(d, v)).length;
    return c;
  }, [snap.docs]);

  const showCapture = !isMobile || screen === 'capture';
  const showSearch = !isMobile || screen === 'search';
  const showChips = !isMobile || screen === 'notes';
  const showStream = !isMobile || screen !== 'capture';

  return (
    <div className={isMobile ? 'app app-mobile' : 'app'}>
      <header className="topbar">
        <h1>Data Forge</h1>
        <div className="topbar-right">
          {snap.notice && <span className="notice">{snap.notice}</span>}
          {snap.pending > 0 && <span className="pending">{snap.pending} pending</span>}
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
        {showCapture && <Capture onSaved={isMobile ? () => setScreen('notes') : undefined} />}
        {showSearch && (
          <input
            id="search"
            className="search"
            type="search"
            placeholder="Search everything…  ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {showChips && !query.trim() && (
          <ViewChips views={DEFAULT_VIEWS} active={viewId} counts={counts} onPick={setViewId} />
        )}
        {showStream && (
          <section className="stream">
            {docs.length === 0 ? (
              <p className="empty">
                {!snap.loaded
                  ? 'Connecting…'
                  : query
                    ? 'No matches.'
                    : isMobile && screen === 'search'
                      ? 'Type to search everything.'
                      : viewId === 'all'
                        ? 'Nothing here yet. Drop your first thought above.'
                        : `Nothing matches ${activeView.name} right now.`}
              </p>
            ) : (
              docs.map((d) => <NoteCard key={d.id} doc={d} onOpen={() => setOpenDoc(d)} />)
            )}
          </section>
        )}
      </main>

      {isMobile && (
        <BottomBar
          screen={screen}
          onPick={(s) => {
            setScreen(s);
            if (s === 'search') setTimeout(() => document.getElementById('search')?.focus(), 50);
          }}
        />
      )}
      {openDoc && <EditorPanel key={openDoc.id} doc={openDoc} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}
