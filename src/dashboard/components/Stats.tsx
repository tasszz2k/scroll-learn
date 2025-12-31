import type { Stats as StatsType, Deck, Card } from '../../common/types';

interface StatsProps {
  stats: StatsType;
  decks: Deck[];
  cards: Card[];
}

export default function Stats({ stats, decks, cards }: StatsProps) {
  const now = Date.now();
  const DAY_MS = 86400 * 1000;

  // Calculate due cards
  const dueNow = cards.filter(c => c.due <= now).length;
  const dueTomorrow = cards.filter(c => c.due > now && c.due <= now + DAY_MS).length;
  const dueThisWeek = cards.filter(c => c.due > now && c.due <= now + 7 * DAY_MS).length;

  // Get last 14 days of stats
  const last14Days = getLast14Days(stats.dailyStats);

  // Calculate deck-wise breakdown
  const deckStats = decks.map(deck => {
    const deckCards = cards.filter(c => c.deckId === deck.id);
    const due = deckCards.filter(c => c.due <= now).length;
    const learned = deckCards.filter(c => c.repetitions > 0).length;
    const avgEase = deckCards.length > 0 
      ? deckCards.reduce((sum, c) => sum + c.ease, 0) / deckCards.length 
      : 2.5;
    
    return {
      deck,
      total: deckCards.length,
      due,
      learned,
      new: deckCards.length - learned,
      avgEase,
    };
  });

  // Get max value for chart scaling
  const maxReviews = Math.max(...last14Days.map(d => d.reviews), 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Statistics</h2>
        <p className="text-surface-500 mt-1">Track your learning progress</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <div className="text-3xl font-bold text-primary-600 dark:text-primary-400">
            {stats.currentStreak}
          </div>
          <div className="text-sm text-surface-500 mt-1">Day Streak</div>
          {stats.longestStreak > stats.currentStreak && (
            <div className="text-xs text-surface-400 mt-2">
              Best: {stats.longestStreak} days
            </div>
          )}
        </div>

        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {Math.round(stats.averageAccuracy * 100)}%
          </div>
          <div className="text-sm text-surface-500 mt-1">Accuracy</div>
          <div className="text-xs text-surface-400 mt-2">
            {stats.totalReviews} total reviews
          </div>
        </div>

        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {dueNow}
          </div>
          <div className="text-sm text-surface-500 mt-1">Due Now</div>
          <div className="text-xs text-surface-400 mt-2">
            +{dueTomorrow} tomorrow
          </div>
        </div>

        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <div className="text-3xl font-bold text-surface-900 dark:text-surface-50">
            {cards.length}
          </div>
          <div className="text-sm text-surface-500 mt-1">Total Cards</div>
          <div className="text-xs text-surface-400 mt-2">
            {decks.length} decks
          </div>
        </div>
      </div>

      {/* Review Chart */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Reviews (Last 14 Days)</h3>
        
        {stats.totalReviews === 0 ? (
          <div className="text-center py-8 text-surface-500">
            No reviews yet. Start studying to see your progress!
          </div>
        ) : (
          <div className="space-y-4">
            {/* Chart */}
            <div className="flex items-end gap-1 h-40">
              {last14Days.map((day, index) => {
                const height = (day.reviews / maxReviews) * 100;
                const correctPercent = day.reviews > 0 ? day.correct / day.reviews : 0;
                
                return (
                  <div 
                    key={index} 
                    className="flex-1 flex flex-col items-center group relative"
                  >
                    <div 
                      className="w-full rounded-t-sm transition-all duration-300 relative overflow-hidden"
                      style={{ height: `${Math.max(height, 2)}%` }}
                    >
                      {/* Correct portion */}
                      <div 
                        className="absolute bottom-0 w-full bg-green-500 dark:bg-green-400"
                        style={{ height: `${correctPercent * 100}%` }}
                      />
                      {/* Incorrect portion */}
                      <div 
                        className="absolute top-0 w-full bg-red-400 dark:bg-red-500"
                        style={{ height: `${(1 - correctPercent) * 100}%` }}
                      />
                    </div>
                    
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                      <div className="bg-surface-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                        {day.date}: {day.reviews} reviews
                        <br />
                        {day.correct} correct, {day.incorrect} wrong
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* X-axis labels */}
            <div className="flex gap-1 text-xs text-surface-400">
              {last14Days.map((_day, index) => (
                <div key={index} className="flex-1 text-center truncate">
                  {index === 0 ? '14d ago' : index === 13 ? 'Today' : ''}
                </div>
              ))}
            </div>
            
            {/* Legend */}
            <div className="flex items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-green-500 dark:bg-green-400" />
                <span className="text-surface-600 dark:text-surface-400">Correct</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-red-400 dark:bg-red-500" />
                <span className="text-surface-600 dark:text-surface-400">Incorrect</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Upcoming Reviews */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Upcoming Reviews</h3>
        
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {dueNow}
            </div>
            <div className="text-sm text-surface-500">Today</div>
          </div>
          <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {dueTomorrow}
            </div>
            <div className="text-sm text-surface-500">Tomorrow</div>
          </div>
          <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-lg">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {dueThisWeek}
            </div>
            <div className="text-sm text-surface-500">This Week</div>
          </div>
        </div>
      </div>

      {/* Deck Breakdown */}
      {deckStats.length > 0 && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Deck Breakdown</h3>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-2 px-3 font-medium text-surface-500">Deck</th>
                  <th className="text-right py-2 px-3 font-medium text-surface-500">Cards</th>
                  <th className="text-right py-2 px-3 font-medium text-surface-500">Due</th>
                  <th className="text-right py-2 px-3 font-medium text-surface-500">New</th>
                  <th className="text-right py-2 px-3 font-medium text-surface-500">Learned</th>
                  <th className="text-right py-2 px-3 font-medium text-surface-500">Ease</th>
                </tr>
              </thead>
              <tbody>
                {deckStats.map(stat => (
                  <tr key={stat.deck.id} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-3 px-3 font-medium text-surface-900 dark:text-surface-100">
                      {stat.deck.name}
                    </td>
                    <td className="py-3 px-3 text-right text-surface-600 dark:text-surface-400">
                      {stat.total}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {stat.due > 0 ? (
                        <span className="text-orange-600 dark:text-orange-400 font-medium">{stat.due}</span>
                      ) : (
                        <span className="text-surface-400">0</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right text-blue-600 dark:text-blue-400">
                      {stat.new}
                    </td>
                    <td className="py-3 px-3 text-right text-green-600 dark:text-green-400">
                      {stat.learned}
                    </td>
                    <td className="py-3 px-3 text-right text-surface-600 dark:text-surface-400">
                      {Math.round(stat.avgEase * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Card States */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Card States</h3>
        
        {cards.length === 0 ? (
          <div className="text-center py-8 text-surface-500">
            No cards yet. Import or create some cards to see the breakdown.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="h-8 flex rounded-lg overflow-hidden">
              {(() => {
                const newCards = cards.filter(c => c.repetitions === 0).length;
                const learning = cards.filter(c => c.repetitions > 0 && c.intervalDays < 7).length;
                const mature = cards.filter(c => c.intervalDays >= 7).length;
                const total = cards.length;
                
                return (
                  <>
                    <div 
                      className="bg-blue-500 flex items-center justify-center text-white text-xs font-medium"
                      style={{ width: `${(newCards / total) * 100}%` }}
                    >
                      {newCards > 0 && newCards}
                    </div>
                    <div 
                      className="bg-orange-500 flex items-center justify-center text-white text-xs font-medium"
                      style={{ width: `${(learning / total) * 100}%` }}
                    >
                      {learning > 0 && learning}
                    </div>
                    <div 
                      className="bg-green-500 flex items-center justify-center text-white text-xs font-medium"
                      style={{ width: `${(mature / total) * 100}%` }}
                    >
                      {mature > 0 && mature}
                    </div>
                  </>
                );
              })()}
            </div>
            
            {/* Legend */}
            <div className="flex items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-blue-500" />
                <span className="text-surface-600 dark:text-surface-400">
                  New ({cards.filter(c => c.repetitions === 0).length})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-orange-500" />
                <span className="text-surface-600 dark:text-surface-400">
                  Learning ({cards.filter(c => c.repetitions > 0 && c.intervalDays < 7).length})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-green-500" />
                <span className="text-surface-600 dark:text-surface-400">
                  Mature ({cards.filter(c => c.intervalDays >= 7).length})
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to get last 14 days of stats
function getLast14Days(dailyStats: StatsType['dailyStats']) {
  const days: Array<{ date: string; reviews: number; correct: number; incorrect: number }> = [];
  
  for (let i = 13; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const dayStats = dailyStats.find(d => d.date === dateStr);
    
    days.push({
      date: dateStr,
      reviews: dayStats?.reviews || 0,
      correct: dayStats?.correct || 0,
      incorrect: dayStats?.incorrect || 0,
    });
  }
  
  return days;
}

