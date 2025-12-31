/**
 * Instagram Feed Post Detection
 * 
 * Instagram uses React with dynamic class names but has stable structure:
 * - article elements for posts
 * - data-testid attributes for key elements
 * - role="presentation" for feed items
 */

import type { DomainDetector } from './fb';

/**
 * Instagram detector for feed posts
 */
export const instagramDetector: DomainDetector = {
  name: 'Instagram',
  domain: /instagram\.com$/i,
  
  /**
   * Get selector for feed posts
   * Instagram wraps each post in an article element
   * Use more specific selector to avoid nested matches
   */
  getPostSelector(): string {
    // Target top-level articles only (direct children of main sections)
    return 'main article, section > div > div > article';
  },
  
  /**
   * Get the main feed container
   */
  getFeedContainer(): HTMLElement | null {
    // Try various selectors for Instagram containers
    const selectors = [
      'main[role="main"]',
      'section main',
      '[role="main"]',
    ];
    
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container instanceof HTMLElement) {
        console.log('[ScrollLearn] Found Instagram feed container with selector:', selector);
        return container;
      }
    }
    
    console.log('[ScrollLearn] No Instagram feed container found, using body');
    return document.body;
  },
  
  /**
   * Check if an element is a valid Instagram post
   */
  isValidPost(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    
    // Must be visible with reasonable size for a post
    if (rect.width < 300 || rect.height < 200) {
      return false;
    }
    
    // Must have an image or video (core Instagram content)
    const hasMedia = 
      element.querySelector('img[srcset], img[src*="instagram"]') !== null ||
      element.querySelector('video') !== null;
    
    // Must have interactive elements (like button, comment, etc.)
    const hasInteraction = 
      element.querySelector('[aria-label*="Like"], [aria-label*="Comment"], svg[aria-label]') !== null ||
      element.querySelector('button') !== null;
    
    return hasMedia || hasInteraction;
  },
  
  /**
   * Get insertion point for quiz (after the post)
   */
  getInsertionPoint(post: Element): Element | null {
    return post;
  },
  
  /**
   * Get unique identifier for a post
   */
  getPostId(post: Element): string | null {
    // Try to find post link with ID (most reliable)
    const postLink = post.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    if (postLink) {
      const href = postLink.getAttribute('href') || '';
      const match = href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }
    
    // Try time element which often has post info
    const timeElement = post.querySelector('time[datetime]');
    if (timeElement) {
      const datetime = timeElement.getAttribute('datetime');
      if (datetime) return `ig-time-${datetime}`;
    }
    
    // Try to find username link as identifier
    const userLink = post.querySelector('a[href^="/"][role="link"]');
    if (userLink) {
      const href = userLink.getAttribute('href') || '';
      const userMatch = href.match(/^\/([^/]+)\/?$/);
      if (userMatch) {
        // Combine username with image src for uniqueness
        const img = post.querySelector('img[src]');
        const imgSrc = img?.getAttribute('src') || '';
        const imgHash = imgSrc.slice(-20); // Last 20 chars of image URL
        return `ig-${userMatch[1]}-${imgHash}`;
      }
    }
    
    // Last resort: use index in parent (stable as long as DOM structure doesn't change)
    const parent = post.parentElement;
    if (parent) {
      const siblings = Array.from(parent.querySelectorAll(':scope > article'));
      const index = siblings.indexOf(post as Element);
      if (index >= 0) return `ig-idx-${index}`;
    }
    
    return null; // Don't count posts we can't identify stably
  },
};

/**
 * Check if we're on the Instagram feed or explore page
 */
export function isInstagramFeedPage(): boolean {
  const path = window.location.pathname;
  return (
    path === '/' ||
    path === '/explore/' ||
    path.startsWith('/explore/') ||
    path.match(/^\/[^/]+\/?$/) !== null // Profile pages
  );
}

/**
 * Check if we're viewing a single post (modal or page)
 */
export function isInstagramPostPage(): boolean {
  const path = window.location.pathname;
  return path.startsWith('/p/') || path.startsWith('/reel/');
}

