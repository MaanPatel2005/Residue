'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PhoneStateInferenceDTO {
  label: 'glance' | 'off_task' | 'break_needed' | 'unknown';
  probabilities: Record<
    'glance' | 'off_task' | 'break_needed' | 'unknown',
    number
  >;
  penaltyScore: number;
  inferenceMs: number;
  executionProvider: string;
  modelVersion: string;
}

export interface PhoneEventDTO {
  sessionId: string;
  userId: string;
  type: 'open' | 'close' | 'heartbeat';
  timestamp: number;
  durationMs?: number;
  inference?: PhoneStateInferenceDTO;
}

export interface PhoneReportDTO {
  sessionId: string;
  userId: string;
  summary: string;
  perCategoryMinutes: Record<string, number>;
  modelKey: string;
  inferenceMs: number;
  promptTokens: number;
  completionTokens: number;
  createdAt: number;
}

export interface PhoneStateDTO {
  paired: boolean;
  sessionId: string;
  openCount: number;
  totalDistractionMs: number;
  lastOpenAt: number | null;
  lastInference: PhoneStateInferenceDTO | null;
  productivityPenalty: number;
  events: PhoneEventDTO[];
  report: PhoneReportDTO | null;
}

export interface PairingDTO {
  code: string;
  sessionId: string;
  expiresAt: number;
}

const POLL_INTERVAL_MS = 5_000;

export function usePhoneCompanion(
  token: string | null,
  sessionId: string | null,
) {
  const [pairing, setPairing] = useState<PairingDTO | null>(null);
  const [state, setState] = useState<PhoneStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPairing = useCallback(async () => {
    if (!token || !sessionId) return;
    try {
      const res = await fetch('/api/pair/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as PairingDTO;
      setPairing(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'pairing failed');
    }
  }, [token, sessionId]);

  const refreshState = useCallback(async () => {
    if (!token || !sessionId) return;
    try {
      const res = await fetch(
        `/api/phone/state?sessionId=${encodeURIComponent(sessionId)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as PhoneStateDTO;
      setState(data);
    } catch {
      // swallow — best-effort polling
    }
  }, [token, sessionId]);

  useEffect(() => {
    if (!token || !sessionId) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      queueMicrotask(() => setState(null));
      return;
    }
    queueMicrotask(() => {
      void refreshState();
    });
    timerRef.current = setInterval(() => {
      void refreshState();
    }, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [token, sessionId, refreshState]);

  const reset = useCallback(() => {
    setPairing(null);
    setState(null);
    setError(null);
  }, []);

  return { pairing, state, error, startPairing, refreshState, reset };
}
