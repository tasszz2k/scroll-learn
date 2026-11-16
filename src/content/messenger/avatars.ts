// People's pictures drawn as a monochrome folder icon and tagged with
// data-fmess-avatar, for the text-only CLI theme (which then hides them). Adapted from fMess 04-privacy.js "hide profile pictures" (MIT,
// https://github.com/toanbku/fmess), which draws coloured initials instead.
//
// A person's picture in the chat list, the chat header, beside messages and
// in the details becomes a folder icon; one whose owner can't be told (the
// small "seen" pictures) a grey dot. Pictures in those places are hidden
// until they have been looked at, so a photo never flashes in; pictures that
// aren't people's (photos, GIFs, stickers, emoji) are let through untouched.

const AVATAR = 'data-fmess-avatar';
const ORIGINAL_HREF = 'data-fmess-href';
export const AVATAR_PLACES =
  ':is([role="navigation"] [role="row"], [data-fmess-ui="chat-header"], [role="log"], [data-fmess-ui="details"])';
const PICTURES = `${AVATAR_PLACES} :is(img:not([src*="emoji.php"]), svg image):not([${AVATAR}])`;

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
// An outline folder, as in a file sidebar. It stays inside the circle that
// Facebook masks its pictures with (every corner is < 20 from the centre).
const PERSON_ICON = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>" +
    "<path d='M7 13.5a2.5 2.5 0 0 1 2.5-2.5h6.8l3.2 3.2h11a2.5 2.5 0 0 1 2.5 2.5v10.8a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 7 27.5z' " +
    "fill='none' stroke='#5f5f5f' stroke-width='2.4' stroke-linejoin='round'/></svg>",
);
const DOT_ICON = svgUrl("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='#c8c8c8'/></svg>");

type PictureKind = 'person' | 'dot' | 'none';

// What a picture is, from where it is and its size; undefined while it is not
// laid out yet (it is looked at again on the next pass).
function pictureKind(picture: Element): PictureKind | undefined {
  const box = picture.getBoundingClientRect();
  if (!box.width) return undefined;
  if (Math.abs(box.width - box.height) > 2 || box.width > 100) return 'none';
  if (picture.closest('[role="navigation"] [role="row"]') || picture.closest('[data-fmess-ui="chat-header"]')) return 'person';
  if (picture.closest('[role="log"]')) return box.width > 40 ? 'none' : box.width > 20 ? 'person' : 'dot';
  // The details pane also lists shared photos; people's pictures there are
  // Facebook's masked SVG circles, photos are plain <img>.
  return picture.tagName.toLowerCase() === 'image' ? 'person' : 'none';
}

function cover(picture: Element) {
  const kind = pictureKind(picture);
  if (kind === undefined) return;
  if (kind === 'none') {
    picture.setAttribute(AVATAR, 'none');
    return;
  }
  const url = kind === 'person' ? PERSON_ICON : DOT_ICON;
  if (picture instanceof HTMLImageElement) {
    picture.style.setProperty('content', `url("${url}")`, 'important');
  } else {
    if (!picture.hasAttribute(ORIGINAL_HREF)) {
      picture.setAttribute(ORIGINAL_HREF, picture.getAttribute('href') ?? picture.getAttribute('xlink:href') ?? '');
    }
    picture.setAttribute('href', url);
  }
  picture.setAttribute(AVATAR, kind === 'person' ? 'icon' : 'dot');
}

function uncover(picture: Element) {
  if (picture instanceof HTMLImageElement) picture.style.removeProperty('content');
  else if (picture.hasAttribute(ORIGINAL_HREF)) {
    picture.setAttribute('href', picture.getAttribute(ORIGINAL_HREF) ?? '');
    picture.removeAttribute(ORIGINAL_HREF);
  }
  picture.removeAttribute(AVATAR);
}

function coverAll() {
  for (const picture of document.querySelectorAll(PICTURES)) cover(picture);
}

let frame = 0;
let timer: number | null = null;

// Facebook may give a picture already looked at a new source (or another
// person): it is looked at again, and the source kept for uncovering is the
// new one. Our own data: URLs don't count.
const watcher = new MutationObserver(records => {
  for (const { type, target } of records) {
    if (type !== 'attributes' || !(target instanceof Element) || !target.hasAttribute(AVATAR)) continue;
    const source = target.getAttribute('href') ?? target.getAttribute('src') ?? '';
    if (source.startsWith('data:image/svg+xml')) continue;
    if (target.hasAttribute(ORIGINAL_HREF)) target.setAttribute(ORIGINAL_HREF, source);
    target.removeAttribute(AVATAR);
  }
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    coverAll();
  });
});

export function startIconAvatars() {
  if (timer !== null) return;
  watcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
  timer = window.setInterval(coverAll, 1000);
  coverAll();
}

export function stopIconAvatars() {
  if (timer === null) return;
  watcher.disconnect();
  window.clearInterval(timer);
  timer = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  for (const picture of document.querySelectorAll(`[${AVATAR}]`)) uncover(picture);
}
