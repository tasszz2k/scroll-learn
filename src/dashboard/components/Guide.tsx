import type { ReactNode } from 'react';
import EditorialHeader from './EditorialHeader';

function SectionHead({ num, label }: { num: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{num}</span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

function Section({ num, label, children }: { num: string; label: string; children: ReactNode }) {
  return (
    <section style={{ padding: '28px 0', borderBottom: '1px solid var(--rule)' }}>
      <SectionHead num={num} label={label} />
      {children}
    </section>
  );
}

function H({ children }: { children: ReactNode }) {
  return (
    <h3 className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, margin: '0 0 12px' }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: '0 0 12px', color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.6, maxWidth: 720 }}>
      {children}
    </p>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        fontSize: 12,
        background: 'var(--card)',
        border: '1px solid var(--rule-2)',
        borderBottom: '2px solid var(--rule-2)',
        borderRadius: 4,
        color: 'var(--ink)',
        margin: '0 1px',
      }}
    >
      {children}
    </span>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code
      className="mono"
      style={{
        background: 'var(--paper-2)',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 13,
        color: 'var(--ink)',
      }}
    >
      {children}
    </code>
  );
}

function Pre({ children }: { children: ReactNode }) {
  return (
    <pre
      className="mono"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--rule)',
        padding: '14px 16px',
        borderRadius: 6,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: 'var(--ink-2)',
        overflowX: 'auto',
        margin: '8px 0 16px',
        maxWidth: 720,
      }}
    >
      {children}
    </pre>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li style={{ margin: '0 0 8px', color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.55 }}>
      {children}
    </li>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul style={{ margin: '4px 0 12px 22px', paddingLeft: 0, maxWidth: 720 }}>
      {children}
    </ul>
  );
}

