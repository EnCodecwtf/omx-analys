// Elliottvågor. Räkningen görs på ZigZag-svängarna och testar alla mönster
// som slutar i den senaste (obekräftade) svängen:
//
//   impuls 0-1-2        våg 2 pågår
//   impuls 0-1-2-3      våg 3 pågår
//   impuls 0-1-2-3-4    våg 4 pågår
//   impuls 0-..-5       våg 5 pågår eller klar
//   S-X-A-B-C           ABC-korrektion mot benet S->X
//
// i båda riktningarna. Varje kandidat måste följa Elliotts hårda regler
// (våg 2 bryter inte start, våg 3 är inte kortast, våg 4 överlappar inte
// våg 1). Kandidaterna poängsätts efter hur väl förhållandena stämmer med
// vanliga Fibonacci-relationer, och den med högst poäng används.

const fit = (x, targets, tol) =>
  Math.max(0, ...targets.map(t => 1 - Math.abs(x - t) / tol));

const round = x => Math.round(x * 100) / 100;

function evalImpulse(P, d) {
  const v = P.map(p => p.price * d);
  const n = P.length;
  const lastTentative = !!P[n - 1].tentative;
  const fits = [];
  const notes = [];
  const W1 = v[1] - v[0];
  if (W1 <= 0) return null;

  // Våg 2
  if (!(v[2] > v[0])) return null;
  const r2 = (v[1] - v[2]) / W1;
  if (r2 < 0.2 || r2 >= 1) return null;
  fits.push(fit(r2, [0.5, 0.618], 0.3));
  notes.push(`Våg 2 rekylerade ${Math.round(r2 * 100)} % av våg 1`);

  let W3, W5;
  if (n >= 4) {
    if (!(v[3] > v[1])) return null;
    W3 = v[3] - v[2];
    const r3 = W3 / W1;
    if (!(lastTentative && n === 4)) {
      fits.push(fit(r3, [1.618, 1.0, 2.618], 0.6));
    }
    notes.push(`Våg 3 = ${r3.toFixed(2)} × våg 1`);
  }
  if (n >= 5) {
    if (!(v[4] > v[1])) return null; // ingen överlappning med våg 1
    const r4 = (v[3] - v[4]) / W3;
    if (r4 >= 1) return null;
    fits.push(fit(r4, [0.382, 0.236, 0.5], 0.25));
    notes.push(`Våg 4 rekylerade ${Math.round(r4 * 100)} % av våg 3`);
    // Alternering: djup våg 2 brukar följas av grund våg 4 och tvärtom.
    fits.push((r2 > 0.5) !== (r4 > 0.5) ? 1 : 0.5);
    if (W3 < W1) notes.push('Våg 3 kortare än våg 1 – våg 5 får inte bli längre än våg 3');
  }
  if (n >= 6) {
    W5 = v[5] - v[4];
    if (!(v[5] > v[3]) && !lastTentative) return null;
    if (W3 < W1 && W3 < W5) return null; // våg 3 får inte vara kortast
    if (!lastTentative) fits.push(fit(W5 / W1, [1.0, 0.618, 1.618], 0.4));
    notes.push(`Våg 5 = ${(W5 / W1).toFixed(2)} × våg 1`);
  }

  // Våg 0 ska vara den lägsta punkten i hela mönstret.
  if (Math.min(...v) !== v[0]) return null;
  return { fits, notes, W1, W3, W5, v };
}

