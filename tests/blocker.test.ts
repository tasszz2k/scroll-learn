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
