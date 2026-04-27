import { useState, useEffect, useRef, useMemo } from 'react';
import type { Deck, Card, Stats, Response } from '../../common/types';
import CardEditor from './CardEditor';
import EditorialHeader from './EditorialHeader';

interface DeckListProps {
  decks: Deck[];
  cards: Card[];
  stats?: Stats | null;
  onSaveDeck: (deck: Omit<Deck, 'id' | 'createdAt' | 'updatedAt'> | Deck) => Promise<Response<Deck>>;
  onDeleteDeck: (deckId: string) => Promise<Response<void>>;
  onSaveCard: (card: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card) => Promise<Response<Card>>;
  onDeleteCard: (cardId: string) => Promise<Response<void>>;
  activeDeckId?: string | null;
  onSetActiveDeck?: (deckId: string | null) => Promise<void> | void;
  editCardId?: string | null;
  editDeckId?: string | null;
  onEditCardHandled?: () => void;
  onBeginStudy?: () => void;
}

const DAY_MS = 86_400_000;

function todayWord() {
  return new Intl.NumberFormat('en-US').format;
}

const numberFmt = todayWord();

function pluralize(n: number, one: string, many?: string) {
  return `${numberFmt(n)} ${n === 1 ? one : many ?? `${one}s`}`;
}

function formatDueDelta(dueMs: number): { label: string; tone: 'now' | 'soon' | 'later' } {
  const dt = dueMs - Date.now();
  if (dt <= 0) return { label: 'now', tone: 'now' };
  if (dt < 60 * 60 * 1000) return { label: `${Math.max(1, Math.round(dt / 60_000))} m`, tone: 'soon' };
  if (dt < 24 * 60 * 60 * 1000) return { label: `${Math.round(dt / 3_600_000)} hr`, tone: 'soon' };
  const days = Math.round(dt / DAY_MS);
  return { label: `${days} d`, tone: 'later' };
}

function shortKind(kind: Card['kind']): string {
  switch (kind) {
    case 'mcq-single': return 'mcq';
    case 'mcq-multi': return 'mcq+';
    case 'cloze': return 'cloze';
    case 'audio': return 'audio';
    default: return 'text';
  }
}