function evalABC(P, d) {
  // P = [S, X, A, B, C]. Med d = 1 är S -> X ett ben uppåt och A-B-C en
  // korrektion nedåt.
  const v = P.map(p => p.price * d);
  const leg = v[1] - v[0];
  const A = v[1] - v[2];
  if (leg <= 0 || A <= 0) return null;
  const rB = (v[3] - v[2]) / A;
  if (rB <= 0.2 || rB >= 1) return null; // B ska inte gå över X
  const C = v[3] - v[4];
  if (C <= 0) return null;
  const retr = (v[1] - v[4]) / leg;
  if (retr >= 1) return null; // korrektionen bryter inte benets start
  const lastTentative = !!P[4].tentative;
  const fits = [
    fit(rB, [0.5, 0.618, 0.786], 0.35),
    fit(retr, [0.5, 0.618, 0.382], 0.25),
  ];
  if (!lastTentative) fits.push(fit(C / A, [1.0, 1.618, 0.618], 0.4));
  // Benet före korrektionen ska vara klart större än korrektionens delar.
  if (leg < A * 1.2) return null;
  return {
    fits, v, A, leg,
    notes: [
      `B rekylerade ${Math.round(rB * 100)} % av A`,
      `C = ${(C / A).toFixed(2)} × A`,
      `Korrektionen har tagit tillbaka ${Math.round(retr * 100)} % av benet före`,
    ],
  };
}

const PHASES = {
  'bull:3': { phase: 'w2', label: 'Våg 2 (rekyl) i en ny uppåtimpuls', bias: 1, setup: true,
    text: 'Rekylen efter våg 1 kan vara ett köpläge inför våg 3, som oftast är den starkaste vågen.' },
  'bull:4': { phase: 'w3', label: 'Våg 3 uppåt pågår', bias: 1, setup: false,
    text: 'Stark trendfas. Köp hellre på nästa rekyl (våg 4) än att jaga priset.' },
  'bull:5': { phase: 'w4', label: 'Våg 4 (rekyl) i en uppåtimpuls', bias: 1, setup: true,
    text: 'Rekylen kan ge ett köpläge inför den sista vågen upp (våg 5).' },
  'bull:6': { phase: 'w5', label: 'Våg 5 uppåt – sen fas', bias: 0, setup: false,
    text: 'Uppgången är mogen. Ta hem vinst i målzonen och räkna med en ABC-korrektion därefter.' },
  'bull:abc': { phase: 'C', label: 'ABC-korrektion nedåt i en upptrend', bias: 1, setup: true,
    text: 'Korrektionen närmar sig sitt slut i våg C. Det är ett klassiskt köpläge om stödet håller.' },
  'bear:3': { phase: 'w2', label: 'Våg 2 (studs) i en nedåtimpuls', bias: -1, setup: false,
    text: 'Studsen kan vara en rekyl före ett nytt ras (våg 3). Undvik köp.' },
  'bear:4': { phase: 'w3', label: 'Våg 3 nedåt pågår', bias: -1, setup: false,
    text: 'Stark nedåtfas. Vänta med köp.' },
  'bear:5': { phase: 'w4', label: 'Våg 4 (studs) i en nedåtimpuls', bias: -1, setup: false,
    text: 'Studsen kan följas av en sista våg ned (våg 5).' },
  'bear:6': { phase: 'w5', label: 'Våg 5 nedåt – nedgången är mogen', bias: 1, setup: true,
    text: 'Fem vågor ned är snart klara. Därefter brukar en korrektion uppåt komma, ett möjligt motsignalsköp.' },
  'bear:abc': { phase: 'C', label: 'ABC-studs uppåt i en nedtrend', bias: -1, setup: false,
    text: 'Studsen kan vara klar snart och nedtrenden fortsätta.' },
};

