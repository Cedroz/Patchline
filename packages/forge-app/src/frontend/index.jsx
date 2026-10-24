// UI Kit issue panel: stage, culprit commit, repro race, fix candidates with scores + diffs, recent audit trail.
import { invoke } from '@forge/bridge';
import ForgeReconciler, { Button, CodeBlock, Heading, Inline, Link, Lozenge, SectionMessage, Stack, Text } from '@forge/react';
import React, { useEffect, useState } from 'react';

const appearance = (stage) =>
  stage === 'merged' ? 'success' : stage === 'awaiting_approval' ? 'new' : stage === 'escalated' || stage === 'not_reproducible' ? 'removed' : 'inprogress';

function App() {
  const [d, setD] = useState(null);
  const load = () => invoke('getDetail').then(setD);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // live-ish while the tournament runs
    return () => clearInterval(t);
  }, []);

  if (!d) return <Text>Loading Patchline…</Text>;
  if (d.error) return <SectionMessage appearance="information"><Text>{d.error}</Text></SectionMessage>;

  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center">
        <Text>Stage</Text>
        <Lozenge appearance={appearance(d.stage)}>{(d.stage || 'clustered').replace(/_/g, ' ')}</Lozenge>
        {d.mergedSha && <Lozenge appearance="success">fixed in {d.mergedSha.slice(0, 7)}</Lozenge>}
      </Inline>
      {d.note && <Text>{d.note}</Text>}

      {d.repro.length > 0 && (
        <Stack space="space.050">
          <Heading size="small">Repro race</Heading>
          {d.repro.map((r, i) => (
            <Inline key={i} space="space.100">
              <Lozenge appearance={r.result === 'valid' ? 'success' : 'removed'}>{r.result.replace(/_/g, ' ')}</Lozenge>
              <Text>{r.interpretation}</Text>
            </Inline>
          ))}
        </Stack>
      )}

      {d.culprit && (
        <Stack space="space.050">
          <Heading size="small">Culprit (git bisect)</Heading>
          <Text>
            {d.culprit.sha.slice(0, 7)} “{d.culprit.message}”
          </Text>
        </Stack>
      )}

      {d.candidates.length > 0 && (
        <Stack space="space.100">
          <Heading size="small">Fix tournament</Heading>
          {d.candidates.map((c) => (
            <Stack key={c.n} space="space.050">
              <Inline space="space.100">
                <Lozenge appearance={c.winner ? 'success' : c.status === 'failed' || c.status === 'rejected' ? 'removed' : 'default'}>
                  {c.winner ? 'winner' : c.status}
                </Lozenge>
                <Text>
                  #{c.n} {c.strategy} ({c.agent}) · repro {c.repro ? '✓' : '✗'} · suite {c.suite ? '✓' : '✗'} · breakers {c.breakers} · {c.lines} lines
                </Text>
              </Inline>
              {c.winner && <CodeBlock language="diff" text={c.diff} />}
            </Stack>
          ))}
        </Stack>
      )}

      <Stack space="space.050">
        <Heading size="small">Agent trace</Heading>
        {d.audit.map((e, i) => (
          <Text key={i}>
            {e.agent} · {e.action}
            {e.reasoning ? ` — ${e.reasoning}` : ''}
          </Text>
        ))}
      </Stack>
      <Inline space="space.100">
        <Button onClick={load}>Refresh</Button>
        {d.dashboard && (
          <Link href={d.dashboard} openNewTab>
            Open in Patchline
          </Link>
        )}
      </Inline>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
