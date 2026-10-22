// Bitcoins halveringscykel. Regeln: äg bitcoin från 12 månader före en
// halvering till 18 månader efter, annars kontanter. 2015–2026 gav regeln
// +86 % per år med största nedgång −61 %, mot +63 % och −82 % för köp och
// behåll (i SEK). Bara tre cykler finns att testa på, så resultatet är osäkert.

export const HALVINGS = [
  { date: '2016-07-09' },
  { date: '2020-05-11' },
  { date: '2024-04-20' },
  { date: '2028-04-15', estimated: true },
];
export const BEFORE_MONTHS = 12;
export const AFTER_MONTHS = 18;

const addMonths = (d, m) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };

export function btcCycle(today = new Date().toISOString().slice(0, 10)) {
  const windows = HALVINGS.map(h => ({ ...h, open: addMonths(h.date, -BEFORE_MONTHS), close: addMonths(h.date, AFTER_MONTHS) }));
  const current = windows.find(w => today >= w.open && today < w.close);
  if (current) {
    return { inWindow: true, halving: current, until: current.close,
      label: `Köpfönster – äg bitcoin till ${current.close}`, text: `Halveringen ${current.date}${current.estimated ? ' (uppskattad)' : ''}. Regeln säljer 18 månader efter halveringen.` };
  }
  const next = windows.find(w => w.open > today);
  const last = [...windows].reverse().find(w => w.close <= today);
  return { inWindow: false, halving: next, until: next?.open,
    label: `Utanför köpfönstret – nästa öppnar ${next?.open}`,
    text: `Senaste halveringen ${last?.date}, fönstret stängde ${last?.close}. Nästa halvering ${next?.date}${next?.estimated ? ' (uppskattad)' : ''}.` };
}
