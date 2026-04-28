import {
  parseBackExtra,
  parseIpaLine,
  lineTextFromRuns,
  type InlineRun,
  type IpaEntry,
} from '@/common/markdown';

interface RenderBackExtraProps {
  text: string;
}

const MONO_STACK = "'JetBrains Mono', ui-monospace, Menlo, monospace";

function renderInline(runs: InlineRun[], keyPrefix: string) {
  return runs.map((r, i) =>
    r.bold
      ? <strong key={`${keyPrefix}-${i}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.text}</strong>
      : <span key={`${keyPrefix}-${i}`}>{r.text}</span>
  );
}

function IpaLine({ entries, keyPrefix }: { entries: IpaEntry[]; keyPrefix: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px 16px',
        margin: '4px 0 8px',
      }}
    >
      {entries.map((e, ei) => (
        <div
          key={`${keyPrefix}-ipa-${ei}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <span
            style={{
              fontFamily: MONO_STACK,
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              padding: '2px 7px',
              borderRadius: 4,
              border: '1px solid var(--rule-2)',
              color: 'var(--ink-3)',
              background: 'var(--paper)',
              lineHeight: 1.4,
            }}
          >
            {e.region}
          </span>
          <span
            style={{
              fontFamily: MONO_STACK,
              fontSize: 14,
              color: 'var(--ink-2)',
              letterSpacing: 0,
            }}
          >
            {e.ipa}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function RenderBackExtra({ text }: RenderBackExtraProps) {
  const blocks = parseBackExtra(text);
  if (blocks.length === 0) return null;

  return (
    <div
      className="serif"
      style={{
        fontSize: 15,
        lineHeight: 1.55,
        color: 'var(--ink-2)',
        textAlign: 'left',
      }}
    >
      {blocks.map((block, bi) => {
        if (block.type === 'paragraph') {
          return (
            <div key={`p-${bi}`} style={{ marginBottom: 10 }}>
              {block.lines.map((line, li) => {
                const ipa = parseIpaLine(lineTextFromRuns(line));
                if (ipa) {
                  return <IpaLine key={`p-${bi}-l-${li}`} entries={ipa} keyPrefix={`p-${bi}-l-${li}`} />;
                }
                return (
                  <div key={`p-${bi}-l-${li}`}>
                    {renderInline(line, `p-${bi}-l-${li}`)}
                  </div>
                );
              })}
            </div>
          );
        }
        return (
          <ul
            key={`ul-${bi}`}
            style={{
              listStyle: 'disc',
              paddingLeft: 20,
              margin: '6px 0',
            }}
          >
            {block.items.map((item, ii) => (
              <li key={`ul-${bi}-i-${ii}`} style={{ marginBottom: 4 }}>
                <span>{renderInline(item[0] || [], `ul-${bi}-i-${ii}-m`)}</span>
                {item.slice(1).map((cont, ci) => (
                  <div
                    key={`ul-${bi}-i-${ii}-c-${ci}`}
                    style={{
                      marginLeft: 14,
                      color: 'var(--ink-3)',
                      fontStyle: 'italic',
                    }}
                  >
                    {renderInline(cont, `ul-${bi}-i-${ii}-c-${ci}`)}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
