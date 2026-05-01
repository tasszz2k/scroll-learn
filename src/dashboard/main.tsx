import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ConfirmProvider } from './components/ConfirmProvider';
import { mountPluckMode } from '../common/pluckMode';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>
);

// Hold-Option/Alt-and-hover capture works on regular allowlisted sites via
// the content script (src/content/notes.ts). Chrome refuses to inject
// content scripts into chrome-extension:// URLs, so we mount the same flow
// inline from the dashboard to give the user the same affordance on every
// dashboard tab (Notebooks, Bookmarks, Decks, ...). No allowlist gate here:
// the user is already on our own page. The sidebar FAB is suppressed
// because the dashboard already surfaces those affordances natively.
mountPluckMode({ fab: false });

