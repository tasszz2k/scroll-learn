/**
 * YouTube Feed Post Detection
 * 
 * YouTube uses custom elements (ytd-*) for its interface.
 * We target:
 * - ytd-rich-item-renderer (home feed)
 * - ytd-video-renderer (search results)
 * - ytd-compact-video-renderer (sidebar recommendations)
 */

import type { DomainDetector } from './fb';

/**
 * YouTube detector for feed items
 */
export const youtubeDetector: DomainDetector = {
  name: 'YouTube',
  domain: /youtube\.com$/i,
  
  /**
   * Get selector for feed items
   */
  getPostSelector(): string {
    return `
      ytd-rich-item-renderer,
      ytd-video-renderer,
      ytd-compact-video-renderer,
      ytd-grid-video-renderer
    `.trim().replace(/\s+/g, ' ');
  },
  
  /**
   * Get the main feed container
   */
  getFeedContainer(): HTMLElement | null {
    // Try various selectors for YouTube containers
    const selectors = [
      'ytd-rich-grid-renderer',
      '#contents.ytd-rich-grid-renderer',
      'ytd-section-list-renderer',
      '#primary',
      '#content',
    ];
    
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container instanceof HTMLElement) {
        return container;
      }
    }
    
    return document.body;
  },
  
  /**
   * Check if an element is a valid video item
   */
  isValidPost(element: Element): boolean {
    // Must be visible
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    
    // Must be in viewport or below
    if (rect.bottom < 0) {
      return false;
    }
    
    // Must have a video thumbnail or title
    const hasVideoContent = 
      element.querySelector('ytd-thumbnail') !== null ||
      element.querySelector('#thumbnail') !== null ||
      element.querySelector('#video-title') !== null ||
      element.querySelector('a#video-title-link') !== null;
    
    // Exclude ads
    const isAd = 
      element.querySelector('[is-ad-preview]') !== null ||
      element.querySelector('ytd-ad-slot-renderer') !== null ||
      element.classList.contains('ytd-ad-slot-renderer');
    
    return hasVideoContent && !isAd;
  },
  
  /**
   * Get insertion point for quiz (after the item)
   */
  getInsertionPoint(post: Element): Element | null {
    return post;
  },
  
  /**
   * Get unique identifier for a video
   */
  getPostId(post: Element): string | null {
    // Try to find video link
    const videoLink = post.querySelector('a[href*="/watch?v="]');
    if (videoLink) {
      const href = videoLink.getAttribute('href');
      const match = href?.match(/[?&]v=([^&]+)/);
      if (match) return match[1];
    }
    
    // Try data attributes
    const videoId = post.querySelector('[data-video-id]')?.getAttribute('data-video-id');
    if (videoId) return videoId;
    
    // Fallback
    const index = Array.from(post.parentElement?.children || []).indexOf(post);
    return `yt-video-${index}-${Date.now()}`;
  },
};

/**
 * Check if we're on the YouTube home page or subscriptions
 */
export function isYouTubeFeedPage(): boolean {
  const path = window.location.pathname;
  return (
    path === '/' ||
    path === '/feed/subscriptions' ||
    path === '/feed/trending' ||
    path.startsWith('/results') ||
    path.startsWith('/channel/') ||
    path.startsWith('/c/') ||
    path.startsWith('/@')
  );
}

/**
 * Check if we're watching a video (sidebar recommendations)
 */
export function isYouTubeWatchPage(): boolean {
  return window.location.pathname === '/watch';
}

/**
 * Get the appropriate container based on page type
 */
export function getYouTubeContainer(): HTMLElement | null {
  if (isYouTubeWatchPage()) {
    // Sidebar recommendations
    return document.querySelector('#secondary #related') as HTMLElement | null;
  }
  
  // Feed pages
  return youtubeDetector.getFeedContainer();
}

