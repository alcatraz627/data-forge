import { DEFAULT_VIEWS, type ServerDoc, type ViewDef, matchesView } from '@forge/core';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionsPage,
  Agenda,
  BottomBar,
  Capture,
  EditorPanel,
  type ListDensity,
  type MobileScreen,
  NoteCard,
  Readout,
  SettingsSheet,
  ViewChips,
  useIsMobile,
} from './ui';
import { Icon } from './icons';
import { captureCanvas, filterDocs, startSync, useForge } from './store';

/** dark | light | system. `system` removes the data-theme attribute so the
 * stylesheet's prefers-color-scheme branch decides. */
export type ThemeMode = 'dark' | 'light' | 'system';

function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('forge-theme-mode');
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
    // pre-TEMPERED key
    return localStorage.getItem('forge-theme') === 'light' ? 'light' : 'dark';
  });
  useEffect(() => {
    if (mode === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    localStorage.setItem('forge-theme-mode', mode);
  }, [mode]);
  return [mode, setMode];
}

export type TypeSize = 'S' | 'M' | 'L';
export type DensityPref = 'compact' | 'relaxed';

const ALL_VIEW: ViewDef = { id: 'all', name: 'All', filter: {} };
const LIST_DENSITIES: ListDensity[] = ['skim', 'list', 'cards'];

export default function App() {
  const [themeMode, setThemeMode] = useThemeMode();
  const snap = useForge();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [viewId, setViewId] = useState('all');
  const [screen, setScreen] = useState<MobileScreen>('notes');
  const [agendaMode, setAgendaMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typeSize, setTypeSize] = useState<TypeSize>(
    () => (localStorage.getItem('forge-type-size') as TypeSize) || 'M',
  );
  const [densityPref, setDensityPref] = useState<DensityPref>(() => {
    const stored = localStorage.getItem('forge-density-pref');
    return stored === 'relaxed' || stored === 'compact' ? stored : 'compact';
  });
  const [listDensity, setListDensity] = useState<ListDensity>(() => {
    const stored = localStorage.getItem('forge-list-density');
    return stored === 'skim' || stored === 'cards' ? stored : 'list';
  });
  // Captured at click time: the editor works on a stable snapshot (its own
  // baseRev handles concurrent changes), so a live delete elsewhere can't
  // yank the panel out from under in-progress typing.
  const [openDoc, setOpenDoc] = useState<ServerDoc | null>(null);
  // Bumped when navigation happens under an open editor; the editor
  // auto-saves and closes itself in response.
  const [closeToken, setCloseToken] = useState(0);

  useEffect(() => startSync(), []);
  useEffect(() => {
    document.documentElement.dataset.typeSize = typeSize;
    localStorage.setItem('forge-type-size', typeSize);
  }, [typeSize]);
  useEffect(() => {
    localStorage.setItem('forge-density-pref', densityPref);
  }, [densityPref]);
  useEffect(() => {
    localStorage.setItem('forge-list-density', listDensity);
  }, [listDensity]);

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
  const showActions = isMobile && screen === 'actions';
  const showStream =
    !showAgenda && !showActions && (!isMobile ? !agendaMode : screen !== 'capture');
  const reminderCount = useMemo(
    () => snap.docs.filter((d) => d.reminders.some((r) => r.status !== 'done')).length,
    [snap.docs],
  );

  const syncState = !snap.connected ? 'offline' : snap.pending > 0 ? 'pending' : 'synced';

  const cycleListDensity = (): void => {
    const next =
      LIST_DENSITIES[(LIST_DENSITIES.indexOf(listDensity) + 1) % LIST_DENSITIES.length] ?? 'list';
    setListDensity(next);
  };

  return (
    <div
      className={isMobile ? 'app app-mobile' : 'app'}
      data-density={densityPref}
      data-list-density={listDensity}
    >
      <Readout
        syncState={syncState}
        pending={snap.pending}
        onOpenSettings={() => setSettingsOpen(true)}
      />

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
        {showChips && !query.trim() && !isMobile && (
          <div className="desktop-filter-row">
            <ViewChips views={DEFAULT_VIEWS} active={viewId} counts={counts} onPick={setViewId} />
            <span className="spacer" />
            <button
              type="button"
              className={`ghost${agendaMode ? ' active' : ''}`}
              onClick={() => setAgendaMode((a) => !a)}
            >
              <Icon name="bell" />
              agenda{reminderCount ? ` · ${reminderCount}` : ''}
            </button>
          </div>
        )}
        {showAgenda && (
          <Agenda
            docs={snap.docs}
            onOpen={(id) => setOpenDoc(snap.docs.find((d) => d.id === id) ?? null)}
          />
        )}
        {showActions && <ActionsPage />}
        {showStream && isMobile && screen === 'search' && !query.trim() ? (
          // Pre-query search is a launchpad (pinned + recent), not a clone of
          // the Notes list — the two tabs stop showing identical content.
          <section className="stream search-start">
            {snap.docs.filter((d) => d.pinned && matchesView(d, ALL_VIEW)).length > 0 && (
              <>
                <h2 className="section-rule">
                  <span>PINNED</span>
                </h2>
                {snap.docs
                  .filter((d) => d.pinned && matchesView(d, ALL_VIEW))
                  .slice(0, 3)
                  .map((d) => (
                    <NoteCard key={d.id} doc={d} onOpen={() => setOpenDoc(d)} />
                  ))}
              </>
            )}
            <h2 className="section-rule">
              <span>RECENT</span>
            </h2>
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
                <span className="empty-glyph">
                  {query || (isMobile && screen === 'search') ? '>' : '▮'}
                </span>
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
                          ? 'Drop your first thought.'
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

      {/* Page bar: page-scoped filters/actions in thumb reach, directly above
          the tab bar. Never navigation, never more than one row. */}
      {isMobile && screen === 'notes' && !query.trim() && (
        <div className="page-bar">
          <ViewChips views={DEFAULT_VIEWS} active={viewId} counts={counts} onPick={setViewId} />
          <span className="spacer" />
          <button
            type="button"
            className="density-toggle"
            title="List density"
            onClick={cycleListDensity}
          >
            {listDensity === 'skim' ? 'Skim' : listDensity === 'list' ? 'List' : 'Cards'}
          </button>
        </div>
      )}

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
      {settingsOpen && (
        <SettingsSheet
          themeMode={themeMode}
          onThemeMode={setThemeMode}
          typeSize={typeSize}
          onTypeSize={setTypeSize}
          density={densityPref}
          onDensity={setDensityPref}
          pending={snap.pending}
          connected={snap.connected}
          onClose={() => setSettingsOpen(false)}
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
