import React, { useState, useRef, useEffect } from 'react';
import { apiClient, type StepResult } from '../api/client';
import { TierBadge } from './TierBadge';
import { Network, CheckCircle2, Loader2, DollarSign, Play, Square, Zap, AlertCircle, Circle } from 'lucide-react';
import { cacheKey, getCache, setCache } from '../utils/runCache';
import type { PlanRouteResult } from '../api/client';

const agents = ['researcher', 'analyst', 'critic', 'reporter'];

const PRESET_QUERIES = [
  { label: '☁️  Cloud computing benefits',    value: 'What are the main benefits of adopting cloud computing for enterprise businesses, and what are the key risks to consider?' },
  { label: '⚡ Renewable vs fossil energy',    value: 'Compare the long-term economic impacts of renewable energy versus fossil fuels on emerging market economies, including jobs, infrastructure costs, and energy security.' },
  { label: '🤖 AI & labor market disruption', value: 'Analyze the systemic risks of large-scale AI adoption on the global labor market. Which sectors are most vulnerable and what policy interventions should governments consider?' },
  { label: '⚔️  Autonomous weapons ethics',    value: 'What are the ethical, legal, and geopolitical implications of deploying fully autonomous weapons systems in modern warfare? Assess international governance gaps.' },
  { label: '🔬 ML reproducibility crisis',    value: 'Design a comprehensive framework for assessing the reproducibility crisis in machine learning research. Propose concrete standardization protocols, benchmarking practices, and institutional incentives.' },
];

const TIER_COLORS: Record<string, string> = { fast: '#22c55e', balanced: '#f59e0b', powerful: '#a78bfa' };

const levelColor = (v: string) =>
  v === 'high' || v === 'large' ? '#a78bfa' : v === 'medium' ? '#fbbf24' : '#34d399';

type CardState = 'pending' | 'analyzing' | 'done' | 'error';

interface StepCard {
  name: string;
  description: string;
  state: CardState;
  result?: StepResult;
  error?: string;
}

interface Summary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  recommended_tier: string;
  recommended_model: string;
  max_routing_score: number;
}

