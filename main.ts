// Hybrid pump.fun replay bot (variant D) — entrypoint.
// Run by the grader as `node /bot/main.ts`. The strategy lives in strategy.ts, the
// protocol in the vendored SDK shim (vendor/agentfun-bot.ts, a byte-identical copy of
// the kit's sdk/ts/makefun-bot.ts).

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onHello(state) {
    // state.hello carries the run's seed, caps and fees; the strategy is a pure
    // function of the batches, so nothing is seeded or configured here. Every
    // decision below is deterministic: the same hello + batch stream always
    // produces the same orders.
    void state.hello.seed;
  },
  onBatch: (state, batch) => strategy.onBatch(state, batch),
  onDone(state) {
    // Final account only; diagnostics go to stderr, never stdout (stdout is the
    // reply channel). state.slot is the last batch slot seen.
    console.error(`done: batches=${state.seq + 1} cash=${state.cash} positions=${state.positions.size}`);
  },
});
