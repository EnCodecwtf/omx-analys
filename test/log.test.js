import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('signalloggen skrivs aldrig över när den inte går att läsa', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omx-log-'));
  const file = path.join(dir, 'signal-log.json');
  process.env.LOG_FILE = file;
  const log = await import('../lib/log.js?' + Date.now());
  const e = s => ({ date: '2026-11-02', symbol: s, name: s, close: 1, stop: 0.9, tps: [1.1, 1.2, 1.3] });
  // Tom logg: första signalen sparas.
  assert.equal((await log.record([e('A')])).length, 1);
  // Trasig fil (som ett läsfel): ny signal sparas inte, och filen lämnas orörd.
  await fs.writeFile(file, '{trasig');
  assert.deepEqual(await log.record([e('B')]), []);
  assert.equal(await fs.readFile(file, 'utf8'), '{trasig');
  await assert.rejects(log.entries());
  // Lagad fil: posterna finns kvar och nya läggs till.
  await fs.writeFile(file, JSON.stringify([e('A')]));
  await log.record([e('C')]);
  assert.deepEqual((await log.entries()).map(x => x.symbol).sort(), ['A', 'C']);
  // Borttagning tar bara det som ska bort.
  await log.remove([log.idOf(e('C'))]);
  assert.deepEqual((await log.entries()).map(x => x.symbol), ['A']);
});
