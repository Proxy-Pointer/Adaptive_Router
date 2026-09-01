const BASE_URL = 'http://localhost:8000/api';

export interface RouteRequest {
  agent: string;
  task: string;
}

export interface RouterResult {
  complexity: string;
  reasoning: string;
  context_size: string;
  routing_score: number;
  tier: string;
  model: string;
  routing_reason: string;
  estimated_input_tokens?: number;
  estimated_output_tokens?: number;
  cost_usd?: number;
}

export interface StepResult {
  name: string;
  description: string;
  complexity: string;
  reasoning: string;
  complexity_explanation: string;
  context_size: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  routing_score: number;
  tier: string;
  model: string;
  cost_usd: number;
}

export interface PlanStepMeta {
  name: string;
  description: string;
}

export interface PlanRouteResult {
  steps: StepResult[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  recommended_tier: string;
  recommended_model: string;
  max_routing_score: number;
}

export const apiClient = {
  routeTask: async (req: RouteRequest): Promise<RouterResult> => {
    const res = await fetch(`${BASE_URL}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error('Routing failed');
    return res.json();
  },

  planRoute: async (req: { agent: string; query: string }): Promise<PlanRouteResult> => {
    const res = await fetch(`${BASE_URL}/plan-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Plan-route failed: ${res.status}`);
    return res.json();
  },

  streamAnalyze: async (
    query: string,
    onEvent: (data: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore */ }
        }
      }
    }
  },
  streamPlanRoute: async (
    req: { agent: string; query: string },
    onEvent: (data: Record<string, unknown>) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}/plan-route/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignore */ }
        }
      }
    }
  },
};
