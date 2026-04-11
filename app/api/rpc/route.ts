export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) {
    return Response.json({ error: 'RPC_URL not configured' }, { status: 500 });
  }

  const body = await req.json();
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return Response.json(data, { status: res.status });
}
