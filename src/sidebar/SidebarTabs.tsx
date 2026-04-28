import type { SidebarTab } from './sidebarTypes';

interface SidebarTabsProps {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
  badges?: Partial<Record<SidebarTab, number>>;
}

const TABS: { id: SidebarTab; label: string; num: string }[] = [
  { id: 'quizzes', label: 'Quizzes', num: '01' },
  { id: 'notes',   label: 'Notes',   num: '02' },
  { id: 'chat',    label: 'Chat',    num: '03' },
];

export default function SidebarTabs({ active, onChange, badges }: SidebarTabsProps) {
  return (
    <nav className="sidebar-tabs" role="tablist" aria-label="Sidebar sections">
      {TABS.map(tab => {
        const isActive = tab.id === active;
        const badge = badges?.[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={'sidebar-tab' + (isActive ? ' is-active' : '')}
            onClick={() => onChange(tab.id)}
          >
            <span className="mono sidebar-tab-num">{tab.num}</span>
            <span className="sidebar-tab-label">{tab.label}</span>
            {typeof badge === 'number' && badge > 0 && (
              <span className="sidebar-tab-badge" aria-label={`${badge} pending`}>
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
