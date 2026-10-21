// ============================================================================
// physics.js — 針・カンチレバー・アームの力学 (SI単位, 半陰的オイラー法)
//
// モデル:
//  - チップ実効質量 m (x,y 2自由度) — 溝断面内の運動
//  - カンチレバー: ばね k=1/コンプライアンス + ダンパ (チップ⇔アーム間)
//  - アーム実効質量 M (低域共振 ~10Hz が自然に現れる), 針圧F_tはアームに印加
//  - 溝壁との接触: Winkler弾性基礎(バネのベッド)モデル
//      F = k_f·∫max(0, δ(z))dz,  k_f = (E*/√2)·√(R_eff/r_scan)
//    球面プロファイルに対し3D Hertz F=(4/3)E*√R_eff·δ^1.5 と静特性が厳密一致。
//    接触パッチ内のミクロ粗さは積分で自然に平均化される — 実物でも接触圧
//    (~0.4GPa) がPVC降伏応力(~80MPa)を超えミクロ凸部が潰れるのと同じ物理。
//    針先の進行方向曲率(rScan)の放物線サグにより
//    トレーシングロス/ピンチ効果も自然に再現。
//    減衰はKelvin-Voigt粘弾性基礎: F = k_f·(I + τ·dI/dt), I=∫δ⁺dz。
//    τはPVCの粘弾性損失(tanδ)に対応し、接触共振(~40kHz)でζ≈0.25となる。
//  - 摩擦: 溝進行方向のみ(z自由度は拘束)のため診断値としてのみ計算
//  - 静電気: 機械系ではなく電気的パルスとして出力信号に加算(実物理に忠実)
//
// 検証済みオーダー: 針圧2g → 壁面法線力≈14mN, 接触圧≈0.4GPa,
//   接触共振≈40kHz, カンチレバー静的たわみ≈0.3mm, アーム共振≈12Hz
// ============================================================================
import { CONST, hertzK, vtfNewton } from './params.js?v=20260706-sigma13-cache';
import { makeRng } from './dsp.js?v=20260706-sigma13-cache';
import { N_L, N_R, U_L, U_R } from './groove.js?v=20260706-sigma13-cache';

// The discharge range is referenced to program peaks at +12 dB.
const STATIC_REFERENCE_GAIN = 0.251188643150958;
// An ESD edge is much faster than the audio rate. Its audible residual is limited here
// by the longest RC decay in a standard 47 kOhm / 100-200 pF moving-magnet input.
const PHONO_INPUT_RESISTANCE = 47e3;
const PHONO_INPUT_CAPACITANCE = 200e-12;
const STATIC_DECAY_SECONDS = PHONO_INPUT_RESISTANCE * PHONO_INPUT_CAPACITANCE;
const STATIC_LIFETIME_SECONDS = 12 * STATIC_DECAY_SECONDS;

const NSCAN = 25; // 走査窓のサンプル数 (窓±6.4µm → 間隔~0.53µm)