function buildImpulse(P, d, r) {
  const n = P.length;
  const p = x => x * d; // tillbaka till pris
  const { v, W1, W3 } = r;
  const out = { zone: null, invalidation: null, targets: [] };
  if (n === 3) {
    out.zone = [p(v[1] - W1 * 0.786), p(v[1] - W1 * 0.5)];
    out.invalidation = P[0].price;
    out.targets = [
      { label: 'Våg 3 = 1,0 × våg 1', price: p(v[2] + W1) },
      { label: 'Våg 3 = 1,618 × våg 1', price: p(v[2] + W1 * 1.618) },
      { label: 'Våg 3 = 2,618 × våg 1', price: p(v[2] + W1 * 2.618) },
    ];
  } else if (n === 4) {
    out.invalidation = P[1].price;
    out.targets = [
      { label: 'Våg 3 = 1,618 × våg 1', price: p(v[2] + W1 * 1.618) },
      { label: 'Våg 3 = 2,618 × våg 1', price: p(v[2] + W1 * 2.618) },
    ];
  } else if (n === 5 || n === 6) {
    if (n === 5) out.zone = [p(Math.max(v[3] - W3 * 0.5, v[1])), p(v[3] - W3 * 0.236)];
    out.invalidation = P[1].price;
    const cap = W3 < W1 ? v[4] + W3 : Infinity;
    out.targets = [
      { label: 'Våg 5 = 0,618 × våg 1', price: p(Math.min(v[4] + W1 * 0.618, cap)) },
      { label: 'Våg 5 = våg 1', price: p(Math.min(v[4] + W1, cap)) },
      { label: 'Våg 5 = 0,618 × (våg 0–3)', price: p(Math.min(v[4] + (v[3] - v[0]) * 0.618, cap)) },
    ];
    // När våg 5 pågår är målzonen för våg 5 den intressanta zonen.
    if (n === 6) out.zone = [Math.min(...out.targets.map(t => t.price)), Math.max(...out.targets.map(t => t.price))];
  }
  if (out.zone) out.zone.sort((a, b) => a - b);
  out.targets.sort((a, b) => (a.price - b.price) * d);
  return out;
}

function buildABC(P, d, r) {
  const p = x => x * d;
  const { v, A, leg } = r;
  const zone = [p(v[3] - A * 1.0), p(Math.max(v[1] - leg * 0.786, v[3] - A * 1.618))];
  zone.sort((a, b) => a - b);
  return {
    zone,
    invalidation: P[0].price,
    targets: [
      { label: 'Tillbaka till B', price: P[3].price },
      { label: 'Tillbaka till X (toppen)', price: P[1].price },
      { label: 'Ny topp: 1,272 × benet', price: p(v[0] + leg * 1.272) },
    ],
  };
}

export function elliott(zz, { trendBias = 0 } = {}) {
  const cands = [];
  const N = zz.length;
  for (const d of [1, -1]) {
    const dir = d === 1 ? 'bull' : 'bear';
    const startType = d === 1 ? 'L' : 'H';
    for (const n of [3, 4, 5, 6]) {
      if (N < n) continue;
      const P = zz.slice(N - n);
      if (P[0].type !== startType) continue;
      const r = evalImpulse(P, d);
      if (!r) continue;
      const meta = PHASES[`${dir}:${n}`];
      cands.push({ dir, kind: 'impulse', n, P, r, meta, levels: buildImpulse(P, d, r) });
    }
    if (N >= 5) {
      const P = zz.slice(N - 5);
      if (P[0].type === startType) {
        const r = evalABC(P, d);
        if (r) cands.push({ dir, kind: 'abc', n: 5, P, r, meta: PHASES[`${dir}:abc`], levels: buildABC(P, d, r) });
      }
    }
  }
  for (const c of cands) {
    const mean = c.r.fits.reduce((s, x) => s + x, 0) / c.r.fits.length;
    let s = mean * (0.7 + 0.05 * c.n);
    if (trendBias && (c.dir === 'bull') === (trendBias > 0)) s += 0.08;
    c.score = Math.round(Math.min(1, s) * 100);
  }
  cands.sort((a, b) => b.score - a.score);

  const fmt = c => {
    const labels = c.kind === 'abc' ? ['S', 'X', 'A', 'B', 'C'] : ['0', '1', '2', '3', '4', '5'];
    return {
      dir: c.dir,
      kind: c.kind,
      phase: c.meta.phase,
      label: c.meta.label,
      text: c.meta.text,
      bias: c.meta.bias,
      setup: c.meta.setup,
      confidence: c.score,
      notes: c.r.notes,
      waves: c.P.map((p, k) => ({ label: labels[k], i: p.i, price: round(p.price), tentative: !!p.tentative })),
      zone: c.levels.zone && c.levels.zone.map(round),
      invalidation: c.levels.invalidation != null ? round(c.levels.invalidation) : null,
      targets: c.levels.targets.map(t => ({ ...t, price: round(t.price) })),
    };
  };
  return {
    primary: cands[0] ? fmt(cands[0]) : null,
    alternatives: cands.slice(1, 3).map(fmt),
  };
}
