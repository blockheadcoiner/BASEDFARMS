/**
 * Token metadata API route
 *
 * POST /api/metadata  — stores name/symbol/description/image and returns an ID + URL
 * GET  /api/metadata?id=<id> — returns the Metaplex-compatible JSON
 *
 * NOTE: Uses an in-memory Map — data survives only as long as this function instance.
 * For production, replace with Arweave, IPFS, Vercel Blob, or a database.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

interface MetadataRecord {
  name: string;
  symbol: string;
  description: string;
  image: string; // data URI or empty string
  externalUrl?: string;
  attributes?: { trait_type: string; value: string }[];
  extensions?: Record<string, unknown>;
}

// Module-level store — persists within one serverless instance
const store = new Map<string, MetadataRecord>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<MetadataRecord>;

    if (!body.name || !body.symbol) {
      return NextResponse.json({ error: 'name and symbol are required' }, { status: 400 });
    }

    const id = randomUUID();
    store.set(id, {
      name: body.name,
      symbol: body.symbol,
      description: body.description ?? '',
      image: body.image ?? '',
      externalUrl: body.externalUrl,
      attributes: body.attributes,
      extensions: body.extensions,
    });

    // Build public URL — use NEXT_PUBLIC_APP_URL if set, otherwise use request host
    const origin = process.env.NEXT_PUBLIC_APP_URL
      ?? `${req.headers.get('x-forwarded-proto') ?? 'https'}://${req.headers.get('host') ?? 'localhost:3000'}`;
    const url = `${origin}/api/metadata?id=${id}`;

    return NextResponse.json({ id, url });
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const record = store.get(id);
  if (!record) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Return Metaplex-compatible JSON
  return NextResponse.json(
    {
      name: record.name,
      symbol: record.symbol,
      description: record.description,
      image: record.image,
      external_url: record.externalUrl ?? '',
      attributes: record.attributes ?? [],
      extensions: record.extensions ?? {},
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
