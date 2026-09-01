import React from 'react';

const tierConfig: Record<string, { bg: string; text: string; border: string }> = {
  fast:     { bg: 'rgba(34,197,94,0.15)',  text: '#22c55e', border: 'rgba(34,197,94,0.4)' },
  balanced: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: 'rgba(245,158,11,0.4)' },
  powerful: { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa', border: 'rgba(139,92,246,0.4)' },
};

export const TierBadge: React.FC<{ tier: string; model?: string }> = ({ tier, model }) => {
  const cfg = tierConfig[tier.toLowerCase()] ?? { bg: 'rgba(255,255,255,0.1)', text: '#94a3b8', border: 'rgba(255,255,255,0.2)' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{
        padding: '0.125rem 0.5rem',
        fontSize: '0.75rem',
        fontWeight: 700,
        borderRadius: '9999px',
        background: cfg.bg,
        color: cfg.text,
        border: `1px solid ${cfg.border}`,
        letterSpacing: '0.04em',
      }}>
        {tier.toUpperCase()}
      </span>
      {model && <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>{model}</span>}
    </div>
  );
};