export class StylusSim {
  constructor(params, groove, seed = 777) {
    this.p = params;
    this.groove = groove;
    this.dt = CONST.PHYS_DT;
    this.grooveVel = groove.dzSig * CONST.FS; // 溝線速度 [m/s]
    this.kH = hertzK(params); // 静的着座の計算用 (Winklerと静特性一致)
    // Winkler基礎の線剛性 [N/m²]: 球面でHertzと厳密一致するよう校正
    const rEff = params.stylusShape === 'spherical'
      ? params.rSide : Math.sqrt(params.rSide * params.rScan);
    this.kF = (CONST.PVC_ESTAR / Math.SQRT2) * Math.sqrt(rEff / params.rScan);
    this.Ft = vtfNewton(params);
    this.kC = 1 / params.compliance;
    this.cC = 2 * params.dampZeta * Math.sqrt(this.kC * params.tipMass);
    this.cArm = 0.5; // アーム微小粘性 (軸受+空気, 数値安定用) [N·s/m]

    // 走査窓 (接触パッチ + 信号による移動を十分カバー)
    this.scanHalf = 0.8 * params.rScan;
    this.scanPts = new Float64Array(NSCAN);
    for (let j = 0; j < NSCAN; j++) {
      this.scanPts[j] = (j / (NSCAN - 1) * 2 - 1) * this.scanHalf;
    }
    this.scanDz = this.scanPts[1] - this.scanPts[0]; // 積分刻み

    // 静電気
    this.staticRng = makeRng(seed);
    this.pops = []; // {t0, amp}
    this.staticFlash = 0; // 描画通知用 (メインが読んで消費)
    this.staticCount = 0;
    // イベント率スケール: 通常は1。検証用にだけ発生率を明示加速できる。
    this.eventRateScale = 1;

    // 指数減衰統計 (τ=50msレコード時間, 192kHzサンプルで更新):
    //   sL/sR: 理想変位(信号)  nL/nR: 追従誤差  j: 接触点の時間ゆらぎ
    const mkStat = () => ({ m: 0, v: 0 });
    this.stats = { sL: mkStat(), sR: mkStat(), nL: mkStat(), nR: mkStat(), j: mkStat() };
    this.statAlpha = (CONST.PHYS_SUBSTEPS * CONST.PHYS_DT) / 0.05;
    this.zcL = 0; this.zcR = 0;

    // カウンタ・診断
    this.mistrackCount = 0;
    this.skipCount = 0;
    this.contactLossT = 0;
    this.inLossEpisode = false;
    this.skipHoldoff = 0; // 針飛び直後の再カウント抑止 [s] (1つの傷=1イベント)
    this.diag = { FL: 0, FR: 0, dL: 0, dR: 0, pressL: 0, pressR: 0, fric: 0 };

    // 出力 (192kHzサンプル) コールバック: (vLp, vRp, s, t)
    this.onOutput = null;
    this.subCount = 0;
    this.outAccumL = 0;
    this.outAccumR = 0;
    this.outAccumN = 0;

    this.s = 0;      // 溝パターン座標 [m]
    this.t = 0;      // レコード時間 [s]
    this.reseat();
    this.dPrevL = 0; this.dPrevR = 0;     // 診断用 δ0
    this.iPrevL = null; this.iPrevR = null; // Kelvin-Voigt用 ∫δ⁺
  }

  // 静的平衡で溝に着座
  reseat() {
    const p = this.p;
    const N = this.Ft / Math.SQRT2;              // 各壁の法線力
    const d0 = Math.pow(N / this.kH, 2 / 3);     // 静的めり込み
    this.x = 0;
    this.y = Math.SQRT2 * (p.rSide - d0);
    this.vx = 0; this.vy = 0;
    this.xa = 0;
    this.ya = this.y - this.Ft / this.kC;        // ばね予圧 (たわみ ≈0.3mm)
    this.vxa = 0; this.vya = 0;
    this.restY = this.y;
  }

  // 1壁の接触計算 (Winkler弾性基礎):
  //   δ(dz) = 壁面変位(s+dz) − dz²/(2·rScan) + (rSide − D)
  //   integ = ∫max(0,δ)ddz (台形近似),  delta0 = max δ (診断/判定用)
  //   zc = 圧力分布の重心オフセット [m] — 読取点の時間ゆらぎ(ジッタ)の源
  wallContact(wall, D) {
    const g = this.groove, s = this.s, r2 = 2 * this.p.rScan;
    const base = this.p.rSide - D;
    let raw = 0, delta0 = -Infinity, zsum = 0;
    for (let j = 0; j < NSCAN; j++) {
      const dz = this.scanPts[j];
      let d = base + g.wallShift(wall, s + dz) - (dz * dz) / r2;
      if (d > delta0) delta0 = d;
      if (d > 0) {
        if (d > 5e-6) d = 5e-6; // 深埋没クランプ (埃衝突時の数値安全)
        raw += d;
        zsum += d * dz;
      }
    }
    return { integ: raw * this.scanDz, delta0, zc: raw > 0 ? zsum / raw : 0 };
  }

