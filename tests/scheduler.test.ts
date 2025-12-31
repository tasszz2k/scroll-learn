import { describe, it, expect } from 'vitest';
import { sm2Update, getSchedulingInfo, previewNextIntervals, calculateRetentionRate } from '../src/background/scheduler';
import type { Card } from '../src/common/types';

// Helper to create a test card
function createTestCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'test-card-1',
    deckId: 'test-deck-1',
    kind: 'text',
    front: 'Test question',
    back: 'Test answer',
    canonicalAnswers: ['test answer'],
    due: Date.now(),
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('sm2Update', () => {
  describe('Grade 0 (Again/Fail)', () => {
    it('should reset repetitions to 0', () => {
      const card = createTestCard({ repetitions: 5, intervalDays: 30 });
      const updated = sm2Update(card, 0);
      expect(updated.repetitions).toBe(0);
    });

    it('should set interval to 1 day', () => {
      const card = createTestCard({ intervalDays: 30 });
      const updated = sm2Update(card, 0);
      expect(updated.intervalDays).toBe(1);
    });

    it('should reduce ease by 0.2', () => {
      const card = createTestCard({ ease: 2.5 });
      const updated = sm2Update(card, 0);
      expect(updated.ease).toBe(2.3);
    });

    it('should not reduce ease below 1.3', () => {
      const card = createTestCard({ ease: 1.4 });
      const updated = sm2Update(card, 0);
      expect(updated.ease).toBe(1.3);
    });

    it('should increment lapses', () => {
      const card = createTestCard({ lapses: 2 });
      const updated = sm2Update(card, 0);
      expect(updated.lapses).toBe(3);
    });
  });

  describe('Grade 1 (Hard)', () => {
    it('should increment repetitions', () => {
      const card = createTestCard({ repetitions: 2 });
      const updated = sm2Update(card, 1);
      expect(updated.repetitions).toBe(3);
    });

    it('should reduce ease by 0.15', () => {
      const card = createTestCard({ ease: 2.5 });
      const updated = sm2Update(card, 1);
      expect(updated.ease).toBeCloseTo(2.35);
    });

    it('should use shorter interval for first review', () => {
      const card = createTestCard({ repetitions: 0 });
      const updated = sm2Update(card, 1);
      expect(updated.intervalDays).toBe(1);
    });

    it('should not increment lapses', () => {
      const card = createTestCard({ lapses: 2 });
      const updated = sm2Update(card, 1);
      expect(updated.lapses).toBe(2);
    });
  });

  describe('Grade 2 (Good)', () => {
    it('should increment repetitions', () => {
      const card = createTestCard({ repetitions: 3 });
      const updated = sm2Update(card, 2);
      expect(updated.repetitions).toBe(4);
    });

    it('should not change ease', () => {
      const card = createTestCard({ ease: 2.5 });
      const updated = sm2Update(card, 2);
      expect(updated.ease).toBe(2.5);
    });

    it('should use initial interval for first review', () => {
      const card = createTestCard({ repetitions: 0 });
      const updated = sm2Update(card, 2);
      expect(updated.intervalDays).toBe(1);
    });

    it('should use second interval for second review', () => {
      const card = createTestCard({ repetitions: 1, intervalDays: 1 });
      const updated = sm2Update(card, 2);
      expect(updated.intervalDays).toBe(6);
    });

    it('should multiply interval by ease for subsequent reviews', () => {
      const card = createTestCard({ repetitions: 2, intervalDays: 6, ease: 2.5 });
      const updated = sm2Update(card, 2);
      expect(updated.intervalDays).toBe(15); // 6 * 2.5 = 15
    });
  });

  describe('Grade 3 (Easy)', () => {
    it('should increment repetitions', () => {
      const card = createTestCard({ repetitions: 1 });
      const updated = sm2Update(card, 3);
      expect(updated.repetitions).toBe(2);
    });

    it('should increase ease by 0.15', () => {
      const card = createTestCard({ ease: 2.5 });
      const updated = sm2Update(card, 3);
      expect(updated.ease).toBeCloseTo(2.65);
    });

    it('should not exceed max ease of 3.5', () => {
      const card = createTestCard({ ease: 3.4 });
      const updated = sm2Update(card, 3);
      expect(updated.ease).toBe(3.5);
    });

    it('should use bonus interval (x1.3) for subsequent reviews', () => {
      const card = createTestCard({ repetitions: 2, intervalDays: 10, ease: 2.5 });
      const updated = sm2Update(card, 3);
      // 10 * 2.5 * 1.3 = 32.5 -> 33
      expect(updated.intervalDays).toBe(33);
    });

    it('should use larger initial interval for easy first review', () => {
      const card = createTestCard({ repetitions: 0 });
      const updated = sm2Update(card, 3);
      expect(updated.intervalDays).toBe(4);
    });
  });

  describe('Due date calculation', () => {
    it('should set due date based on interval', () => {
      const card = createTestCard();
      const before = Date.now();
      const updated = sm2Update(card, 2);
      const after = Date.now();
      
      // Due should be approximately now + intervalDays * 86400000ms
      const expectedDue = updated.intervalDays * 86400 * 1000;
      expect(updated.due).toBeGreaterThanOrEqual(before + expectedDue);
      expect(updated.due).toBeLessThanOrEqual(after + expectedDue + 1000);
    });
  });

  describe('Interval bounds', () => {
    it('should not set interval below 1 day', () => {
      const card = createTestCard({ intervalDays: 1, ease: 0.5 });
      const updated = sm2Update(card, 1);
      expect(updated.intervalDays).toBeGreaterThanOrEqual(1);
    });

    it('should not set interval above 365 days', () => {
      const card = createTestCard({ repetitions: 10, intervalDays: 300, ease: 3.5 });
      const updated = sm2Update(card, 3);
      expect(updated.intervalDays).toBeLessThanOrEqual(365);
    });
  });
});

