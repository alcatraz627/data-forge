import { DEFAULT_VIEWS, type ServerDoc, type ViewDef, matchesView } from '@forge/core';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import { captureCanvas, filterDocs, flashNotice, startSync, useForge } from './store';
import {
  Agenda,
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
  const [agendaMode, setAgendaMode] = useState(false);
  // Captured at click time: the editor works on a stable snapshot (its own
  // baseRev handles concurrent changes), so a live delete elsewhere can't
  // yank the panel out from under in-progress typing.
  const [openDoc, setOpenDoc] = useState<ServerDoc | null>(null);
  // Bumped when navigation happens under an open editor; the editor
  // auto-saves and closes itself in response.
  const [closeToken, setCloseToken] = useState(0);

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

  const showAgenda = isMobile ? screen === 'agenda' : agendaMode;
  const showCapture = !isMobile ? !agendaMode : screen === 'capture';
  const showSearch = !isMobile ? !agendaMode : screen === 'search';
  const showChips = !isMobile ? !agendaMode : screen === 'notes';
  const showStream = !showAgenda && (!isMobile ? !agendaMode : screen !== 'capture');
  const reminderCount = useMemo(
    () => snap.docs.filter((d) => d.reminders.some((r) => r.status !== 'done')).length,
    [snap.docs],
  );

  // One glanceable sync state instead of a dot plus a separate pending
  // counter: synced (green) / pending (amber + queued count) / offline (red).
  // Count and color differ together, so the state never rides on color alone.
  const syncState = !snap.connected ? 'offline' : snap.pending > 0 ? 'pending' : 'synced';
  const syncTitle =
    syncState === 'offline'
      ? 'Offline — changes queue locally and sync when back'
      : syncState === 'pending'
        ? `${snap.pending} queued change${snap.pending === 1 ? '' : 's'}`
        : 'Synced';

  return (
    <div className={isMobile ? 'app app-mobile' : 'app'} data-density={isMobile ? 'compact' : 'comfortable'}>
      <header className="topbar">
        <h1>
          <Icon name="note" />
          Data Forge
        </h1>
        <div className="topbar-right">
          <button
            type="button"
            className="sync-chip"
            data-state={syncState}
            title={syncTitle}
            onClick={() => flashNotice(syncTitle)}
          >
            <span className="sync-dot" />
            {syncState === 'pending' && <span className="sync-count">{snap.pending}</span>}
            {syncState === 'offline' && <span className="sync-label">offline</span>}
          </button>
          {!isMobile && (
            <button
              type="button"
              className={`ghost${agendaMode ? ' active' : ''}`}
              onClick={() => setAgendaMode((a) => !a)}
              title="Agenda"
            >
              <Icon name="bell" />
              agenda{reminderCount ? ` · ${reminderCount}` : ''}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            onClick={toggleTheme}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <main>
        {showCapture && (
          <Capture
            onSaved={isMobile ? () => setScreen('notes') : undefined}
            onCanvas={() => void captureCanvas().then(setOpenDoc)}
          />
        )}
        {showSearch && (
          <input
            id="search"
            className="search"
            type="search"
            placeholder={isMobile ? 'Search everything…' : 'Search everything…  ( / )'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {showChips && !query.trim() && (
          <ViewChips views={DEFAULT_VIEWS} active={viewId} counts={counts} onPick={setViewId} />
        )}
        {showAgenda && (
          <Agenda
            docs={snap.docs}
            onOpen={(id) => setOpenDoc(snap.docs.find((d) => d.id === id) ?? null)}
          />
        )}
        {showStream && isMobile && screen === 'search' && !query.trim() ? (
          // Pre-query search is a launchpad (pinned + recent), not a clone of
          // the Notes list — the two tabs stop showing identical content.
          <section className="stream search-start">
            {snap.docs.filter((d) => d.pinned && matchesView(d, ALL_VIEW)).length > 0 && (
              <>
                <h2 className="group-heading">Pinned</h2>
                {snap.docs
                  .filter((d) => d.pinned && matchesView(d, ALL_VIEW))
                  .slice(0, 3)
                  .map((d) => (
                    <NoteCard key={d.id} doc={d} onOpen={() => setOpenDoc(d)} />
                  ))}
              </>
            )}
            <h2 className="group-heading">Recent</h2>
            {snap.docs
              .filter((d) => !d.pinned && matchesView(d, ALL_VIEW))
              .slice(0, 4)
              .map((d) => (
                <NoteCard key={d.id} doc={d} onOpen={() => setOpenDoc(d)} />
              ))}
            <p className="search-hint">Type above to search everything.</p>
          </section>
        ) : showStream ? (
          <section className="stream">
            {docs.length === 0 ? (
              <div className="empty">
                <Icon name={query || (isMobile && screen === 'search') ? 'search' : 'inbox'} />
                <p>
                  {!snap.loaded
                    ? 'Connecting…'
                    : query
                      ? 'No matches'
                      : isMobile && screen === 'search'
                        ? 'Search everything'
                        : viewId === 'all'
                          ? 'Nothing here yet'
                          : `Nothing in ${activeView.name}`}
                </p>
                {snap.loaded && (
                  <span className="empty-hint">
                    {query
                      ? 'Try a different word.'
                      : isMobile && screen === 'search'
                        ? 'Type above to find any note.'
                        : viewId === 'all'
                          ? 'Drop your first thought above.'
                          : 'Notes matching this view will show here.'}
                  </span>
                )}
              </div>
            ) : (
              docs.map((d) => <NoteCard key={d.id} doc={d} onOpen={() => setOpenDoc(d)} />)
            )}
          </section>
        ) : null}
      </main>

      {isMobile && (
        <BottomBar
          screen={screen}
          onPick={(s) => {
            // Navigating under an open editor asks it to save-and-close; the
            // screen switches immediately underneath.
            if (openDoc) setCloseToken((t) => t + 1);
            setScreen(s);
            if (s === 'search') setTimeout(() => document.getElementById('search')?.focus(), 50);
          }}
        />
      )}
      {openDoc && (
        <EditorPanel
          key={openDoc.id}
          doc={openDoc}
          closeToken={closeToken}
          onClose={() => setOpenDoc(null)}
        />
      )}
      {snap.notice && (
        <div className="toast" role="status">
          <span className="toast-text">{snap.notice.text}</span>
          {snap.notice.action && (
            <button type="button" className="toast-action" onClick={snap.notice.action.run}>
              {snap.notice.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