export default function Guide() {
  return (
    <div>
      <EditorialHeader
        kicker="Guide"
        title={<>Everything ScrollLearn does.</>}
        sub="Quizzes in your feed, notebooks, bookmarks (pluck mode), decks, importing, scheduling, blocking. One page; skim or read end to end."
      />

      <Section num="01" label="The idea">
        <H>Turn idle scrolling into review time.</H>
        <P>
          ScrollLearn injects spaced-repetition flashcards into Facebook, YouTube, and Instagram. Every few posts you scroll, a card appears. Answer it; the feed continues. Cards you struggle with come back sooner; cards you know recede.
        </P>
        <P>
          Outside of feeds, ScrollLearn also lets you <strong>pluck</strong> text from any allowlisted site straight into the Bookmarks tab while you read, and gives you a separate <strong>Notebooks</strong> surface for long-form, manually authored markdown notes.
        </P>
      </Section>

      <Section num="02" label="Quizzes in your feed">
        <H>How the injection works.</H>
        <List>
          <Bullet>A card appears after every <em>N</em> posts (default 5; tunable in Settings).</Bullet>
          <Bullet>After answering, you can configure a quiet pause before the next card fires.</Bullet>
          <Bullet>Per-site toggle: open the popup on a feed site to enable or pause it just for that domain.</Bullet>
          <Bullet>The card pulled is whatever is most overdue in your active deck (or globally if no active deck is set).</Bullet>
        </List>
        <P>
          The popup shows a green dot when injection is active for the current tab and a red dot when it's paused.
        </P>
      </Section>

      <Section num="03" label="Cards & decks">
        <H>Five card types, all hand-graded.</H>
        <List>
          <Bullet><strong>Text</strong> — free-form answer with fuzzy matching (Levenshtein / Jaro-Winkler). Wrong answers trigger retry-to-practice.</Bullet>
          <Bullet><strong>MCQ single</strong> — pick one option. Options shuffle each time the card is shown so you don't memorize positions.</Bullet>
          <Bullet><strong>MCQ multi</strong> — pick all that apply. Also shuffled.</Bullet>
          <Bullet><strong>Cloze</strong> — fill the blank. Use <Code>{'{{answer}}'}</Code> in the prompt; wrong answers retry.</Bullet>
          <Bullet><strong>Audio</strong> — listen, then type what you heard. Wrong answers retry.</Bullet>
        </List>
        <H>Retry-to-practice mode.</H>
        <P>
          When you miss a text/cloze/audio card, the miss is recorded for scheduling, and then the input re-opens with "Type the correct answer to continue...". Wrong attempts show an inline character-level diff (red strikethrough vs. green target). You can't move on until you type it correctly. MCQs skip retry — selecting the right option after seeing it isn't real practice.
        </P>
      </Section>

      <Section num="04" label="Importing">
        <H>Three formats: Simple, CSV, JSON.</H>
        <P>
          Open the Import tab, paste, choose a deck (or create one), preview, import. Batches of 100 cards at a time. Use the <strong>Prompt Generator</strong> to draft a Claude/ChatGPT/Gemini prompt that emits cards in the format you want.
        </P>
        <H>Simple format</H>
        <P>One question per line, separated from the answer by a tab or pipe.</P>
        <Pre>{`What is 2 + 2? | 4
Capital of France? | Paris`}</Pre>
        <H>CSV</H>
        <P>Headers: <Code>type</Code>, <Code>question</Code>, <Code>answer</Code>, <Code>options</Code> (for MCQ, semicolon-delimited), <Code>tags</Code>.</P>
        <H>JSON</H>
        <P>Array of card objects. The exporter (Decks tab) emits this format too — round-trip safe.</P>
      </Section>

      <Section num="05" label="Studying & the scheduler">
        <H>SM-2, with a softer failure mode.</H>
        <P>
          Cards are graded on a 0–3 scale: <Kbd>Again</Kbd>, <Kbd>Hard</Kbd>, <Kbd>Good</Kbd>, <Kbd>Easy</Kbd>. Ease factor floats between 1.3 and 3.5; intervals cap at 365 days.
        </P>
        <P>
          Failed cards (Again) reschedule to <strong>10 minutes</strong>, not the next day — they come back inside the same session so you actually re-encounter them.
        </P>
        <H>Where to study</H>
        <List>
          <Bullet>Click <strong>Begin study</strong> in the dashboard, or <strong>Study now</strong> in the popup, for a focused session.</Bullet>
          <Bullet>Or just keep scrolling — feed injection covers your due cards automatically.</Bullet>
        </List>
      </Section>

      <Section num="06" label="Bookmarks capture (pluck mode)">
        <H>Hold <Kbd>Option</Kbd> / <Kbd>Alt</Kbd> and pluck.</H>
        <P>
          On any allowlisted site, hold the modifier and hover. Whatever you point at gets a green outline as a preview. Nothing is saved yet.
        </P>
        <List>
          <Bullet><strong>Click</strong> while held — captures that element's text immediately.</Bullet>
          <Bullet><strong>Release</strong> the modifier — captures whatever is currently outlined.</Bullet>
          <Bullet><strong>Drag-select</strong> while held — captures only the selected words instead of the surrounding element.</Bullet>
          <Bullet><strong>Esc</strong> — cancels the in-progress pluck without saving.</Bullet>
          <Bullet>Tab-switching mid-hold cancels too (no accidental capture from focus loss).</Bullet>
        </List>
        <P>
          Saved text is also staged on your system clipboard so you can paste it elsewhere without an extra <Kbd>Ctrl</Kbd>+<Kbd>C</Kbd>. A green toast confirms the save and shows a 120-character preview plus the auto-translation if one is configured.
        </P>
        <P>
          Manage which sites pluck mode runs on under <strong>Settings → Note capture allowlist</strong>. Plain hostnames like <Code>en.wikipedia.org</Code> work; regex entries like <Code>/^.*\.zim\.vn$/</Code> work too. The popup's per-site toggle only flips plain hostnames — regex-allowlisted sites must be edited in Settings.
        </P>
      </Section>

      <Section num="06b" label="Notebooks (manual authoring)">
        <H>Bookmarks vs. Notebooks.</H>
        <P>
          <strong>Bookmarks</strong> (<Code>#notes</Code>) is the web-capture buffer described above — short, plucked snippets from sites you read. <strong>Notebooks</strong> (<Code>#notebooks</Code>) is the opposite: long-form markdown documents you write yourself, organised into folders, with autosave, full-text search, and AI assistance.
        </P>
        <H>What's in a notebook.</H>
        <List>
          <Bullet>Title + folder path + tags + freeform key/value properties (Obsidian-style front-matter).</Bullet>
          <Bullet>A markdown body with toolbar buttons, keyboard shortcuts (<Kbd>Cmd</Kbd>+<Kbd>B</Kbd>, <Kbd>Cmd</Kbd>+<Kbd>K</Kbd>, etc.), and a <Code>/</Code> slash menu for headings, lists, tables, code blocks, and AI commands.</Bullet>
          <Bullet>Pasted or dragged images become embedded attachments served from a local IndexedDB blob store.</Bullet>
          <Bullet>Edit / Preview / Live toggles — the preview is rendered with <Code>marked</Code> + DOMPurify (sanitised) and is independent of the in-feed quiz markdown.</Bullet>
        </List>
        <H>Search, export, AI.</H>
        <List>
          <Bullet><Kbd>Cmd</Kbd>+<Kbd>P</Kbd> opens a quick-open over titles and tags; <Kbd>Cmd</Kbd>+<Kbd>Shift</Kbd>+<Kbd>F</Kbd> runs a full-text scan across every notebook body.</Bullet>
          <Bullet>Per-notebook <Code>.md</Code> export (with YAML front-matter for properties) or whole-tree <Code>.zip</Code> export that mirrors your folder layout.</Bullet>
          <Bullet>The AI panel ("AI" toggle next to Edit/Preview) reuses the same Gemini plumbing as Explain/Ask: <strong>Summarize</strong>, free-form <strong>Ask</strong>, and <strong>Generate quiz</strong> (which routes a CSV deck into the Import tab).</Bullet>
          <Bullet>Five starter templates from the new-notebook picker: Blank, Daily learning log, Concept note, Book/article note, Lecture/talk note.</Bullet>
        </List>
        <P>
          Bodies and image blobs live in IndexedDB so very long notes don't swamp <Code>chrome.storage</Code>; only the metadata (title, tags, folderPath, properties, timestamps) is mirrored to <Code>chrome.storage.local</Code>, which is what powers the live-sync between the dashboard and the side panel.
        </P>
      </Section>

      <Section num="07" label="Content blocking">
        <H>Hide what's worst, keep what's left.</H>
        <P>
          Per-platform toggles in the popup hide common feed parasites:
        </P>
        <List>
          <Bullet><strong>Facebook</strong> — Reels, Sponsored, Suggested, Strangers' posts.</Bullet>
          <Bullet><strong>Instagram</strong> — Reels, Sponsored, Suggested, Strangers.</Bullet>
          <Bullet><strong>YouTube</strong> — Shorts.</Bullet>
        </List>
        <P>
          The popup tracks how many of each were hidden in the current tab. Hover the running total for a per-category breakdown.
        </P>
      </Section>

      <Section num="08" label="Settings">
        <H>What you can tune.</H>
        <List>
          <Bullet><strong>Show after N posts</strong> — frequency of feed quizzes.</Bullet>
          <Bullet><strong>Pause after quiz</strong> — minutes of quiet between cards.</Bullet>
          <Bullet><strong>Active deck</strong> — restrict cards to one deck, or leave on auto-select.</Bullet>
          <Bullet><strong>Note allowlist</strong> — which sites pluck mode is armed on.</Bullet>
          <Bullet><strong>Note minimum length</strong> — drop captures below this many characters.</Bullet>
          <Bullet><strong>Toast duration</strong> — 1–30 seconds for the save confirmation.</Bullet>
          <Bullet><strong>Translation direction</strong> — auto-translate captured bookmarks (e.g. EN → VI).</Bullet>
          <Bullet><strong>Per-platform block toggles</strong> — Reels, Shorts, Sponsored, Suggested, Strangers.</Bullet>
          <Bullet><strong>Theme</strong> — light or dark; remembered across sessions.</Bullet>
        </List>
      </Section>

      <Section num="09" label="Stats">
        <H>What's tracked.</H>
        <List>
          <Bullet><strong>Cards due</strong> — overdue right now, headlining the popup.</Bullet>
          <Bullet><strong>Day streak</strong> — consecutive days you've answered at least one card.</Bullet>
          <Bullet><strong>Total reviews</strong> — every grade you've given, all-time.</Bullet>
          <Bullet><strong>Average accuracy</strong> — share graded Good or Easy.</Bullet>
          <Bullet><strong>Per-deck breakdowns</strong> — counts and due cards per deck (Stats tab).</Bullet>
        </List>
      </Section>

      <Section num="10" label="AI assist (Explain &amp; Ask)">
        <H>A tutor next to every card and note.</H>
        <P>
          Each card in study mode and each bookmark in the Bookmarks tab carries an <strong>Explain</strong> and an <strong>Ask</strong> button. Click either to fire a tutor-style prompt at Gemini in the background — the response streams back into a chat-style panel underneath, with bold, bullets, and paragraph breaks preserved from Gemini's output. The Notebooks tab has its own AI menu with Summarize / Ask / Generate quiz running on the same plumbing.
        </P>
        <List>
          <Bullet><strong>Explain</strong> — runs a pre-written prompt that summarises meaning, examples, word family, and common pitfalls (or, for grammar cards, the rule plus contrasts).</Bullet>
          <Bullet><strong>Ask</strong> — type a free-form follow-up question scoped to the card or note. The captured text is automatically included as context.</Bullet>
          <Bullet><strong>Conversation history</strong> — every Q&amp;A you fire on the same subject stays in the panel as a back-and-forth thread. The Gemini tab is reused so the model also has the chat history, not just our prompt.</Bullet>
          <Bullet><strong>Always-on composer</strong> — once a panel is open the input bar stays visible. <Kbd>Enter</Kbd> sends, <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> inserts a newline, and Send unlocks as soon as the previous response settles.</Bullet>
          <Bullet><strong>Copy</strong> — grabs the entire conversation (all turns) so you can paste it into a card's Back details or your notes.</Bullet>
          <Bullet><strong>Close</strong> — ends the conversation and shuts the background Gemini window. The next click on Explain or Ask starts a fresh chat.</Bullet>
        </List>
        <P>
          Only one AI assist job runs at a time across the whole dashboard. If you click Explain on one card while another is still streaming, the second click is held until the first one finishes — a small "AI busy elsewhere" hint shows on the inactive surface.
        </P>
        <P>
          Requires a signed-in Gemini account (<Code>gemini.google.com</Code>). Nothing is sent to a ScrollLearn server; the prompt and response live entirely between your browser and Gemini.
        </P>
      </Section>

      <Section num="11" label="Shadowing (speaking practice)">
        <H>Train production with the Shadow tab.</H>
        <P>
          The Shadow tab teaches the speaking leg of language learning. The flow has two halves: an <strong>IPA foundation</strong> (a 44-phoneme primer with a minimal-pair listening drill) and a <strong>shadowing player</strong> that turns target words into a short two-speaker dialogue you play back, repeat, and imitate at native pace.
        </P>
        <List>
          <Bullet><strong>Foundation</strong> — click any IPA cell to hear an example word; run the minimal-pair drill to lock down contrasts your ear keeps mixing up. Your weakest sounds are tracked and surfaced as practice targets.</Bullet>
          <Bullet><strong>Practice</strong> — type or pull words from Bookmarks, set CEFR level / speaker count / duration, and Generate. Gemini returns a structured dialogue annotated with the IPA-tricky phonemes per line.</Bullet>
          <Bullet><strong>Player</strong> — four stages (Listen / Slow shadow / Full shadow / Blind shadow) with karaoke-style word highlighting, click-to-jump, repeat-line, and a rate slider.</Bullet>
        </List>
        <P>
          Direct links: <Code>#shadow:foundation</Code> opens the IPA primer + drill; <Code>#shadow:practice</Code> opens the composer + saved scripts + player.
        </P>
        <H>Voice engines.</H>
        <P>
          The player picks audio from one of three engines, all driven by direct API calls (no hidden browser tabs):
        </P>
        <List>
          <Bullet><strong>ElevenLabs (API key)</strong> — best quality, locked to the half-priced Flash v2.5 model so the free tier's monthly credits cover roughly 20,000 characters of audio. Calls <Code>api.elevenlabs.io</Code> directly; requires a free API key.</Bullet>
          <Bullet><strong>Kokoro TTS (API key)</strong> — free, decent quality, 50+ voices auto-assigned at random per speaker so each character has a distinct sound. Calls the public <Code>hexgrad/Kokoro-TTS</Code> HuggingFace Space via its Gradio queue API; requires a free Hugging Face access token. Public Space is shared, so requests may queue under load.</Bullet>
          <Bullet><strong>Web Speech</strong> — your browser's built-in voices. Always-on fallback. Free, instant, robotic. Used automatically when the cloud engines aren't connected.</Bullet>
        </List>
        <P>
          Generated audio is cached locally in IndexedDB (per <Code>provider × voice × text</Code> tuple), so replaying a saved script never re-spends credits or re-queues the Space. Cache eviction kicks in past 100 MB.
        </P>
        <H>Setting up the cloud engines.</H>
        <P>
          Both cloud engines need a free token pasted into Settings → <strong>B · Quiz behaviour</strong>. Settings auto-save when each field loses focus.
        </P>
        <List>
          <Bullet><strong>ElevenLabs:</strong> open <Code>elevenlabs.io/app/settings/api-keys</Code>, click <strong>Create API key</strong>, copy the <Code>sk_…</Code> value, and paste it into <strong>ElevenLabs API key</strong>.</Bullet>
          <Bullet><strong>Kokoro TTS:</strong> open <Code>huggingface.co/settings/tokens</Code> (sign in or sign up — both are free), click <strong>+ Create new token</strong>, choose type <strong>Read</strong>, copy the <Code>hf_…</Code> value, and paste it into <strong>Kokoro API token</strong>.</Bullet>
          <Bullet>In the Shadow player, click the engine pill to switch. The "isn't connected yet" banner disappears once the matching token is set; if it lingers, click another engine and back — that re-runs the readiness check.</Bullet>
        </List>
        <P>
          <strong>Quotas:</strong> ElevenLabs free keys ship with about 10k monthly credits (≈20k characters on Flash v2.5). Kokoro shares the Space's daily ZeroGPU pool — about 4 GPU-minutes/day on the free tier (roughly 80–240 fresh line generations, depending on length). Cached audio replays cost zero on either engine. Tokens are stored locally in <Code>chrome.storage.local</Code> — never sent anywhere except their respective providers.
        </P>
      </Section>

      <Section num="12" label="Updates">
        <H>One-click in-place upgrade.</H>
        <P>
          When a new release is published, a banner appears at the top of the dashboard. Click <strong>Update now</strong> and a local helper downloads, unpacks, and reloads the extension automatically — no <Code>chrome://extensions</Code> trip needed.
        </P>
        <P>
          The helper is a one-time install (<Code>scripts/updater/install.sh</Code>). Without it, the button reports "Native helper not installed." Already-open social tabs keep running the previous content-script code until you refresh those tabs.
        </P>
      </Section>

      <div style={{ padding: '32px 0 8px', color: 'var(--ink-3)', fontSize: 13 }}>
        Found a rough edge? Open an issue on the project repo. The whole extension is offline-first; no telemetry, no accounts.
      </div>
    </div>
  );
}
