// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.facebook.com/"}

import { describe, it, expect, afterEach } from 'vitest';
import { startBlocker, stopBlocker } from '../src/content/blocker';
import { DEFAULT_SETTINGS, type Settings } from '../src/common/types';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  hideByKeyword: true,
  blockedKeywords: ['kubectl'],
};

// Facebook's current layout renders many portal/script siblings directly in
// <body>, which trips the blocker's "parent has 8+ children = feed level"
// heuristic for anything appended to body.
function seedFacebookBody() {
  document.body.innerHTML = '';
  for (let i = 0; i < 10; i++) document.body.appendChild(document.createElement('div'));
}

function flushObserver() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isHidden(el: Element) {
  return el.hasAttribute('data-sl-hidden') || (el as HTMLElement).style.display === 'none';
}

describe('blocker on Facebook', () => {
  afterEach(() => {
    stopBlocker();
    document.body.innerHTML = '';
  });

  it('still hides a body-level post that matches a blocked keyword', async () => {
    seedFacebookBody();
    startBlocker(settings);

    const post = document.createElement('div');
    post.textContent = 'Some post about kubectl rollout restart in production';
    document.body.appendChild(post);
    await flushObserver();

    expect(isHidden(post)).toBe(true);
  });

  it('never hides the ScrollLearn quiz overlay even if its text matches a filter', async () => {
    seedFacebookBody();
    startBlocker(settings);

    const blocker = document.createElement('div');
    blocker.id = 'scrolllearn-scroll-blocker';
    document.body.appendChild(blocker);

    const quiz = document.createElement('div');
    quiz.id = 'scrolllearn-quiz-root';
    quiz.innerHTML =
      '<div role="dialog" aria-labelledby="ss-question">' +
      '<div id="ss-question">Which kubectl command rolls back a Deployment?</div>' +
      '</div>';
    document.body.appendChild(quiz);
    await flushObserver();

    expect(isHidden(quiz)).toBe(false);
    expect(isHidden(blocker)).toBe(false);
  });
});

// Right-rail ad card as rendered by Facebook desktop (Nov 2026). Tracking
// query strings and atomic CSS classes are trimmed; nesting, attributes, and
// the aria-labelledby ids (which point at nodes not present in the DOM) are
// kept verbatim because the detectors depend on them.
function rightRailAdCard(advertiser: string, href: string, title: string, domain: string, ids: [string, string, string]) {
  const [cardId, labelId, menuLabelId] = ids;
  return (
    '<div><div><div data-visualcompletion="ignore-dynamic"><div class="x1n2onr6"><div class="x1n2onr6">' +
    `<a attributionsrc="_blank" href="${href}" rel="nofollow" role="link" tabindex="0" target="rhcad3">` +
    `<div class="html-div"><div class="html-div"><div id="${cardId}"><span aria-labelledby="${labelId}">` +
    '<div class="x6s0dn4 x78zum5"><div class="xamitd3"><img alt="" aria-hidden="true" src="https://scontent.example/ad.jpg"></div>' +
    '<div class="x1g0dm76"><div class="x78zum5 xdt5ytf">' +
    `<div class="xu06os2"><span dir="auto"><span>${title}</span></span></div>` +
    `<div class="xu06os2"><span dir="auto"><span><div class="x1kyqaxf">${domain}</div></span></span></div>` +
    '</div></div></div></span></div></div></div>' +
    '<div role="none" data-visualcompletion="ignore" style="inset: 0px;"></div></a>' +
    '<div class="x6s0dn4"><div class="x1qvwoe0">' +
    `<span aria-labelledby="${menuLabelId}"><div aria-expanded="false" aria-haspopup="menu" ` +
    `aria-label="Open menu for ${advertiser} sponsored content" role="button" tabindex="0">` +
    '<svg viewBox="0 0 20 20" aria-hidden="true"></svg><div role="none" data-visualcompletion="ignore"></div>' +
    '</div></span></div></div>' +
    '</div></div></div></div></div>'
  );
}

const RIGHT_RAIL_AD_CARDS =
  rightRailAdCard('ElevenLabs', 'https://elevenlabs.io/v4?utm_source=facebook', 'Introducing Eleven v4', 'elevenlabs.io', ['_r_3ng_', '_r_3nf_', '_r_6g3_']) +
  rightRailAdCard('VietnamWorks.com', 'https://www.vietnamworks.com/job?utm_source=facebook', 'VietnamWorks.com', 'vietnamworks.com', ['_r_3nk_', '_r_3nj_', '_r_6g8_']);

function rightRailSponsoredSection(cards: string) {
  return (
    '<div class="x1y1aw1k" id="rr-sponsored"><!--$--><div class="x6ikm8r x10wlt62"><div><div data-visualcompletion="ignore-late-mutation"><div class="">' +
    '<div class="x1n2onr6 x1uc6qws xyen2ro"><div><div><div><div class="x78zum5 xdt5ytf"><div class="xu06os2 x1ok221b">' +
    '<span dir="auto"><div><div><h3 class="html-h3"><span><span style="-webkit-box-orient:vertical;-webkit-line-clamp:2;display:-webkit-box">' +
    'Sponsored<!-- -->\u200B</span></span></h3></div>' +
    '<div><div><div>&nbsp;</div><div><div></div></div></div></div></div></span>' +
    '</div></div></div></div></div></div>' +
    `<div class="xwib8y2 x1y1aw1k" id="rr-ad-list">${cards}</div><div class="x14nfmen"></div>` +
    '</div></div></div></div><!--/$--></div>'
  );
}

function rightRailPage(cards: string) {
  return (
    '<div role="main"><div role="feed"><div role="article" id="friend-post">Friend shared a photo</div></div></div>' +
    '<div role="complementary"><div id="rr-column">' +
    rightRailSponsoredSection(cards) +
    '<div id="rr-contacts"><h3>Contacts</h3><span>Alice</span></div>' +
    '</div></div>'
  );
}

describe('blocker on Facebook right rail', () => {
  afterEach(() => {
    stopBlocker();
    document.body.innerHTML = '';
  });

  it('hides the right-rail Sponsored section without hiding sibling rail sections', async () => {
    seedFacebookBody();
    startBlocker({ ...DEFAULT_SETTINGS, hideFacebookSponsored: true });

    const page = document.createElement('div');
    page.innerHTML = rightRailPage(RIGHT_RAIL_AD_CARDS);
    document.body.appendChild(page);
    await flushObserver();

    expect(isHidden(document.getElementById('rr-sponsored')!)).toBe(true);
    expect(isHidden(document.getElementById('rr-column')!)).toBe(false);
    expect(isHidden(document.getElementById('rr-contacts')!)).toBe(false);
    expect(isHidden(document.getElementById('friend-post')!)).toBe(false);
  });

  it('waits for ad cards when the Sponsored heading streams in first', async () => {
    seedFacebookBody();
    startBlocker({ ...DEFAULT_SETTINGS, hideFacebookSponsored: true });

    const page = document.createElement('div');
    page.innerHTML = rightRailPage('');
    document.body.appendChild(page);
    await flushObserver();

    const section = document.getElementById('rr-sponsored')!;
    expect(isHidden(section)).toBe(false);

    const list = document.getElementById('rr-ad-list')!;
    const card = document.createElement('div');
    card.innerHTML = RIGHT_RAIL_AD_CARDS;
    list.appendChild(card);
    await flushObserver();

    expect(isHidden(section)).toBe(true);
    expect(isHidden(document.getElementById('rr-contacts')!)).toBe(false);
  });
});
