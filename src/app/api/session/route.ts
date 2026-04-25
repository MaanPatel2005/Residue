import { NextRequest, NextResponse } from 'next/server';

const sessions = new Map<string, {
  id: string;
  userId: string;
  startTime: number;
  endTime?: number;
  correlations: unknown[];
  mode: string;
}>();

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userId, mode } = body;

  const session = {
    id: `session-${Date.now()}`,
    userId: userId || 'anon',
    startTime: Date.now(),
    correlations: [],
    mode: mode || 'focus',
  };

  sessions.set(session.id, session);

  return NextResponse.json(session);
}

export async function GET() {
  const allSessions = Array.from(sessions.values());
  return NextResponse.json(allSessions);
}
