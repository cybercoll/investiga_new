import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const label = searchParams.get('label') || 'metric';
  const message = searchParams.get('message') || 'n/a';
  const color = searchParams.get('color') || 'blue';
  const labelColor = searchParams.get('labelColor') || undefined;
  const namedLogo = searchParams.get('namedLogo') || undefined;

  const data: Record<string, any> = {
    schemaVersion: 1,
    label,
    message,
    color,
  };
  if (labelColor) data.labelColor = labelColor;
  if (namedLogo) data.namedLogo = namedLogo;

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}