// With the Facebook top bar hidden there is no way back from the chats, so
// focus mode puts a small Facebook button before the "Chats" heading. React
// re-renders the list header freely, so the link is re-attached on every
// sync. If the heading cannot be found it floats at the top left instead.

const ID = 'sl-msgr-back';
const FLOATING = 'sl-msgr-back-floating';
const FB_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1z"/></svg>';

function createLink(): HTMLAnchorElement {
  const link = document.createElement('a');
  link.id = ID;
  link.href = 'https://www.facebook.com/';
  link.title = 'Back to Facebook';
  link.setAttribute('aria-label', 'Back to Facebook');
  link.innerHTML = FB_ICON;
  return link;
}

function chatsHeading(): HTMLElement | null {
  // Not by text: Facebook translates "Chats".
  return document.querySelector<HTMLElement>('[role="navigation"] h1');
}

export function syncBackLink() {
  const link = document.getElementById(ID) ?? createLink();
  const heading = chatsHeading();
  if (heading?.parentElement) {
    link.classList.remove(FLOATING);
    if (link.nextElementSibling !== heading) heading.parentElement.insertBefore(link, heading);
    return;
  }
  link.classList.add(FLOATING);
  if (link.parentElement !== document.body) document.body?.append(link);
}

export function removeBackLink() {
  document.getElementById(ID)?.remove();
}
