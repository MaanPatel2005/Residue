import { NextRequest, NextResponse } from 'next/server';

interface StoredCorrelation {
  id: string;
  userId: string;
  acousticProfile: unknown;
  productivitySnapshot: unknown;
  createdAt: number;
}

const correlationStore: StoredCorrelation[] = [];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userId, acousticProfile, productivitySnapshot } = body;

  const correlation: StoredCorrelation = {
    id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: userId || 'anon',
    acousticProfile,
    productivitySnapshot,
    createdAt: Date.now(),
  };

  correlationStore.push(correlation);

  if (correlationStore.length > 1000) {
    correlationStore.splice(0, correlationStore.length - 1000);
  }

  return NextResponse.json({ success: true, id: correlation.id });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || 'anon';
  const limit = parseInt(searchParams.get('limit') || '100');

  const userCorrelations = correlationStore
    .filter((c) => c.userId === userId)
    .slice(-limit);

  return NextResponse.json(userCorrelations);
}
