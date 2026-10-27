// Läser första bladet i en ODS-fil (OpenDocument-kalkylark) utan externa paket.
// ODS är en zip-fil; vi letar upp content.xml i zip-katalogen och packar upp den.

import zlib from 'node:zlib';

function unzipEntry(buf, name) {
  // Slutet av zip-katalogen (End of Central Directory) ligger sist i filen.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Ingen zip-fil');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const fname = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (fname === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 8 ? zlib.inflateRawSync(data) : data;
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`${name} saknas i filen`);
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

// Returnerar raderna i första bladet som listor av strängar.
export function readOds(buf) {
  const xml = unzipEntry(buf, 'content.xml').toString('utf8');
  const sheet = xml.slice(xml.indexOf('<table:table '), xml.indexOf('</table:table>'));
  const rows = [];
  for (const m of sheet.matchAll(/<table:table-row\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const cells = [];
    for (const c of (m[1] || '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
      const attrs = c[1];
      const rep = Math.min(+(attrs.match(/table:number-columns-repeated="(\d+)"/)?.[1] || 1), 50);
      const val = attrs.match(/office:date-value="([^"]+)"/)?.[1] ?? attrs.match(/office:value="([^"]+)"/)?.[1]
        ?? decode((c[2] || '').replace(/<text:s[^>]*\/>/g, ' ').replace(/<[^>]+>/g, ''));
      for (let k = 0; k < rep; k++) cells.push(val);
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length) rows.push(cells);
  }
  return rows;
}
