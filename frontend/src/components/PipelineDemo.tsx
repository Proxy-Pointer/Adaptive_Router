import React, { useState, useRef, useEffect } from 'react';
import { apiClient, type StepResult, type PlanStepMeta } from '../api/client';
import { TierBadge } from './TierBadge';
import {
  Play, Square, Brain, FileText, Cpu, DollarSign,
  Loader2, CheckCircle2, Circle, AlertCircle, RefreshCw, Zap,
  Search, BarChart2, MessageSquare, FileCheck,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { cacheKey, getCache, setCache } from '../utils/runCache';

// ─── preset queries ───────────────────────────────────────────────────────────
const PRESET_QUERIES = [
  { label: '☁️  Cloud computing benefits',       value: 'What are the main benefits of adopting cloud computing for enterprise businesses, and what are the key risks to consider?' },
  { label: '⚡ Renewable vs fossil energy',       value: 'Compare the long-term economic impacts of renewable energy versus fossil fuels on emerging market economies, including jobs, infrastructure costs, and energy security.' },
  { label: '🤖 AI & labor market disruption',    value: 'Analyze the systemic risks of large-scale AI adoption on the global labor market. Which sectors are most vulnerable and what policy interventions should governments consider?' },
  { label: '⚔️  Autonomous weapons ethics',       value: 'What are the ethical, legal, and geopolitical implications of deploying fully autonomous weapons systems in modern warfare? Assess international governance gaps.' },
  { label: '🔬 ML reproducibility crisis',       value: 'Design a comprehensive framework for assessing the reproducibility crisis in machine learning research. Propose concrete standardization protocols, benchmarking practices, and institutional incentives.' },
];

// ─── agent metadata ───────────────────────────────────────────────────────────
const AGENT_META: Record<string, { label: string; color: string; icon: React.ReactNode; desc: string }> = {
  researcher: { label: 'Researcher', color: '#3b82f6', icon: <Search  style={{ width: '1rem', height: '1rem' }} />, desc: 'Gathers & synthesizes information' },
  analyst:    { label: 'Analyst',    color: '#f59e0b', icon: <BarChart2 style={{ width: '1rem', height: '1rem' }} />, desc: 'Analyses findings & draws conclusions' },
  critic:     { label: 'Critic',     color: '#a78bfa', icon: <MessageSquare style={{ width: '1rem', height: '1rem' }} />, desc: 'Reviews analysis & validates reasoning' },
  reporter:   { label: 'Reporter',   color: '#34d399', icon: <FileCheck style={{ width: '1rem', height: '1rem' }} />, desc: 'Produces final structured report' },
};

const TIER_COLORS: Record<string, string> = { fast: '#22c55e', balanced: '#f59e0b', powerful: '#a78bfa' };

const levelColor = (v: string) =>
  v === 'high' || v === 'large' ? '#a78bfa' : v === 'medium' ? '#fbbf24' : '#34d399';

// ─── pricing (per-token) — must match backend/config/settings.py ─────────────
const PRICES = {
  fast:     { in: 0.25  / 1e6, out: 2.00   / 1e6 },
  balanced: { in: 1.25  / 1e6, out: 10.00  / 1e6 },
  powerful: { in: 15.00 / 1e6, out: 120.00 / 1e6 },
};

function staticCost(steps: StepResult[], tier: 'fast' | 'balanced' | 'powerful') {
  return steps.reduce(
    (acc, s) => acc + s.estimated_input_tokens * PRICES[tier].in + s.estimated_output_tokens * PRICES[tier].out,
    0,
  );
}

// ─── types ────────────────────────────────────────────────────────────────────
type CardState = 'pending' | 'analyzing' | 'done' | 'error';

interface StepCard extends PlanStepMeta {
  state: CardState;
  result?: StepResult;
  error?: string;
}

type AgentStatus = 'waiting' | 'planning' | 'running' | 'done';

interface AgentState {
  name: string;
  status: AgentStatus;
  steps: StepCard[];
  totalCost: number;
}

interface CachedQARun {
  query: string;
  agents: AgentState[];
  totalCost: number;
}

// ─── component ────────────────────────────────────────────────────────────────
export const PipelineDemo: React.FC<{ sharedQuery: string; setSharedQuery: (q: string) => void }> = ({ sharedQuery, setSharedQuery }) => {
  const query    = sharedQuery;
  const setQuery = setSharedQuery;

  const [agents,      setAgents]      = useState<AgentState[]>([]);
  const [running,     setRunning]     = useState(false);
  const [totalCost,   setTotalCost]   = useState<number | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fromCache,   setFromCache]   = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── cache look-up whenever query changes ────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) return;
    const key = cacheKey('qa', query);
    const cached = getCache<CachedQARun>(key);
    if (cached) {
      // Normalize: a cached run is fully complete — force all step states to 'done'
      const normalizedAgents = cached.agents.map((a) => ({
        ...a,
        status: 'done' as const,
        steps: a.steps.map((s) => ({
          ...s,
          state: (s.state === 'done' || s.state === 'error') ? s.state : 'done' as const,
        })),
      }));
      setAgents(normalizedAgents);
      setTotalCost(cached.totalCost);
      setFromCache(true);
      setGlobalError(null);
    } else {
      // No cache for this query — clear previous results so stale data isn't shown
      setAgents([]);
      setTotalCost(null);
      setGlobalError(null);
      setFromCache(false);
    }
  }, [query]);

  // ── helpers ─────────────────────────────────────────────────────────────────
  const updateAgent = (name: string, patch: Partial<AgentState> | ((prev: AgentState) => Partial<AgentState>)) => {
    setAgents((prev) =>
      prev.map((a) => (a.name === name ? { ...a, ...(typeof patch === 'function' ? patch(a) : patch) } : a))
    );
  };

  const updateStep = (agentName: string, stepName: string, patch: Partial<StepCard>) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.name !== agentName) return a;
        return { ...a, steps: a.steps.map((s) => (s.name === stepName ? { ...s, ...patch } : s)) };
      })
    );
  };

  // ── run ─────────────────────────────────────────────────────────────────────
  const handleAnalyze = () => runFresh();

  // ── actual streaming run ─────────────────────────────────────────────────────
  const runFresh = async () => {
    if (!query.trim() || running) return;
    setAgents([]);
    setTotalCost(null);
    setGlobalError(null);
    setFromCache(false);
    setRunning(true);
    abortRef.current = new AbortController();

    // Accumulate final state so we can cache at the end
    let finalAgents: AgentState[] = [];
    let finalCost = 0;

    try {
      await apiClient.streamAnalyze(
        query.trim(),
        (data) => {
          const ev    = data.event as string;
          const agent = data.agent as string | undefined;

          if (ev === 'agent_start' && agent) {
            setAgents((prev) => {
              if (prev.find((a) => a.name === agent)) return prev.map((a) => a.name === agent ? { ...a, status: 'planning' } : a);
              const next = [...prev, { name: agent, status: 'planning' as AgentStatus, steps: [], totalCost: 0 }];
              finalAgents = next;
              return next;
            });
          } else if (ev === 'agent_plan' && agent) {
            const steps: StepCard[] = (data.steps as PlanStepMeta[]).map((s, i) => ({ ...s, state: i === 0 ? 'analyzing' : 'pending' }));
            updateAgent(agent, { status: 'running', steps });
          } else if (ev === 'step_result' && agent) {
            const result = data as unknown as StepResult & { agent: string };
            setAgents((prev) => {
              const next = prev.map((a) => {
                if (a.name !== agent) return a;
                const idx = a.steps.findIndex((s) => s.name === result.name);
                if (idx === -1) return a;
                const steps = a.steps.map((s, i) => {
                  if (i === idx) return { ...s, state: 'done' as CardState, result };
                  if (i === idx + 1) return { ...s, state: 'analyzing' as CardState };
                  return s;
                });
                return { ...a, steps, totalCost: a.totalCost + result.cost_usd };
              });
              finalAgents = next;
              return next;
            });
          } else if (ev === 'step_error' && agent) {
            const stepName = data.name as string;
            updateStep(agent, stepName, { state: 'error', error: data.message as string });
            setAgents((prev) => {
              const next = prev.map((a) => {
                if (a.name !== agent) return a;
                const idx = a.steps.findIndex((s) => s.name === stepName);
                if (idx === -1 || !a.steps[idx + 1]) return a;
                return { ...a, steps: a.steps.map((s, i) => i === idx + 1 ? { ...s, state: 'analyzing' as CardState } : s) };
              });
              finalAgents = next;
              return next;
            });
          } else if (ev === 'agent_done' && agent) {
            // Use functional update so React chains this after any pending step_result updates
            // (avoids clobbering the last step's result when both arrive in the same SSE chunk)
            setAgents((prev) => {
              const next = prev.map((a) =>
                a.name !== agent ? a : {
                  ...a,
                  status: 'done' as const,
                  steps: a.steps.map((s) => ({
                    ...s,
                    state: (s.state === 'done' || s.state === 'error') ? s.state : 'done' as const,
                  })),
                }
              );
              finalAgents = next;
              return next;
            });
          } else if (ev === 'complete') {
            finalCost = data.total_cost as number;
            setTotalCost(finalCost);
            setRunning(false);
            setFromCache(true);
            // Use functional update to read the freshest agents for caching
            setAgents((prev) => {
              setCache<CachedQARun>(cacheKey('qa', query), { query, agents: prev, totalCost: finalCost });
              return prev;
            });
          } else if (ev === 'error') {
            setGlobalError(data.message as string);
            setRunning(false);
          }
        },
        abortRef.current.signal,
      );
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setGlobalError((e as Error).message ?? 'Unknown error');
      setRunning(false);
    }
  };

  const handleStop = () => { abortRef.current?.abort(); setRunning(false); };

  // ── derived ──────────────────────────────────────────────────────────────────
  const allDoneSteps = agents.flatMap((a) => a.steps.filter((s) => s.state === 'done' && s.result).map((s) => s.result!));

  const tierChartData = [
    { name: 'Fast',     value: allDoneSteps.filter((s) => s.tier === 'fast').length,     color: TIER_COLORS.fast },
    { name: 'Balanced', value: allDoneSteps.filter((s) => s.tier === 'balanced').length, color: TIER_COLORS.balanced },
    { name: 'Powerful', value: allDoneSteps.filter((s) => s.tier === 'powerful').length, color: TIER_COLORS.powerful },
  ];

  const adaptiveCost  = totalCost ?? 0;
  const fastCost      = staticCost(allDoneSteps, 'fast');
  const balancedCost  = staticCost(allDoneSteps, 'balanced');
  const powerfulCost  = staticCost(allDoneSteps, 'powerful');

  const costChartData = [
    { name: 'Adaptive', cost: adaptiveCost,  color: '#38bdf8' },
    { name: 'All Fast', cost: fastCost,       color: TIER_COLORS.fast },
    { name: 'All Balanced', cost: balancedCost, color: TIER_COLORS.balanced },
    { name: 'All Powerful', cost: powerfulCost, color: TIER_COLORS.powerful },
  ];

  const savingsVsBalanced = balancedCost > 0 ? ((1 - adaptiveCost / balancedCost) * 100).toFixed(0) : '0';
  const savingsVsPowerful = powerfulCost > 0 ? ((1 - adaptiveCost / powerfulCost) * 100).toFixed(0) : '0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Query input ──────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ borderRadius: '1rem', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Research Query
        </label>

        <select
          disabled={running}
          defaultValue=""
          onChange={(e) => { const v = e.target.value; if (v) setQuery(v); e.target.value = ''; }}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem', outline: 'none', cursor: running ? 'not-allowed' : 'pointer' }}
        >
          <option value="" disabled style={{ background: '#1e293b' }}>— Choose a preset or write your own below —</option>
          {PRESET_QUERIES.map((q) => <option key={q.label} value={q.value} style={{ background: '#1e293b', color: '#f8fafc' }}>{q.label}</option>)}
        </select>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={running}
          rows={3}
          placeholder="e.g. What are the economic impacts of large-scale AI adoption on the labor market?"
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', color: '#fff', fontSize: '0.9375rem', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAnalyze(); }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Main CTA */}
          <button
            onClick={running ? handleStop : handleAnalyze}
            disabled={!query.trim() && !running}
            style={{ background: running ? 'rgba(239,68,68,0.2)' : (query.trim() ? 'var(--accent-color)' : 'rgba(59,130,246,0.3)'), border: running ? '1px solid rgba(239,68,68,0.5)' : 'none', borderRadius: '0.5rem', padding: '0.625rem 1.5rem', color: '#fff', fontSize: '0.9375rem', fontWeight: 600, cursor: (!query.trim() && !running) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'background 0.2s' }}
          >
            {running ? <><Square style={{ width: '1rem', height: '1rem' }} /> Stop</> : fromCache ? <><RefreshCw style={{ width: '1rem', height: '1rem' }} /> Re-run Query</> : <><Play style={{ width: '1rem', height: '1rem' }} /> Analyze Query</>}
          </button>

          {/* Cached indicator (no Re-run button — Analyze always runs fresh) */}
          {fromCache && !running && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '9999px', padding: '0.25rem 0.75rem' }}>
              <Zap style={{ width: '0.75rem', height: '0.75rem' }} /> Cached result
            </span>
          )}

          {!fromCache && !running && <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.2)' }}>⌘ Enter to run</span>}
        </div>
      </div>

      {/* ── Global error ──────────────────────────────────────────────── */}
      {globalError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.75rem', padding: '1rem 1.25rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <AlertCircle style={{ width: '1.25rem', height: '1.25rem', flexShrink: 0 }} /> {globalError}
        </div>
      )}

      {/* ── Agent pipeline ────────────────────────────────────────────── */}
      {agents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {agents.map((agent) => <AgentSection key={agent.name} agent={agent} />)}
        </div>
      )}

      {/* ── Summary ───────────────────────────────────────────────────── */}
      {totalCost !== null && allDoneSteps.length > 0 && (
        <div className="glass-panel fade-in" style={{ borderRadius: '1rem', padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1.6fr', gap: '2rem', alignItems: 'start' }}>

          {/* ── Col 1: Cost by Agent ── */}
          <div>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <DollarSign style={{ width: '1rem', height: '1rem' }} /> Cost by Agent
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {agents.filter((a) => a.totalCost > 0).map((a) => {
                const meta = AGENT_META[a.name];
                return (
                  <div key={a.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: meta?.color ?? '#fff' }}>{meta?.icon} {meta?.label ?? a.name}</span>
                    <span style={{ fontFamily: 'monospace', color: '#fff' }}>${a.totalCost.toFixed(6)}</span>
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', marginTop: '0.25rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontWeight: 700 }}>
                <span style={{ color: '#38bdf8' }}>Total (Adaptive)</span>
                <span style={{ color: '#34d399', fontFamily: 'monospace', fontSize: '1.1rem' }}>${totalCost.toFixed(6)}</span>
              </div>
            </div>
          </div>

          {/* ── Col 2: Tier Distribution chart ── */}
          <div>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu style={{ width: '1rem', height: '1rem' }} /> Tier Distribution
            </h3>
            <div style={{ height: '130px', minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierChartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }} barSize={18}>
                  <XAxis dataKey="name" tick={{ fill: '#ffffff', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: '#1e293b', borderColor: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: '0.5rem', fontSize: '0.8rem' }} formatter={(v) => [`${v} steps`, '']} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {tierChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Col 3: Adaptive vs Static cost chart ── */}
          <div>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart2 style={{ width: '1rem', height: '1rem' }} /> Adaptive vs Static
            </h3>
            <p style={{ fontSize: '0.75rem', color: '#ffffff', marginBottom: '0.5rem', minHeight: '1.2rem' }}>
              {Number(savingsVsBalanced) > 0 && <span>Saves <span style={{ color: '#34d399', fontWeight: 700 }}>{savingsVsBalanced}%</span> vs all-Balanced</span>}
              {Number(savingsVsBalanced) > 0 && Number(savingsVsPowerful) > 0 && <span style={{ color: 'rgba(255,255,255,0.4)' }}> · </span>}
              {Number(savingsVsPowerful) > 0 && <span>Saves <span style={{ color: '#34d399', fontWeight: 700 }}>{savingsVsPowerful}%</span> vs all-Powerful</span>}
            </p>
            <div style={{ height: '130px', minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costChartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }} barSize={18}>
                  <XAxis dataKey="name" tick={{ fill: '#ffffff', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#ffffff', fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${v.toFixed(3)}`}
                    width={44}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    contentStyle={{ background: '#1e293b', borderColor: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: '0.5rem', fontSize: '0.8rem' }}
                    formatter={(v: number) => [`$${v.toFixed(6)}`, 'Cost']}
                  />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                    {costChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

// ─── Agent section ────────────────────────────────────────────────────────────
const AgentSection: React.FC<{ agent: AgentState }> = ({ agent }) => {
  const meta = AGENT_META[agent.name] ?? { label: agent.name, color: '#94a3b8', icon: <Circle style={{ width: '1rem', height: '1rem' }} />, desc: '' };
  const doneCount = agent.steps.filter((s) => s.state === 'done').length;

  const statusIcon =
    agent.status === 'done'     ? <CheckCircle2 style={{ width: '1.25rem', height: '1.25rem', color: '#22c55e' }} />
    : agent.status === 'running'  ? <Loader2 style={{ width: '1.25rem', height: '1.25rem', color: meta.color, animation: 'spin 1s linear infinite' }} />
    : agent.status === 'planning' ? <Loader2 style={{ width: '1.25rem', height: '1.25rem', color: meta.color, animation: 'spin 1s linear infinite' }} />
    : <Circle style={{ width: '1.25rem', height: '1.25rem', color: 'rgba(255,255,255,0.2)' }} />;

  return (
    <div style={{ border: `1px solid ${agent.status === 'waiting' ? 'rgba(255,255,255,0.05)' : `${meta.color}30`}`, borderRadius: '1rem', overflow: 'hidden', transition: 'border-color 0.3s' }}>
      <div style={{ background: `${meta.color}10`, padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: agent.steps.length > 0 ? `1px solid ${meta.color}20` : 'none' }}>
        {statusIcon}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, flexWrap: 'wrap' }}>
          <span style={{ color: meta.color, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>{meta.icon}</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: agent.status === 'waiting' ? 'var(--text-muted)' : '#fff' }}>{meta.label}</span>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{meta.desc}</span>
        </div>
        {agent.status === 'planning' && <span style={{ fontSize: '0.75rem', color: meta.color, fontStyle: 'italic' }}>planning tasks...</span>}
        {agent.status === 'done' && <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>{doneCount} steps · ${agent.totalCost.toFixed(6)}</span>}
      </div>

      {agent.steps.length > 0 && (
        <div style={{ padding: '0.75rem 1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(0,0,0,0.15)' }}>
          {agent.steps.map((step, i) => <StepRow key={step.name} step={step} index={i} agentColor={meta.color} />)}
        </div>
      )}
    </div>
  );
};

// ─── Step row ─────────────────────────────────────────────────────────────────
const StepRow: React.FC<{ step: StepCard; index: number; agentColor: string }> = ({ step, index, agentColor }) => {
  const { state, result, error } = step;

  const stateIcon =
    state === 'done'      ? <CheckCircle2 style={{ width: '1rem', height: '1rem', color: '#22c55e', flexShrink: 0 }} />
    : state === 'analyzing' ? <Loader2 style={{ width: '1rem', height: '1rem', color: agentColor, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
    : state === 'error'     ? <AlertCircle style={{ width: '1rem', height: '1rem', color: '#f87171', flexShrink: 0 }} />
    : <Circle style={{ width: '1rem', height: '1rem', color: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />;

  return (
    <div style={{ background: state === 'analyzing' ? `${agentColor}08` : 'rgba(255,255,255,0.02)', border: `1px solid ${state === 'analyzing' ? `${agentColor}40` : 'rgba(255,255,255,0.05)'}`, borderRadius: '0.75rem', padding: '0.875rem 1.125rem', transition: 'all 0.3s' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', marginBottom: result ? '0.75rem' : 0 }}>
        {stateIcon}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{index + 1}</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: state === 'pending' ? 'var(--text-muted)' : '#fff', fontSize: '0.9rem' }}>{step.name}</span>
            {state === 'analyzing' && <span style={{ fontSize: '0.7rem', color: agentColor }}>analyzing...</span>}
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.5 }}>{step.description}</p>
        </div>
      </div>

      {state === 'error' && error && <div style={{ color: '#f87171', fontSize: '0.8rem', paddingLeft: '1.625rem' }}>{error}</div>}

      {result && (
        <div style={{ paddingLeft: '1.625rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill label="Complexity" value={result.complexity} />
            <Pill label="Reasoning"  value={result.reasoning} />
            <Pill label="Context"    value={result.context_size} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Score <b style={{ color: '#fff' }}>{result.routing_score}/6</b></span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.5, borderLeft: `2px solid ${agentColor}50`, paddingLeft: '0.625rem' }}>
            {result.complexity_explanation}
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Tok label="In"  n={result.estimated_input_tokens} />
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem' }}>→</span>
            <Tok label="Out" n={result.estimated_output_tokens} />
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
              <TierBadge tier={result.tier} model={result.model} />
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: TIER_COLORS[result.tier] ?? '#fff', fontSize: '0.9rem' }}>${result.cost_usd.toFixed(6)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── atoms ────────────────────────────────────────────────────────────────────
const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontWeight: 700, textTransform: 'capitalize', color: levelColor(value), background: `${levelColor(value)}18`, padding: '0.1rem 0.45rem', borderRadius: '9999px' }}>{value}</span>
  </span>
);

const Tok: React.FC<{ label: string; n: number }> = ({ label, n }) => (
  <span style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontFamily: 'monospace', color: '#cbd5e1', background: 'rgba(255,255,255,0.06)', padding: '0.1rem 0.45rem', borderRadius: '0.3rem' }}>{n.toLocaleString()}</span>
  </span>
);
