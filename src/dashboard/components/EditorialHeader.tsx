import type { ReactNode } from 'react';

interface EditorialHeaderProps {
  kicker: string;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}

/**
 * Editorial section header used across dashboard tabs.
 * Layout: eyebrow kicker (mono) + serif display title + sub copy on the
 * left, optional action on the right, with a hairline rule below.
 */
export default function EditorialHeader({ kicker, title, sub, action }: EditorialHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        paddingBottom: 18,
        borderBottom: '1px solid var(--rule)',
        marginBottom: 24,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow">{kicker}</div>
        <h2
          className="display"
          style={{ fontSize: 38, margin: '10px 0 6px', maxWidth: 720, lineHeight: 1.05 }}
        >
          {title}
        </h2>
        {sub && (
          <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 14, maxWidth: 560 }}>{sub}</p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
