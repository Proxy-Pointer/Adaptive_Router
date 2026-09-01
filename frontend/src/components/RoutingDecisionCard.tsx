import React from 'react';
import type { RouterResult } from '../api/client';
import { TierBadge } from './TierBadge';
import { Activity, Brain, FileText, Target } from 'lucide-react';

const levelColor = (level: string) =>
  level === 'high' || level === 'large' ? '#a78bfa'
  : level === 'medium' ? '#fbbf24'
  : '#34d399';

export const RoutingDecisionCard: React.FC<{ decision: RouterResult | null; isLoading?: boolean }> = ({ decision, isLoading }) => {
  if (isLoading) {
    return (
      <div className="glass-panel" style={{ borderRadius: '1rem', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '320px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
          <Target style={{ width: '2rem', height: '2rem', color: 'var(--accent-color)', animation: 'spin 1s linear infinite' }} />
          <p style={{ fontSize: '0.9rem' }}>Classifying task & estimating tokens...</p>
        </div>
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="glass-panel" style={{ borderRadius: '1rem', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '320px', color: 'var(--text-muted)', textAlign: 'center' }}>
        Enter a task description to see the routing decision
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ borderRadius: '1rem', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
        Router Decision
      </h3>

      {/* Metrics */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {[
          { icon: <Activity style={{ width: '1rem', height: '1rem' }} />, label: 'Complexity', value: decision.complexity },
          { icon: <Brain    style={{ width: '1rem', height: '1rem' }} />, label: 'Reasoning',  value: decision.reasoning },
          { icon: <FileText style={{ width: '1rem', height: '1rem' }} />, label: 'Context',    value: decision.context_size },
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.625rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              {row.icon} {row.label}
            </span>
            <span style={{ fontWeight: 600, textTransform: 'capitalize', color: levelColor(row.value ?? '') }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Score */}
      <div>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.25rem' }}>Score</span>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.25rem' }}>
          <span style={{ fontSize: '2rem', fontWeight: 700, color: '#fff' }}>{decision.routing_score}</span>
          <span style={{ color: 'var(--text-muted)', marginBottom: '0.35rem' }}>/ 6</span>
        </div>
      </div>

      {/* Token estimates */}
      {decision.estimated_input_tokens != null && (
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.625rem 0.75rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Input tokens</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>{decision.estimated_input_tokens?.toLocaleString()}</span>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.625rem 0.75rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>Output tokens</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>{decision.estimated_output_tokens?.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Model + cost */}
      <div>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.5rem' }}>Selected Model</span>
        <TierBadge tier={decision.tier} model={decision.model} />
      </div>

      {decision.cost_usd != null && (
        <div style={{ background: 'rgba(52,211,153,0.08)', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(52,211,153,0.2)' }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Estimated cost</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#34d399', fontSize: '1rem' }}>${decision.cost_usd.toFixed(6)}</span>
        </div>
      )}

      <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.8125rem', color: '#cbd5e1', fontStyle: 'italic', borderLeft: '2px solid var(--accent-color)' }}>
        "{decision.routing_reason}"
      </div>
    </div>
  );
};