  // n物理ステップ進める
  step(nSteps) {
    const { dt, kF, p } = this;
    const m = p.tipMass, M = p.armMass;
    const tau = p.kvTau;
    const g = this.groove;

    for (let i = 0; i < nSteps; i++) {
      // 溝を進める (先読み分も生成保証)
      this.s += this.grooveVel * dt;
      this.t += dt;
      if ((i & 63) === 0) g.ensure(this.s + this.scanHalf + g.spawnAhead * 2 + 4 * g.dzSig);

      // --- 接触力 (Winkler弾性基礎) ---
      const DL = this.x * N_L.x + this.y * N_L.y;  // 左壁面(無変調)までの距離
      const DR = this.x * N_R.x + this.y * N_R.y;
      // 埃の塑性圧縮: 針底面が実際に押し込んだ場所・深さで埃を恒久変形させる
      if (g.activeDust.length) {
        g.plasticCrush(0, this.s, p.rSide - DL, p.rScan, this.scanHalf);
        g.plasticCrush(1, this.s, p.rSide - DR, p.rScan, this.scanHalf);
      }
      const cL = this.wallContact(0, DL);
      const cR = this.wallContact(1, DR);
      const dL = cL.delta0, dR = cR.delta0;
      this.dPrevL = dL; this.dPrevR = dR;
      this.zcL = cL.zc; this.zcR = cR.zc;

      // Kelvin-Voigt: F = k_f·(I + τ·İ), F ≥ 0 (引張は伝えない)
      if (this.iPrevL === null) { this.iPrevL = cL.integ; this.iPrevR = cR.integ; }
      const iLdot = (cL.integ - this.iPrevL) / dt;
      const iRdot = (cR.integ - this.iPrevR) / dt;
      this.iPrevL = cL.integ; this.iPrevR = cR.integ;
      let FL = kF * (cL.integ + tau * iLdot);
      let FR = kF * (cR.integ + tau * iRdot);
      if (FL < 0 || cL.integ <= 0) FL = 0;
      if (FR < 0 || cR.integ <= 0) FR = 0;

      // --- カンチレバーばね+ダンパ ---
      const Fsx = this.kC * (this.xa - this.x) + this.cC * (this.vxa - this.vx);
      const Fsy = this.kC * (this.ya - this.y) + this.cC * (this.vya - this.vy);

      // --- チップ運動 (半陰的オイラー) ---
      const Fx = FL * N_L.x + FR * N_R.x + Fsx;
      const Fy = FL * N_L.y + FR * N_R.y + Fsy;
      this.vx += (Fx / m) * dt;
      this.vy += (Fy / m) * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // --- アーム運動 (反力 + 針圧) ---
      this.vxa += ((-Fsx - this.cArm * this.vxa) / M) * dt;
      this.vya += ((-Fsy - this.Ft - this.cArm * this.vya) / M) * dt;
      this.xa += this.vxa * dt;
      this.ya += this.vya * dt;

      // --- ミストラッキング/針飛び判定 ---
      // ミストラック = いずれかの壁の接触が30µs超抜ける (可聴歪みの発生条件)
      const anyLoss = dL <= 0 || dR <= 0;
      if (anyLoss) {
        this.contactLossT += dt;
        if (!this.inLossEpisode && this.contactLossT > 30e-6) {
          this.inLossEpisode = true;
          this.mistrackCount++;
        }
      } else {
        this.contactLossT = 0;
        this.inLossEpisode = false;
      }
      // 針飛び = 針先底面が盤面(ランド)を6µm以上越える (ジャンプ/ポップ) or 横逸脱
      if (this.skipHoldoff > 0) this.skipHoldoff -= dt;
      if (this.y - p.rSide > CONST.GROOVE_DEPTH + 6e-6 ||
          Math.abs(this.x) > CONST.GROOVE_HALF_WIDTH * 2) {
        if (this.skipHoldoff <= 0) {
          this.skipCount++;
          this.skipHoldoff = 1.5e-3;
        }
        this.reseat();
      }

      this.diag.FL = FL; this.diag.FR = FR;
      this.diag.dL = dL; this.diag.dR = dR;

      // --- 静電気パルス (電気系イベント, Poisson) ---
      if (p.staticRate > 0 && this.staticRng() < p.staticRate * dt * this.eventRateScale) {
        this.pops.push({
          t0: this.t,
          amp: (0.5 + 2.5 * this.staticRng()) * CONST.V_REF * STATIC_REFERENCE_GAIN *
            (this.staticRng() < 0.5 ? -1 : 1),
        });
        this.staticFlash = 1;
        this.staticCount++;
        if (this.pops.length > 16) this.pops.shift();
      }

      // --- 出力サンプリング用の簡易アンチエイリアス ---
      // 物理は3.84MHzで動くため、非線形接触で生じる高次高調波をそのまま
      // 192kHzへ間引くと可聴帯へ折り返す。1サンプル区間を平均してから出力する。
      if (this.onOutput) {
        // カートリッジは速度比例発電: チップ速度を45/45で復号
        let vLp = this.vx * U_L.x + this.vy * U_L.y;
        let vRp = this.vx * U_R.x + this.vy * U_R.y;
        // 静電気ポップ (電気パルス, MMフォノ入力のRC減衰)
        for (let k = this.pops.length - 1; k >= 0; k--) {
          const P = this.pops[k];
          const dtp = this.t - P.t0;
          if (dtp > STATIC_LIFETIME_SECONDS) { this.pops.splice(k, 1); continue; }
          const e = P.amp * Math.exp(-dtp / STATIC_DECAY_SECONDS);
          vLp += e; vRp += e;
        }
        this.outAccumL += vLp;
        this.outAccumR += vRp;
        this.outAccumN++;
      }

      // --- 出力サンプリング (192kHz) ---
      if (++this.subCount >= CONST.PHYS_SUBSTEPS) {
        this.subCount = 0;

        // 指数減衰統計: S=理想変位, N=追従誤差(実針−理想), J=読取点時間ゆらぎ
        {
          const st = this.stats, al = this.statAlpha;
          const shL = g.signalShift(0, this.s), shR = g.signalShift(1, this.s);
          const ix = shL * N_L.x + shR * N_R.x;
          const iy = this.restY + shL * N_L.y + shR * N_R.y;
          const ex = this.x - ix, ey = this.y - iy;
          const upd = (o, x) => {
            const d = x - o.m;
            o.m += al * d;
            o.v += al * (d * d - o.v);
          };
          upd(st.sL, shL); upd(st.sR, shR);
          upd(st.nL, ex * U_L.x + ey * U_L.y);
          upd(st.nR, ex * U_R.x + ey * U_R.y);
          upd(st.j, 0.5 * (this.zcL + this.zcR) / this.grooveVel);
        }
        if (this.onOutput) {
          const nOut = Math.max(1, this.outAccumN);
          this.onOutput(this.outAccumL / nOut, this.outAccumR / nOut, this.s, this.t);
          this.outAccumL = 0;
          this.outAccumR = 0;
          this.outAccumN = 0;
        }
        g.advanceDust(this.s, CONST.PHYS_SUBSTEPS * dt, this.grooveVel, this.eventRateScale);
      }
    }

    // 診断値 (HUD用): 接触圧 p_mean = F/(πa²), a=√(R·δ)
    const d = this.diag;
    d.pressL = d.dL > 0 ? d.FL / (Math.PI * this.p.rSide * d.dL) : 0;
    d.pressR = d.dR > 0 ? d.FR / (Math.PI * this.p.rSide * d.dR) : 0;
    d.fric = this.p.mu * (d.FL + d.FR);
  }
}
