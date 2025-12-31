/**
 * Facebook Feed Post Detection
 * 
 * Facebook uses dynamic class names, so we rely on:
 * - [role="article"] elements
 * - data-pagelet attributes
 * - Structural patterns
 */

export interface DomainDetector {
  name: string;
  domain: RegExp;
  getPostSelector: () => string;
  getFeedContainer: () => HTMLElement | null;
  isValidPost: (element: Element) => boolean;
  getInsertionPoint: (post: Element) => Element | null;
  getPostId: (post: Element) => string | null;
}

/**
 * Facebook detector for feed posts
 */
export const facebookDetector: DomainDetector = {
  name: 'Facebook',
  domain: /facebook\.com$/i,
  
  /**
   * Get selector for feed posts
   * Facebook's DOM changes frequently - we try multiple selectors
   */
  getPostSelector(): string {
    // Use broader selectors and filter by size/position in isValidPost
    return '[role="article"], [data-pagelet*="FeedUnit"], [role="feed"] > div > div > div';
  },
  
  /**
   * Get the main feed container
   */
  getFeedContainer(): HTMLElement | null {
    // Try various selectors for the feed container
    const selectors = [
      '[role="feed"]',
      '[role="main"]',
      '[data-pagelet="Feed"]',
    ];
    
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container instanceof HTMLElement) {
        console.log('[ScrollLearn] Found feed container with selector:', selector);
        return container;
      }
    }
    
    console.log('[ScrollLearn] No feed container found, using body');
    // Fallback to body
    return document.body;
  },
  
  /**
   * Check if an element is a valid feed post
   */
  isValidPost(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    
    // Must be visible with reasonable size for a post
    if (rect.width < 300 || rect.height < 100) {
      return false;
    }
    
    // Accept ALL reasonably sized elements - let content.ts handle scroll tracking
    return true;
  },
  
  /**
   * Get insertion point for quiz (after the post)
   */
  getInsertionPoint(post: Element): Element | null {
    // Insert after the post
    return post;
  },
  
  /**
   * Get unique identifier for a post
   */
  getPostId(post: Element): string | null {
    // Try data-pagelet attribute first (most reliable for new Facebook)
    const dataId = post.getAttribute('data-pagelet');
    if (dataId) return dataId;
    
    // Try to find a link with post ID
    const postLink = post.querySelector('a[href*="/posts/"], a[href*="story_fbid"], a[href*="/permalink/"]');
    if (postLink) {
      const href = postLink.getAttribute('href') || '';
      const match = href.match(/(?:posts|story_fbid|permalink)[=/](\d+)/);
      if (match) return match[1];
    }
    
    // Try finding any unique identifier in the element
    const anyLink = post.querySelector('a[href*="facebook.com"]');
    if (anyLink) {
      const href = anyLink.getAttribute('href') || '';
      // Extract any numeric ID from the URL
      const idMatch = href.match(/[=/](\d{10,})/);
      if (idMatch) return idMatch[1];
    }
    
    // Fallback to stable position-based ID (using element's position in DOM)
    const rect = post.getBoundingClientRect();
    const scrollY = window.scrollY;
    // Use approximate Y position as a stable identifier
    const approxY = Math.round((rect.top + scrollY) / 100) * 100;
    return `fb-post-y${approxY}`;
  },
};

/**
 * Get all visible posts in the feed
 */
export function getVisiblePosts(detector: DomainDetector): Element[] {
  const selector = detector.getPostSelector();
  const allPosts = document.querySelectorAll(selector);
  
  const visiblePosts: Element[] = [];
  
  for (const post of allPosts) {
    if (detector.isValidPost(post)) {
      visiblePosts.push(post);
    }
  }
  
  return visiblePosts;
}

/**
 * Find the best insertion point after N posts
 */
export function findInsertionPoint(
  detector: DomainDetector,
  afterNPosts: number
): Element | null {
  const posts = getVisiblePosts(detector);
  
  if (posts.length < afterNPosts) {
    return null;
  }
  
  const targetPost = posts[afterNPosts - 1];
  return detector.getInsertionPoint(targetPost);
}