describe('getSchedulingInfo', () => {
  it('should correctly identify due cards', () => {
    const pastDue = createTestCard({ due: Date.now() - 1000 });
    const futureDue = createTestCard({ due: Date.now() + 86400000 });
    
    expect(getSchedulingInfo(pastDue).isDue).toBe(true);
    expect(getSchedulingInfo(futureDue).isDue).toBe(false);
  });

  it('should calculate days until due', () => {
    const card = createTestCard({ due: Date.now() + 3 * 86400 * 1000 });
    const info = getSchedulingInfo(card);
    expect(info.daysUntilDue).toBe(3);
  });

  it('should format interval correctly', () => {
    expect(getSchedulingInfo(createTestCard({ intervalDays: 1 })).intervalString).toBe('1 day');
    expect(getSchedulingInfo(createTestCard({ intervalDays: 5 })).intervalString).toBe('5 days');
    expect(getSchedulingInfo(createTestCard({ intervalDays: 14 })).intervalString).toBe('2 weeks');
    expect(getSchedulingInfo(createTestCard({ intervalDays: 60 })).intervalString).toBe('2 months');
    expect(getSchedulingInfo(createTestCard({ intervalDays: 365 })).intervalString).toBe('1 year');
  });

  it('should calculate ease percentage', () => {
    const card = createTestCard({ ease: 2.5 });
    expect(getSchedulingInfo(card).easePercentage).toBe(250);
  });
});

describe('previewNextIntervals', () => {
  it('should return intervals for all grades', () => {
    const card = createTestCard({ repetitions: 2, intervalDays: 6, ease: 2.5 });
    const previews = previewNextIntervals(card);
    
    expect(previews[0]).toBeDefined();
    expect(previews[1]).toBeDefined();
    expect(previews[2]).toBeDefined();
    expect(previews[3]).toBeDefined();
  });

  it('should show progressively longer intervals for higher grades', () => {
    const card = createTestCard({ repetitions: 2, intervalDays: 10, ease: 2.5 });
    const previews = previewNextIntervals(card);
    
    // Grade 0 resets to 1 day
    expect(previews[0]).toBe('1 day');
  });
});

describe('calculateRetentionRate', () => {
  it('should calculate correct retention rate', () => {
    const now = Date.now();
    const reviews = [
      { grade: 3 as const, timestamp: now - 1000 },
      { grade: 2 as const, timestamp: now - 2000 },
      { grade: 1 as const, timestamp: now - 3000 },
      { grade: 0 as const, timestamp: now - 4000 },
    ];
    
    // 2 out of 4 are "successful" (grade >= 2)
    expect(calculateRetentionRate(reviews, 30)).toBe(0.5);
  });

  it('should only consider reviews within window', () => {
    const now = Date.now();
    const DAY = 86400 * 1000;
    const reviews = [
      { grade: 3 as const, timestamp: now - 1 * DAY },
      { grade: 0 as const, timestamp: now - 100 * DAY }, // Outside 30-day window
    ];
    
    // Only the recent review counts
    expect(calculateRetentionRate(reviews, 30)).toBe(1);
  });

  it('should return 0 for empty reviews', () => {
    expect(calculateRetentionRate([], 30)).toBe(0);
  });
});

