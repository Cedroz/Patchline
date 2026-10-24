// Minimal unified-diff viewer.
export function Diff({ diff, max = 400 }: { diff: string; max?: number }) {
  if (!diff) return <p className="muted">No diff.</p>;
  const lines = diff.split('\n').slice(0, max);
  return (
    <pre className="diff">
      {lines.map((l, i) => {
        const cls = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'meta' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
        return (
          <div key={i} className={cls}>
            {l || ' '}
          </div>
        );
      })}
    </pre>
  );
}
