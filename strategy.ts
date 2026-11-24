// Hybrid pump.fun replay bot (variant D): variant A sniper filter + light strength
// confirmation + pyramiding into strength.
//
// Entry filter (from variant A's winning core): a launch qualifies only while young
// (age <= maxAge slots) with EXACTLY minBuyers..maxBuyers distinct non-creator buyers,
// real SOL reserves >= minRealSol, creator's own create-slot buy <= maxDevBuy, and the
// creator must not have sold yet. On top of that, the first buy needs a light strength
// confirmation measured at decision time — either the price has already run up at least
// minRunupBps from create, or the recent net flow is at least minFlowLamports — so we
// do not buy a coin whose tape is already dead, but we do not wait for a big move either
// (the confirmation window is the same young age window, so a runner that never confirms
// simply ages out and is skipped).
//
// Once in, the bot pyramids: while the position is alive it adds (up to maxAdds times,
// each addLamports) only when the price sits at least addStepBps above the previous buy's
// decision price AND the recent net flow is still positive (>= addMinFlowLamports). Adds
// never chase a falling coin.
//
// Exits: take profit at tpBps over cost, stop loss at slBps under cost, a trailing stop
// that arms at trailArmBps and trails trailBps off the best marked value, a hard maxHold
// in slots, and an immediate exit when the creator sells while we hold. A pure function
// of the batches it is fed: no clock, no randomness, no I/O.

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** Lamports of the first buy. */
  stakeLamports: number;
  /** Lamports per pyramid add. */
  addLamports: number;
  /** Pyramid adds after the first buy (0 = no adds). */
  maxAdds: number;
  /** An add needs the price at least this far (bps) above the previous buy's decision price. */
  addStepBps: number;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** An add needs the recent net flow at least this many lamports. */
  addMinFlowLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** Creator's own buys in the create slot: at most this many lamports. */
  maxDevBuy: number;
  /** Distinct non-creator buyers seen before entry: exactly this band. */
  minBuyers: number;
  maxBuyers: number;
  /** Price now over the create price, as bps: the confirmation window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** The recent-flow window (slots) and what it must show for a first buy. */
  flowWindow: number;
  minFlowLamports: number;
  minRecentBuyers: number;
  /** Creator sold before entry: skip the coin. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Exit when the position is worth this much over its cost (bps). */
  tpBps: number;
  /** Exit when it is worth this much under its cost (bps). */
  slBps: number;
  /** First take-profit: sell tp1PartBps of the position once it is worth tp1Bps over its cost. */
  tp1Bps: number;
  tp1PartBps: number;
  /** After the first take-profit, the rest also exits in full at this much over its cost (bps). */
  tp2Bps: number;
  /** Trailing stop: once up at least trailArmBps, exit on a fall of trailBps from the best value. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 40,
  stakeLamports: 500_000_000,
  addLamports: 500_000_000,
  maxAdds: 6,
  addStepBps: 50,
  addDelay: 2,
  addMinFlowLamports: 0,
  minRealSol: 4_500_000_000,
  maxRealSol: 1_000_000_000_000,
  maxDevBuy: 1_200_000_000,
  minBuyers: 2,
  maxBuyers: 2,
  minRunupBps: 0,
  maxRunupBps: 1_000_000,
  flowWindow: 10,
  minFlowLamports: 0,
  minRecentBuyers: 0,
  skipDevSold: true,
  buySlippageBps: 10_000,
  tpBps: 2250,
  slBps: 1500,
  tp1Bps: 1_000_000,
  tp1PartBps: 5000,
  slAfterTp1Bps: 0,
  tp2Bps: 1_000_000,
  trailArmBps: 1500,
  trailBps: 300,
  maxHold: 45,
  exitOnDevSell: true,
  staleSlots: 1_000_000,
};

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Create-time reserves: the price run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  trades: number;
  buyers: Set<Pubkey>;
  devSold: boolean;
  lastTradeSlot: number;
  /** Trades of the last flowWindow slots (older ones dropped as new ones come). */
  recent: Tick[];
  buysSent: number;
  /** Decision price (vq/vt as a pair) of the last buy sent. */
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  lastBuySlot: number;
  /** Never buy it again (exited, filtered out for good, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  tookTp1: boolean;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

const FEE_BPS = 125n;

/** What selling `tokens` against (vq, vt) would pay after curve fees (protocol + creator, 95 + 30 bps). */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Strategy {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell in flight. */
  const selling = new Set<Pubkey>();
  const stake = BigInt(P.stakeLamports);

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          vq0: BigInt(e.virtual_quote_reserves),
          vt0: BigInt(e.virtual_token_reserves),
          devBuy: 0n,
          trades: 0,
          buyers: new Set(),
          devSold: false,
          lastTradeSlot: e.slot,
          recent: [],
          buysSent: 0,
          lastBuyVq: 0n,
          lastBuyVt: 1n,
          lastBuySlot: 0,
          done: false,
          complete: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        c.trades += 1;
        c.lastTradeSlot = e.slot;
        c.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        const isDev = e.user === c.creator;
        if (e.is_buy) {
          if (isDev && e.slot === c.createSlot) c.devBuy += sol;
          else if (!isDev) c.buyers.add(e.user);
        } else if (isDev) {
          c.devSold = true;
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }
  }

  /** Net lamports bought minus sold and the distinct buyers, over the last flowWindow slots. */
  function flow(c: Coin, slot: number): { net: bigint; buyers: number } {
    const from = slot - P.flowWindow;
    let drop = 0;
    while (drop < c.recent.length && c.recent[drop]!.slot <= from) drop++;
    if (drop > 0) c.recent.splice(0, drop);
    let net = 0n;
    const buyers = new Set<Pubkey>();
    for (const t of c.recent) {
      if (t.isBuy) {
        net += t.sol;
        if (t.user !== c.creator) buyers.add(t.user);
      } else net -= t.sol;
    }
    return { net, buyers: buyers.size };
  }

  function hasPendingBuy(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'buy') return true;
    return false;
  }

  function hasPendingSell(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'sell') return true;
    return false;
  }

  return {
    onBatch(state, batch) {
      readEvents(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), best: 0n, tookTp1: false });
        }
      }
      for (const mint of [...selling]) if (!hasPendingSell(state, mint)) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPendingBuy(state, mint)) held.delete(mint);
      }

      // Exits first: every held position is re-marked each batch and sold whole on any trigger.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, tookTp1: false };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
        const basis = pos.cost_lamports + h.txPaid;
        if (value > h.best) h.best = value;
        let exit = false;
        if (basis > 0n) {
          // Partial take-profit: bank half at tp1, let the rest ride with a
          // breakeven-or-better stop and the trailing stop.
          if (!h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tp1Bps))) {
            const part = (pos.token_amount * BigInt(P.tp1PartBps)) / BPS;
            if (part > 0n && part < pos.token_amount) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
              selling.add(mint);
              h.tookTp1 = true;
              h.best = 0n;
              continue;
            }
          }
          if (!h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tpBps))) exit = true;
          if (h.tookTp1 && value * BPS >= basis * (BPS + BigInt(P.tp2Bps))) exit = true;
          const sl = h.tookTp1 ? BigInt(P.slAfterTp1Bps) : BigInt(P.slBps);
          if (value * BPS <= basis * (BPS - sl)) exit = true;
          if (h.best * BPS >= basis * (BPS + BigInt(P.trailArmBps)) && value * BPS <= h.best * (BPS - BigInt(P.trailBps))) exit = true;
        }
        if (state.slot - h.openedSlot >= P.maxHold) exit = true;
        if (c !== undefined) {
          if (P.exitOnDevSell && c.devSold) exit = true;
          if (state.slot - c.lastTradeSlot >= P.staleSlots) exit = true;
        }
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // Entries and pyramid adds.
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let open = state.committedPositionCount();
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        const age = state.slot - c.createSlot;
        const isAdd = c.buysSent > 0;
        if (!isAdd && age > P.maxAge) {
          c.done = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (isAdd) {
          if (c.buysSent > P.maxAdds) continue;
          if (!state.positions.has(c.mint) || selling.has(c.mint) || hasPendingBuy(state, c.mint)) continue;
        } else if (open >= state.hello.caps.max_open_positions) {
          continue;
        }
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        if (c.devSold && P.skipDevSold) {
          if (!isAdd) c.done = true;
          continue;
        }
        const vq = curve.virtual_quote_reserves;
        const vt = curve.virtual_token_reserves;
        if (isAdd) {
          // Pyramid only into strength: price above the last buy and flow still positive.
          if (state.slot - c.lastBuySlot < P.addDelay) continue;
          if (vq * c.lastBuyVt * BPS < c.lastBuyVq * vt * BigInt(10_000 + P.addStepBps)) continue;
          if (flow(c, state.slot).net < BigInt(P.addMinFlowLamports)) continue;
          const maxAdd = state.maxBuyLamports(c.mint);
          const amount = BigInt(P.addLamports) < maxAdd ? BigInt(P.addLamports) : maxAdd;
          if (amount < 10_000_000n || free < amount + tx) continue;
          orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
          free -= amount + tx;
          c.buysSent += 1;
          c.lastBuyVq = vq;
          c.lastBuyVt = vt;
          c.lastBuySlot = state.slot;
          continue;
        }
        // Rug filter (variant A core).
        const rq = curve.real_quote_reserves;
        if (rq < BigInt(P.minRealSol) || rq > BigInt(P.maxRealSol)) continue;
        if (c.devBuy > BigInt(P.maxDevBuy)) continue;
        if (c.buyers.size < P.minBuyers || c.buyers.size > P.maxBuyers) continue;
        // Light strength confirmation: run-up from create, or recent net flow.
        const runup = (vq * c.vt0 * BPS) / (vt * c.vq0);
        if (runup > BigInt(P.maxRunupBps) || runup < BigInt(P.minRunupBps)) continue;
        const fl = flow(c, state.slot);
        if (fl.net < BigInt(P.minFlowLamports) || fl.buyers < P.minRecentBuyers) continue;
        const maxBuy = state.maxBuyLamports(c.mint);
        const amount = stake < maxBuy ? stake : maxBuy;
        if (amount < 10_000_000n) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + tx;
        c.buysSent += 1;
        c.lastBuyVq = vq;
        c.lastBuyVt = vt;
        c.lastBuySlot = state.slot;
        open += 1;
      }
      return orders;
    },
  };
}
