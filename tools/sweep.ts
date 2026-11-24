// Sweep strategy params over the dev window with the local sim (tools/sim.ts).
//
//   node tools/sweep.ts --kit <kit> '<grid json: {"key":[v1,v2],...}>' [top N]
//
// Prints top rows by net PnL with halves, mints, fills, maxDD and net ex-top-3 coins,
// so a setting that only wins through a few lucky coins stands out.

import { simulate } from './sim.ts';
import { DEFAULT_PARAMS, type Params } from '../strategy.ts';

const args = process.argv.slice(2);
const get = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const kit = get('--kit') ?? '/home/hatch/workspace/makefun/kits/pump-fun-jackxyz72';
const gridJson = args.find((a) => a.startsWith('{')) ?? '{}';
const topN = Number(args[args.length - 1] && !args[args.length - 1]!.startsWith('{') && !args[args.length - 1]!.startsWith('-') ? args[args.length - 1] : 15);
const grid = JSON.parse(gridJson) as Record<string, unknown[]>;
const keys = Object.keys(grid);
const combos: Record<string, unknown>[] = [{}];
for (const k of keys) {
  const next: Record<string, unknown>[] = [];
  for (const c of combos) for (const v of grid[k]!) next.push({ ...c, [k]: v });
  combos.splice(0, combos.length, ...next);
}
console.error(`sweeping ${combos.length} combos over ${kit}`);
interface Row {
  c: Record<string, unknown>;
  net: number;
  h1: number;
  h2: number;
  mints: number;
  fills: number;
  dd: number;
  ex3: number;
  wins: number;
}
const rows: Row[] = [];
for (const c of combos) {
  const params = { ...DEFAULT_PARAMS, ...c } as Params;
  const r = simulate(kit, params);
  const vals = [...r.perMint.values()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const top3 = vals.slice(0, 3).reduce((s, v) => s + v, 0n);
  const wins = vals.filter((v) => v > 0n).length;
  rows.push({
    c,
    net: Number(r.net) / 1e9,
    h1: Number(r.halves[0]) / 1e9,
    h2: Number(r.halves[1]) / 1e9,
    mints: r.mints,
    fills: r.fills,
    dd: r.maxDD,
    ex3: Number(r.net - top3) / 1e9,
    wins,
  });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows.slice(0, topN)) {
  console.log(
    `net ${r.net.toFixed(3)}  h1 ${r.h1.toFixed(3)} h2 ${r.h2.toFixed(3)}  exTop3 ${r.ex3.toFixed(3)}  mints ${r.mints} fills ${r.fills} wins ${r.wins} dd ${r.dd.toFixed(3)}  ${JSON.stringify(r.c)}`,
  );
}
