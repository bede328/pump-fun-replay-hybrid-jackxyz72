# Pump.fun Replay Hybrid — Paper Bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/bede328/pump-fun-replay-hybrid-jackxyz72/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/bede328/pump-fun-replay-hybrid-jackxyz72/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

Hybrid pump.fun paper trading bot. It paper-trades 10 SOL on a replay of pump.fun bonding-curve data: it buys only launches with exactly two distinct non-creator buyers, real reserves of at least 4.5 SOL, a creator buy of at most 1.2 SOL, and age 0–40 slots — then confirms strength with a light run-up / net-flow check and pyramids winners with adds of 0.5 SOL (up to 6 adds, +0.5% step). Exits are mechanical: +22.5% take-profit, −15% stop-loss, 3% trailing stop armed at +15%, 45-slot max hold. Grade-local on the dev window: +0.692 SOL net PnL, 91 fills, 23 mints, 43.5% win rate, 3.68% max drawdown.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
