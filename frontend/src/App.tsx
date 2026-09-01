import React, { useState } from 'react';
import { RouterPlayground } from './components/RouterPlayground';
import { PipelineDemo } from './components/PipelineDemo';
import { Cpu, Layers, TestTube } from 'lucide-react';

export default function App() {
  // Drive active tab from URL hash so a hard-refresh always lands on the correct default.
  const hashTab = window.location.hash === '#playground' ? 'playground' : 'pipeline';
  const [activeTab, setActiveTab] = useState<'pipeline' | 'playground'>(hashTab);

  const switchTab = (tab: 'pipeline' | 'playground') => {
    setActiveTab(tab);
    window.location.hash = tab === 'playground' ? 'playground' : '';
  };
  const [sharedQuery, setSharedQuery] = useState('');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-color)', color: 'var(--text-main)', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>

        {/* ── Header ────────────────────────────────────────────── */}
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          height: '4rem', marginBottom: '2rem',
          borderBottom: '1px solid var(--border-color)',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ background: 'var(--accent-color)', borderRadius: '0.5rem', width: '2rem', height: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(56,189,248,0.35)' }}>
              <Layers style={{ color: '#fff', width: '1.125rem', height: '1.125rem' }} />
            </div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#fff', margin: 0 }}>
              Adaptive Agent Router
            </h1>
          </div>

          {/* Tab nav */}
          <nav style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.05)', padding: '0.3rem', borderRadius: '0.6rem', border: '1px solid var(--border-color)' }}>
            {([
              { id: 'playground',  label: 'Playground',     icon: <TestTube style={{ width: '0.9rem', height: '0.9rem' }} /> },
              { id: 'pipeline',    label: 'Query Analyzer', icon: <Cpu     style={{ width: '0.9rem', height: '0.9rem' }} /> },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.45rem',
                  padding: '0.45rem 1.1rem', borderRadius: '0.4rem',
                  fontSize: '0.875rem', fontWeight: 500, border: 'none', cursor: 'pointer',
                  transition: 'all 0.18s',
                  background: activeTab === tab.id ? 'var(--accent-color)' : 'transparent',
                  color:      activeTab === tab.id ? '#fff' : 'var(--text-muted)',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </nav>
        </header>

        {/* ── Main — BOTH mounted, one hidden, so state is preserved ── */}
        <main>
          <div style={{ display: activeTab === 'pipeline'   ? 'block' : 'none' }}>
            <PipelineDemo sharedQuery={sharedQuery} setSharedQuery={setSharedQuery} />
          </div>
          <div style={{ display: activeTab === 'playground' ? 'block' : 'none' }}>
            <RouterPlayground sharedQuery={sharedQuery} setSharedQuery={setSharedQuery} />
          </div>
        </main>

        <footer style={{ textAlign: 'center', fontSize: '0.8rem', color: 'rgba(255,255,255,0.18)', padding: '2rem 0 1rem' }}>
          Built with React · FastAPI · Gemini 3.1 Flash Lite
        </footer>

      </div>
    </div>
  );
}
