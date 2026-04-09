export const PLATFORM_FEE_BPS = 30;
export const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';

export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot?: number;
  timeTaken?: number;
}

export interface SwapRequest {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  feeAccount?: string;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number | 'auto';
}

export interface TokenPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number = 50
): Promise<QuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
    platformFeeBps: PLATFORM_FEE_BPS.toString(),
  });

  const res = await fetch(`${JUPITER_API_BASE}/quote?${params}`);

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Jupiter quote failed (${res.status}): ${error}`);
  }

  return res.json() as Promise<QuoteResponse>;
}

export async function getSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string,
  feeAccount?: string
): Promise<string> {
  const body: SwapRequest = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: 'auto',
    ...(feeAccount ? { feeAccount } : {}),
  };

  const res = await fetch(`${JUPITER_API_BASE}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Jupiter swap failed (${res.status}): ${error}`);
  }

  const data = await res.json() as { swapTransaction: string };
  return data.swapTransaction;
}

export async function getTokenPrice(mint: string): Promise<TokenPrice> {
  const params = new URLSearchParams({ ids: mint });

  const res = await fetch(`https://price.jup.ag/v4/price?${params}`);

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Jupiter price fetch failed (${res.status}): ${error}`);
  }

  const data = await res.json() as { data: Record<string, TokenPrice> };

  const price = data.data[mint];
  if (!price) {
    throw new Error(`No price data found for mint: ${mint}`);
  }

  return price;
}
