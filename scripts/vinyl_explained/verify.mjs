// 境界条件・物理挙動の検証テスト
import { CONST, defaultParams } from '../../vinyl_explained/src/params.js';
import { Measurement, computeSnr, goertzelRms } from '../../vinyl_explained/src/analysis.js';

const base = defaultParams();
let fails = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!cond) fails++;
}
const finite = arr => arr.every(Number.isFinite);

// [1] 通常条件: ミストラックなし・出力健全
{
  const res = await new Measurement(base, { dustRate: 0, staticRate: 0 }, 0.25).run();
  check('通常条件で安定トラッキング', res.mistrackPerSec === 0 && res.skipPerSec === 0 && finite(res.outDeL),
    `mistrack=${res.mistrackPerSec}/s skip=${res.skipPerSec}/s`);
}

// [2] 過酷条件 (軽針圧0.6g + 高レベル+10dB + 10kHz + 内周) → ミストラック発生
{
  const res = await new Measurement(base, {
    signalType: 'sine', sineFreq: 10000, levelDb: 10, vtfGram: 0.6,
    radiusMm: 60, dustRate: 0, staticRate: 0,
  }, 0.2).run();
  check('過酷条件でミストラック検出', res.mistrackPerSec > 0 && finite(res.outDeL),
    `mistrack=${res.mistrackPerSec.toFixed(0)}/s skip=${res.skipPerSec.toFixed(1)}/s`);
}

// [3] トレーシングロス: 球針・内周60mmの15kHzは外周146mmより大きく減衰
{
  const mk = r => new Measurement(base, {
    signalType: 'sine', sineFreq: 15000, hfCutoff: 24000, stylusShape: 'spherical',
    rSide: 15e-6, rScan: 15e-6, radiusMm: r, dustRate: 0, staticRate: 0,
  }, 0.2);
  const out146 = goertzelRms((await mk(146).run()).outDeL, 192000, 15000);
  const out60 = goertzelRms((await mk(60).run()).outDeL, 192000, 15000);
  const lossDb = 20 * Math.log10(out60 / out146);
  check('内周トレーシングロス (15kHz球針)', lossDb < -1.5,
    `内周60mm vs 外周146mm: ${lossDb.toFixed(1)} dB`);
}

// [4] 埃: 高率で通過イベントが起き、発散しない
{
  const res = await new Measurement(base, { dustRate: 50, staticRate: 0 }, 0.2).run();
  check('埃通過で発散なし', finite(res.outDeL),
    `dust=${res.groove.dust.length}個生成 skip=${res.skipPerSec.toFixed(1)}/s mistrack=${res.mistrackPerSec.toFixed(0)}/s`);
}

// [5] 静電気: パルスがノイズ測定に現れ、基準速度に対して過大にならない
{
  const quiet = await new Measurement(base, { signalType: 'silence', dustRate: 0, staticRate: 0 }, 0.25).run();
  const popped = await new Measurement(base, { signalType: 'silence', dustRate: 0, staticRate: 80 }, 0.25).run();
  const s1 = computeSnr(quiet).snr, s2 = computeSnr(popped).snr;
  const peakRatio = popped.outDeL.reduce((peak, sample) => {
    const magnitude = sample < 0 ? -sample : sample;
    return magnitude > peak ? magnitude : peak;
  }, 0) / CONST.V_REF;
  check('静電気パルスが有効かつ過大でない',
    popped.sim.staticCount > 0 && s2 < s1 - 3 && peakRatio < 0.12,
    `pops=${popped.sim.staticCount} peak=${peakRatio.toFixed(3)} ref SN ${s1.toFixed(1)}→${s2.toFixed(1)}dB`);
}

// [6] 極端パラメータ耐性 (粗さ100nm + レベル+12dB + 78rpm)
{
  const res = await new Measurement(base, {
    roughSigma: 100e-9, levelDb: 12, rpm: 78, radiusMm: 146,
  }, 0.15).run();
  check('極端条件で数値安定', finite(res.outDeL) && Number.isFinite(res.sim.y),
    `y=${(res.sim.y * 1e6).toFixed(1)}µm mistrack=${res.mistrackPerSec.toFixed(0)}/s`);
}

// [7] 45rpm・楕円/球の両形状で健全動作
{
  for (const shape of ['elliptical', 'spherical']) {
    const res = await new Measurement(base, {
      rpm: 45, stylusShape: shape,
      rScan: shape === 'spherical' ? 15e-6 : 8e-6, rSide: shape === 'spherical' ? 15e-6 : 18e-6,
      dustRate: 0, staticRate: 0,
    }, 0.15).run();
    check(`45rpm ${shape}`, res.skipPerSec === 0 && finite(res.outDeL),
      `mistrack=${res.mistrackPerSec.toFixed(1)}/s`);
  }
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