export default function DeckList({
  decks,
  cards,
  stats,
  onSaveDeck,
  onDeleteDeck,
  onSaveCard,
  onDeleteCard,
  activeDeckId,
  onSetActiveDeck,
  editCardId,
  editDeckId,
  onEditCardHandled,
  onBeginStudy,
}: DeckListProps) {
  const [expandedDeck, setExpandedDeck] = useState<string | null>(null);
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [showNewCard, setShowNewCard] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckDescription, setNewDeckDescription] = useState('');
  const [cardFilter, setCardFilter] = useState('');
  const pendingScrollCardIdRef = useRef<string | null>(null);

  // Honor the "edit card from quiz" deep link. Effect-driven setState is
  // intentional: the trigger is an async parent prop, not user-event-driven.
  useEffect(() => {
    if (editCardId && editDeckId && cards.length > 0) {
      const cardToEdit = cards.find(c => c.id === editCardId);
      if (cardToEdit) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing UI to deep-link prop
        setExpandedDeck(editDeckId);
        setEditingCard(cardToEdit);
        pendingScrollCardIdRef.current = cardToEdit.id;
      }
      onEditCardHandled?.();
    }
  }, [editCardId, editDeckId, cards, onEditCardHandled]);

  useEffect(() => {
    const targetCardId = pendingScrollCardIdRef.current;
    if (!targetCardId || editingCard?.id !== targetCardId) return;
    let rafId = 0;
    const timeoutId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(() => {
        const cardContainer = document.getElementById(`card-row-${targetCardId}`);
        cardContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstInput = cardContainer?.querySelector('input, textarea, select') as HTMLElement | null;
        firstInput?.focus({ preventScroll: true });
      });
      pendingScrollCardIdRef.current = null;
    }, 50);
    return () => {
      window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [editingCard, expandedDeck]);

  // Anchor "now" once per mount so useMemo results stay stable. The dashboard
  // is short-lived; we accept slight clock staleness in exchange for purity.
  const [now] = useState(() => Date.now());

  // Per-deck aggregates ----------------------------------------------------
  const perDeck = useMemo(() => {
    const map = new Map<string, {
      total: number;
      due: number;
      newCount: number;
      avgEase: number;
      retention: number; // 0..1 — heuristic from lapses / reviews
      kinds: Record<string, number>;
      forecast: number[]; // 14 days
      cardList: Card[];
    }>();
    for (const deck of decks) {
      const list = cards.filter(c => c.deckId === deck.id);
      const due = list.filter(c => c.due <= now).length;
      const newCount = list.filter(c => c.repetitions === 0).length;
      const avgEase = list.length > 0
        ? list.reduce((s, c) => s + (c.ease ?? 2.5), 0) / list.length
        : 2.5;
      const totalReps = list.reduce((s, c) => s + (c.repetitions ?? 0), 0);
      const totalLapses = list.reduce((s, c) => s + (c.lapses ?? 0), 0);
      const retention = totalReps > 0
        ? Math.max(0, Math.min(1, 1 - totalLapses / totalReps))
        : 0;
      const kinds: Record<string, number> = { text: 0, 'mcq-single': 0, 'mcq-multi': 0, cloze: 0, audio: 0 };
      for (const c of list) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      const forecast = new Array(14).fill(0);
      for (const c of list) {
        const dt = c.due - now;
        if (dt < 0) { forecast[0] += 1; continue; }
        const dayIndex = Math.min(13, Math.floor(dt / DAY_MS));
        forecast[dayIndex] += 1;
      }
      const cardList = [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      map.set(deck.id, { total: list.length, due, newCount, avgEase, retention, kinds, forecast, cardList });
    }
    return map;
  }, [decks, cards, now]);

  const totalDue = useMemo(() => cards.filter(c => c.due <= now).length, [cards, now]);

  // Reviewed-today comes from stats.dailyStats with today's YYYY-MM-DD key
  const reviewedToday = useMemo(() => {
    if (!stats?.dailyStats) return null;
    const todayKey = new Date().toISOString().slice(0, 10);
    const today = stats.dailyStats.find(d => d.date === todayKey);
    return today ? today.reviews : 0;
  }, [stats]);

  // 28-day streak heatmap (last 28 days)
  const streakDays = useMemo(() => {
    const out: { reviews: number; isToday: boolean }[] = [];
    const map = new Map<string, number>();
    for (const d of stats?.dailyStats ?? []) map.set(d.date, d.reviews);
    const today = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push({ reviews: map.get(key) ?? 0, isToday: i === 0 });
    }
    return out;
  }, [stats]);

  const activeDeck = decks.find(d => d.id === activeDeckId) ?? null;
  const activeAgg = activeDeck ? perDeck.get(activeDeck.id) : null;

  // Handlers ---------------------------------------------------------------

  async function handleCreateDeck() {
    if (!newDeckName.trim()) return;
    await onSaveDeck({ name: newDeckName.trim(), description: newDeckDescription.trim() });
    setNewDeckName('');
    setNewDeckDescription('');
    setShowNewDeck(false);
  }

  async function handleUpdateDeck() {
    if (!editingDeck || !editingDeck.name.trim()) return;
    await onSaveDeck(editingDeck);
    setEditingDeck(null);
  }

  async function handleDeleteDeck(deckId: string) {
    if (window.confirm('Delete this deck and all its cards? This cannot be undone.')) {
      await onDeleteDeck(deckId);
      if (expandedDeck === deckId) setExpandedDeck(null);
    }
  }

  async function handleExportDeck(deck: Deck) {
    const list = cards.filter(c => c.deckId === deck.id);
    const blob = new Blob([JSON.stringify({ deck, cards: list }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Render -----------------------------------------------------------------

  const sectionTitle = decks.length === 0
    ? <>Begin with a <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>single deck</span>.</>
    : (
      <>
        {decks.length === 1 ? 'One deck' : `${decks.length} decks`}.{' '}
        <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>
          {totalDue === 0 ? 'Nothing' : numberFmt(totalDue)} due
        </span>{' '}
        across them.
      </>
    );
  const sectionSub = decks.length === 0
    ? 'Create a deck to start collecting cards. Cards appear inside your social feeds, every few posts.'
    : `${pluralize(cards.length, 'total card')}. Pick one to make active, or let the scheduler choose what is most overdue.`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 48 }}>
      {/* LEFT — header + table + expanded */}
      <div>
        <EditorialHeader
          kicker="02 · Decks"
          title={sectionTitle}
          sub={sectionSub}
          action={
            <button onClick={() => setShowNewDeck(true)} className="btn btn-clay" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New deck
            </button>
          }
        />

        {/* Inline create form */}
        {showNewDeck && (
          <div className="card-flat" style={{ padding: 24, marginBottom: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>New deck</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <input
                type="text"
                className="input-editorial"
                value={newDeckName}
                onChange={e => setNewDeckName(e.target.value)}
                placeholder="Deck name (e.g., Spanish, Volume I)"
                autoFocus
              />
              <input
                type="text"
                className="input-editorial"
                value={newDeckDescription}
                onChange={e => setNewDeckDescription(e.target.value)}
                placeholder="Description (optional)"
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCreateDeck} className="btn btn-clay" type="button">Create deck</button>
                <button onClick={() => setShowNewDeck(false)} className="btn btn-ghost" type="button">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {decks.length === 0 ? (
          <div className="card-flat" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>No decks yet</div>
            <div className="display" style={{ fontSize: 26, marginBottom: 8 }}>
              Quiet shelves.
            </div>
            <p style={{ color: 'var(--ink-3)', fontSize: 14, margin: '0 0 20px' }}>
              Create your first deck to start learning.
            </p>
            <button onClick={() => setShowNewDeck(true)} className="btn btn-clay" type="button">
              + New deck
            </button>
          </div>
        ) : (
          <>
            {/* DECK TABLE — editorial */}
            <table className="dtable">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>№</th>
                  <th>Deck</th>
                  <th style={{ width: 110 }}>Cards</th>
                  <th style={{ width: 110 }}>Due</th>
                  <th style={{ width: 200 }}>Retention</th>
                  <th style={{ width: 90, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {decks.map((deck, i) => {
                  const agg = perDeck.get(deck.id)!;
                  const isOpen = expandedDeck === deck.id;
                  const isActive = activeDeckId === deck.id;
                  return (
                    <tr key={deck.id}>
                      <td className="mono" style={{ color: 'var(--ink-4)' }}>{String(i + 1).padStart(2, '0')}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                          <span className="serif" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                            {deck.name}
                          </span>
                          {isActive && <span className="pill pill-ink">active</span>}
                        </div>
                        {deck.description && (
                          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>
                            {deck.description}
                          </div>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
                        {numberFmt(agg.total)}
                      </td>
                      <td>
                        {agg.due > 0 ? (
                          <span className="serif" style={{ fontSize: 18, color: 'var(--clay-deep)', fontWeight: 600 }}>
                            {numberFmt(agg.due)}
                          </span>
                        ) : (
                          <span className="mono" style={{ color: 'var(--ink-4)', fontSize: 12 }}>— none</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="bar" style={{ flex: 1 }}>
                            <i style={{
                              width: `${Math.round(agg.retention * 100)}%`,
                              background: agg.retention > 0.85 ? 'var(--moss)' : agg.retention > 0.75 ? 'var(--clay)' : 'var(--gold)',
                            }} />
                          </div>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                            {Math.round(agg.retention * 100)}%
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedDeck(isOpen ? null : deck.id);
                            setCardFilter('');
                          }}
                          className={isOpen ? 'btn btn-dark' : 'btn btn-ghost'}
                          style={{ padding: '6px 14px', fontSize: 12, gap: 6 }}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? `Close ${deck.name}` : `Open ${deck.name}`}
                        >
                          {isOpen ? 'Close' : 'Open'}
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease' }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* EXPANDED PANEL — current deck */}
            {expandedDeck && (() => {
              const deck = decks.find(d => d.id === expandedDeck);
              const agg = perDeck.get(expandedDeck);
              if (!deck || !agg) return null;
              const maxKind = Math.max(...Object.values(agg.kinds), 1);
              const maxForecast = Math.max(...agg.forecast, 1);
              return (
                <div style={{ marginTop: 48 }}>
                  <div className="eyebrow">02·A {deck.name.toUpperCase()} — expanded</div>
                  <div className="card-flat" style={{ marginTop: 14, padding: '28px 32px' }}>
                    {/* 4-stat strip */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr 1fr',
                      borderTop: '1px solid var(--rule)',
                      borderBottom: '1px solid var(--rule)',
                    }}>
                      {([
                        ['Cards',   numberFmt(agg.total)],
                        ['Due now', numberFmt(agg.due)],
                        ['New',     numberFmt(agg.newCount)],
                        ['Avg ease', agg.avgEase.toFixed(1)],
                      ] as const).map(([k, v], j) => (
                        <div key={k} style={{
                          padding: '18px 20px',
                          borderRight: j < 3 ? '1px solid var(--rule)' : 'none',
                        }}>
                          <div className="eyebrow">{k}</div>
                          <div className="display" style={{ fontSize: 38, marginTop: 6 }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Card mix + 14-day forecast */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 28 }}>
                      <div>
                        <div className="eyebrow">Card mix</div>
                        <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                          {(['text', 'mcq-single', 'mcq-multi', 'cloze', 'audio'] as const).map(kind => {
                            const n = agg.kinds[kind] ?? 0;
                            const w = (n / maxKind) * 100;
                            return (
                              <div key={kind} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 32px', gap: 10, alignItems: 'center' }}>
                                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                                  {kind === 'mcq-single' ? 'mcq-1' : kind === 'mcq-multi' ? 'mcq-n' : kind}
                                </span>
                                <div className="bar" style={{ height: 10 }}>
                                  <i style={{ width: `${w}%`, background: 'var(--ink)' }} />
                                </div>
                                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)', textAlign: 'right' }}>
                                  {numberFmt(n)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="eyebrow">14-day forecast</div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56, marginTop: 14 }}>
                          {agg.forecast.map((h, idx) => (
                            <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                              <div style={{
                                height: `${(h / maxForecast) * 100}%`,
                                minHeight: h > 0 ? 2 : 0,
                                background: idx === 0 ? 'var(--clay)' : 'var(--ink)',
                                borderRadius: '2px 2px 0 0',
                              }} />
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>TODAY</span>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>+14d</span>
                        </div>
                      </div>
                    </div>

                    {/* Action bar */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 28 }}>
                      <button
                        type="button"
                        onClick={() => { setEditingCard(null); setShowNewCard(true); }}
                        className="btn btn-clay"
                        style={{ padding: '6px 14px', fontSize: 12 }}
                      >
                        + Add card
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!onSetActiveDeck) return;
                          await onSetActiveDeck(activeDeckId === deck.id ? null : deck.id);
                        }}
                        className="btn btn-ghost"
                        style={{ padding: '6px 14px', fontSize: 12 }}
                      >
                        {activeDeckId === deck.id ? 'Clear active' : 'Set active'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingDeck(deck)}
                        className="btn btn-ghost"
                        style={{ padding: '6px 14px', fontSize: 12 }}
                      >
                        Edit deck
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportDeck(deck)}
                        className="btn btn-ghost"
                        style={{ padding: '6px 14px', fontSize: 12 }}
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDeck(deck.id)}
                        className="btn"
                        style={{
                          padding: '6px 14px',
                          fontSize: 12,
                          background: 'transparent',
                          color: 'var(--rose)',
                          border: '1px solid var(--rose)',
                        }}
                      >
                        Delete deck
                      </button>
                    </div>

                    {/* All cards */}
                    {(() => {
                      const q = cardFilter.trim().toLowerCase();
                      const filtered = q
                        ? agg.cardList.filter(c => {
                            const front = (c.front ?? '').toLowerCase();
                            const back = Array.isArray(c.back) ? c.back.join(', ').toLowerCase() : (c.back ?? '').toLowerCase();
                            return front.includes(q) || back.includes(q);
                          })
                        : agg.cardList;
                      return (
                        <div style={{ marginTop: 30 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div className="eyebrow">
                              All cards · {numberFmt(filtered.length)}{q ? ` of ${numberFmt(agg.cardList.length)}` : ''}
                            </div>
                            {agg.cardList.length > 0 && (
                              <input
                                type="text"
                                className="input-editorial"
                                value={cardFilter}
                                onChange={e => setCardFilter(e.target.value)}
                                placeholder="Filter cards..."
                                style={{ maxWidth: 240, fontSize: 13, padding: '6px 10px' }}
                              />
                            )}
                          </div>
                          <table className="dtable" style={{ marginTop: 10 }}>
                            <thead>
                              <tr>
                                <th style={{ width: 90 }}>Type</th>
                                <th>Front</th>
                                <th>Back</th>
                                <th style={{ width: 90 }}>Due</th>
                                <th style={{ width: 60 }}>Ease</th>
                                <th style={{ width: 80, textAlign: 'right' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {showNewCard && (
                                <tr>
                                  <td colSpan={6}>
                                    <CardEditor
                                      deckId={deck.id}
                                      onSave={async (card) => {
                                        await onSaveCard(card);
                                        setShowNewCard(false);
                                      }}
                                      onCancel={() => setShowNewCard(false)}
                                    />
                                  </td>
                                </tr>
                              )}
                              {filtered.length === 0 && !showNewCard && (
                                <tr>
                                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '24px 0' }}>
                                    {q ? `No cards match "${cardFilter}".` : 'No cards in this deck yet.'}
                                  </td>
                                </tr>
                              )}
                              {filtered.map(card => {
                            const due = formatDueDelta(card.due);
                            return (
                              <tr key={card.id} id={`card-row-${card.id}`}>
                                {editingCard?.id === card.id ? (
                                  <td colSpan={6}>
                                    <CardEditor
                                      card={card}
                                      deckId={deck.id}
                                      onSave={async (updated) => {
                                        await onSaveCard(updated);
                                        setEditingCard(null);
                                      }}
                                      onCancel={() => setEditingCard(null)}
                                    />
                                  </td>
                                ) : (
                                  <>
                                    <td>
                                      <span className="pill">{shortKind(card.kind)}</span>
                                    </td>
                                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {card.front}
                                    </td>
                                    <td className="serif" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {Array.isArray(card.back) ? card.back.join(', ') : card.back}
                                    </td>
                                    <td className="mono" style={{ color: due.tone === 'now' ? 'var(--clay-deep)' : 'var(--ink-2)' }}>
                                      {due.label}
                                    </td>
                                    <td className="mono">{(card.ease ?? 2.5).toFixed(1)}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <button
                                        type="button"
                                        onClick={() => setEditingCard(card)}
                                        className="ulink"
                                        style={{ background: 'none', padding: 0, fontSize: 12, marginRight: 12, cursor: 'pointer' }}
                                      >
                                        edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (window.confirm('Delete this card?')) onDeleteCard(card.id);
                                        }}
                                        className="ulink"
                                        style={{ background: 'none', padding: 0, fontSize: 12, color: 'var(--rose)', borderBottomColor: 'var(--rose)', cursor: 'pointer' }}
                                      >
                                        delete
                                      </button>
                                    </td>
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* RIGHT RAIL */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Today */}
        <div>
          <div className="eyebrow">A · Today</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            <div className="display" style={{ fontSize: 64, lineHeight: .95 }}>
              {numberFmt(totalDue)}
            </div>
            <div className="serif" style={{ fontSize: 16, color: 'var(--ink-2)', marginTop: 6 }}>
              {totalDue === 1 ? 'card due across all decks' : 'cards due across all decks'}
            </div>
            {reviewedToday !== null && (
              <>
                <hr className="rule-thin" style={{ margin: '18px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: 'var(--ink-3)' }}>Reviewed today</span>
                  <span className="mono">{numberFmt(reviewedToday)}</span>
                </div>
                {totalDue > 0 && (
                  <div className="bar">
                    <i style={{ width: `${Math.min(100, Math.round((reviewedToday / Math.max(1, totalDue + reviewedToday)) * 100))}%` }} />
                  </div>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => onBeginStudy?.()}
              className="btn btn-clay"
              style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}
            >
              Begin a session →
            </button>
          </div>
        </div>

        {/* Active deck */}
        <div>
          <div className="eyebrow">B · Active deck</div>
          <div className="card-flat" style={{ padding: 18, marginTop: 12 }}>
            {activeDeck ? (
              <>
                <div className="serif" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                  {activeDeck.name}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                  Manually selected · priority for the next session
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                  {activeAgg && activeAgg.due > 0 && <span className="pill pill-clay">{activeAgg.due} due</span>}
                  {activeAgg && <span className="pill">{numberFmt(activeAgg.total)} cards</span>}
                </div>
              </>
            ) : (
              <>
                <div className="serif" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-2)' }}>
                  Auto-select
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                  Most overdue deck is chosen for you
                </div>
              </>
            )}
          </div>
        </div>

        {/* Streak */}
        <div>
          <div className="eyebrow">C · Streak</div>
          <div className="card-flat" style={{ padding: 18, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div className="display" style={{ fontSize: 42 }}>
                {numberFmt(stats?.currentStreak ?? 0)}
              </div>
              <div className="serif" style={{ fontSize: 14, color: 'var(--ink-3)' }}>
                {(stats?.currentStreak ?? 0) === 1 ? 'day in a row' : 'days in a row'}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 3, marginTop: 12 }}>
              {streakDays.map((d, i) => (
                <div
                  key={i}
                  title={d.reviews > 0 ? `${d.reviews} reviews` : 'no reviews'}
                  style={{
                    aspectRatio: '1',
                    background: d.reviews >= 20 ? 'var(--clay)'
                      : d.reviews >= 10 ? '#D88660'
                      : d.reviews >= 1 ? 'var(--clay-tint)'
                      : 'var(--rule)',
                    borderRadius: 2,
                    outline: d.isToday ? '1.5px solid var(--ink)' : 'none',
                    outlineOffset: -1,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Edit deck modal */}
      {editingDeck && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(31, 27, 22, 0.55)',
            backdropFilter: 'blur(2px)',
          }}
          onClick={() => setEditingDeck(null)}
        >
          <div
            className="card-flat"
            style={{ width: '100%', maxWidth: 460, margin: '0 16px', padding: 28 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="eyebrow" style={{ marginBottom: 14 }}>Edit deck</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <input
                type="text"
                className="input-editorial"
                value={editingDeck.name}
                onChange={e => setEditingDeck({ ...editingDeck, name: e.target.value })}
                placeholder="Deck name"
              />
              <input
                type="text"
                className="input-editorial"
                value={editingDeck.description}
                onChange={e => setEditingDeck({ ...editingDeck, description: e.target.value })}
                placeholder="Description"
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleUpdateDeck} className="btn btn-clay" type="button">Save changes</button>
                <button onClick={() => setEditingDeck(null)} className="btn btn-ghost" type="button">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