export const RouterPlayground: React.FC<{ sharedQuery: string; setSharedQuery: (q: string) => void }> = ({ sharedQuery, setSharedQuery }) => {
  const [agent, setAgent] = useState('researcher');
  const task = sharedQuery;
  const setTask = setSharedQuery;

  const [steps, setSteps]       = useState<StepCard[]>([]);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [running, setRunning]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── restore from cache whenever query or agent changes ───────────────────────
  useEffect(() => {
    if (!task.trim()) return;
    const key = cacheKey('playground', task, agent);
    const cached = getCache<PlanRouteResult>(key);
    if (cached) {
      setSteps(cached.steps.map(s => ({ ...s, state: 'done' as CardState, result: s })));
      setSummary({
        total_input_tokens: cached.total_input_tokens,
        total_output_tokens: cached.total_output_tokens,
        total_cost: cached.total_cost,
        recommended_tier: cached.recommended_tier,
        recommended_model: cached.recommended_model,
        max_routing_score: cached.max_routing_score,
      });
      setFromCache(true);
      setError(null);
    } else {
      setFromCache(false);
      setSteps([]);
      setSummary(null);
    }
  }, [task, agent]);

  const handleRun = async () => {
    if (!task.trim() || running) return;
    setSteps([]);
    setSummary(null);
    setError(null);
    setFromCache(false);
    setRunning(true);
    abortRef.current = new AbortController();

    // Accumulate for cache
    const finalSteps: StepResult[] = [];

    try {
      await apiClient.streamPlanRoute(
        { agent, query: task.trim() },
        (data) => {
          const ev = data.event as string;

          if (ev === 'plan') {
            const planSteps = data.steps as { name: string; description: string }[];
            setSteps(planSteps.map((s, i) => ({
              ...s,
              state: i === 0 ? 'analyzing' : 'pending',
            })));
          } else if (ev === 'step_result') {
            const result = data as unknown as StepResult;
            finalSteps.push(result);
            setSteps(prev => {
              const idx = prev.findIndex(s => s.name === result.name);
              if (idx === -1) return prev;
              return prev.map((s, i) => {
                if (i === idx) return { ...s, state: 'done' as CardState, result };
                if (i === idx + 1) return { ...s, state: 'analyzing' as CardState };
                return s;
              });
            });
          } else if (ev === 'step_error') {
            const name = data.name as string;
            setSteps(prev => {
              const idx = prev.findIndex(s => s.name === name);
              if (idx === -1) return prev;
              return prev.map((s, i) => {
                if (i === idx) return { ...s, state: 'error' as CardState, error: data.message as string };
                if (i === idx + 1) return { ...s, state: 'analyzing' as CardState };
                return s;
              });
            });
          } else if (ev === 'complete') {
            const s: Summary = {
              total_input_tokens: data.total_input_tokens as number,
              total_output_tokens: data.total_output_tokens as number,
              total_cost: data.total_cost as number,
              recommended_tier: data.recommended_tier as string,
              recommended_model: data.recommended_model as string,
              max_routing_score: data.max_routing_score as number,
            };
            setSummary(s);
            setRunning(false);
            setFromCache(true);
            // cache the result
            const cachePayload: PlanRouteResult = {
              steps: finalSteps,
              total_input_tokens: s.total_input_tokens,
              total_output_tokens: s.total_output_tokens,
              total_cost: s.total_cost,
              recommended_tier: s.recommended_tier,
              recommended_model: s.recommended_model,
              max_routing_score: s.max_routing_score,
            };
            setCache(cacheKey('playground', task, agent), cachePayload);
          } else if (ev === 'error') {
            setError(data.message as string);
            setRunning(false);
          }
        },
        abortRef.current.signal,
      );
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message ?? 'Unknown error');
      setRunning(false);
    }
  };

  const handleStop = () => { abortRef.current?.abort(); setRunning(false); };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>

      {/* ── Input panel ─────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ borderRadius: '1rem', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ background: 'rgba(59,130,246,0.2)', padding: '0.5rem', borderRadius: '0.5rem' }}>
            <Network style={{ width: '1.25rem', height: '1.25rem', color: 'var(--accent-color)' }} />
          </div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#fff', margin: 0 }}>Single-Agent Router</h2>
        </div>

        {/* Agent selector */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
            Agent
          </label>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            disabled={running}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.625rem 1rem', color: '#fff', fontSize: '0.9375rem', outline: 'none', cursor: running ? 'not-allowed' : 'pointer' }}
          >
            {agents.map(a => <option key={a} value={a} style={{ background: '#1e293b' }}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
          </select>
        </div>

        {/* Task */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
            Query
          </label>
          <select
            disabled={running}
            defaultValue=""
            onChange={(e) => { const v = e.target.value; if (v) setTask(v); e.target.value = ''; }}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem', outline: 'none', cursor: running ? 'not-allowed' : 'pointer', marginBottom: '0.5rem' }}
          >
            <option value="" disabled style={{ background: '#1e293b' }}>— Choose a preset or write below —</option>
            {PRESET_QUERIES.map((q) => <option key={q.label} value={q.value} style={{ background: '#1e293b', color: '#f8fafc' }}>{q.label}</option>)}
          </select>

          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            disabled={running}
            rows={4}
            placeholder="Describe the research query..."
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', color: '#fff', fontSize: '0.9rem', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6 }}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            Generates the agent's real sub-tasks, then routes and costs each one — streamed live.
          </p>
        </div>

        {error && (
          <div style={{ color: '#f87171', fontSize: '0.875rem', background: 'rgba(239,68,68,0.1)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle style={{ width: '1rem', height: '1rem', flexShrink: 0 }} /> {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={running ? handleStop : handleRun}
            disabled={!task.trim() && !running}
            style={{ flex: '0 0 auto', background: running ? 'rgba(239,68,68,0.2)' : (task.trim() ? 'var(--accent-color)' : 'rgba(59,130,246,0.3)'), border: running ? '1px solid rgba(239,68,68,0.5)' : 'none', borderRadius: '0.5rem', padding: '0.75rem 1.5rem', color: '#fff', fontSize: '0.9375rem', fontWeight: 600, cursor: !task.trim() && !running ? 'not-allowed' : 'pointer', transition: 'background 0.2s', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {running
              ? <><Square style={{ width: '1rem', height: '1rem' }} /> Stop</>
              : fromCache
                ? <><Play style={{ width: '1rem', height: '1rem' }} /> Re-run</>
                : <><Play style={{ width: '1rem', height: '1rem' }} /> Route Task →</>
            }
          </button>

          {fromCache && !running && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '9999px', padding: '0.25rem 0.75rem' }}>
              <Zap style={{ width: '0.75rem', height: '0.75rem' }} /> Cached result
            </span>
          )}
        </div>
      </div>

      {/* ── Result panel ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {steps.length === 0 && !running && (
          <div className="glass-panel" style={{ borderRadius: '1rem', padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', minHeight: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Select an agent and enter a query, then click Route Task →
          </div>
        )}

        {steps.map((step, i) => <StepCard key={step.name} step={step} index={i} />)}

        {/* Summary */}
        {summary && (
          <div className="glass-panel fade-in" style={{ borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', border: '1px solid rgba(52,211,153,0.2)' }}>
            <h3 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <DollarSign style={{ width: '0.875rem', height: '0.875rem' }} /> Summary — {agent.charAt(0).toUpperCase() + agent.slice(1)} Agent
            </h3>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <Stat label="Total Input" value={summary.total_input_tokens.toLocaleString() + ' tok'} />
              <Stat label="Total Output" value={summary.total_output_tokens.toLocaleString() + ' tok'} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {(['fast', 'balanced', 'powerful'] as const).map(tier => {
                const count = steps.filter(s => s.result?.tier === tier).length;
                if (!count) return null;
                const colors: Record<string, string> = { fast: '#22c55e', balanced: '#f59e0b', powerful: '#a78bfa' };
                return (
                  <span key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: `${colors[tier]}18`, border: `1px solid ${colors[tier]}40`, borderRadius: '9999px', padding: '0.2rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, color: colors[tier] }}>
                    {count}× {tier.charAt(0).toUpperCase() + tier.slice(1)}
                  </span>
                );
              })}
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 700, color: '#34d399', fontSize: '1.1rem' }}>${summary.total_cost.toFixed(6)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Step card ───────────────────────────────────────────────────────────────
const StepCard: React.FC<{ step: { name: string; description: string; state: string; result?: StepResult; error?: string }; index: number }> = ({ step, index }) => {
  const { state, result, error } = step;

  const stateIcon =
    state === 'done'      ? <CheckCircle2 style={{ width: '1rem', height: '1rem', color: '#22c55e', flexShrink: 0 }} />
    : state === 'analyzing' ? <Loader2 style={{ width: '1rem', height: '1rem', color: 'var(--accent-color)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
    : state === 'error'     ? <AlertCircle style={{ width: '1rem', height: '1rem', color: '#f87171', flexShrink: 0 }} />
    : <Circle style={{ width: '1rem', height: '1rem', color: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />;

  return (
    <div className="glass-panel" style={{ borderRadius: '0.875rem', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.625rem', border: `1px solid ${state === 'analyzing' ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.07)'}`, background: state === 'analyzing' ? 'rgba(59,130,246,0.04)' : undefined, transition: 'all 0.3s' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
        {stateIcon}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{index + 1}</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.875rem', color: state === 'pending' ? 'var(--text-muted)' : '#fff' }}>{step.name}</span>
            {state === 'analyzing' && <span style={{ fontSize: '0.7rem', color: 'var(--accent-color)' }}>analyzing...</span>}
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem', lineHeight: 1.5 }}>{step.description}</p>
        </div>
      </div>

      {state === 'error' && error && <div style={{ color: '#f87171', fontSize: '0.8rem', paddingLeft: '1.625rem' }}>{error}</div>}

      {result && (
        <>
          {/* Badges */}
          <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center', paddingLeft: '1.625rem' }}>
            {[['Complexity', result.complexity], ['Reasoning', result.reasoning], ['Context', result.context_size]].map(([l, v]) => (
              <span key={l} style={{ fontSize: '0.75rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{l}</span>
                <span style={{ fontWeight: 700, textTransform: 'capitalize', color: levelColor(v), background: `${levelColor(v)}18`, padding: '0.1rem 0.4rem', borderRadius: '9999px' }}>{v}</span>
              </span>
            ))}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Score <b style={{ color: '#fff' }}>{result.routing_score}/6</b></span>
          </div>

          {/* Explanation */}
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.5, paddingLeft: '1.625rem', borderLeft: '2px solid rgba(255,255,255,0.1)', marginLeft: '1.625rem' }}>
            {result.complexity_explanation}
          </p>

          {/* Tokens + model + cost */}
          <div style={{ paddingLeft: '1.625rem', display: 'flex', gap: '0.875rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Tok label="In" n={result.estimated_input_tokens} />
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.7rem' }}>→</span>
            <Tok label="Out" n={result.estimated_output_tokens} />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.875rem', alignItems: 'center' }}>
              <TierBadge tier={result.tier} model={result.model} />
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: TIER_COLORS[result.tier] ?? '#fff', fontSize: '0.875rem' }}>${result.cost_usd.toFixed(6)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ─── atoms ───────────────────────────────────────────────────────────────────
const Tok: React.FC<{ label: string; n: number }> = ({ label, n }) => (
  <span style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontFamily: 'monospace', color: '#cbd5e1', background: 'rgba(255,255,255,0.06)', padding: '0.1rem 0.45rem', borderRadius: '0.3rem' }}>{n.toLocaleString()}</span>
  </span>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</div>
    <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>{value}</div>
  </div>
);
