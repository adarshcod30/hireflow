/**
 * The smallest valid PDF that holds text: one page set in Helvetica, no images and no fonts to
 * embed. Enough for a screening model to read, and it keeps the seed script free of dependencies.
 * Text must be ASCII or Latin-1.
 */
const escape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Break a line at word boundaries so it fits the page width. */
export function wrap(line: string, width = 96): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && `${current} ${word}`.length > width) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

export function buildPdf(lines: string[]): Buffer {
  const wrapped = lines.flatMap((l) => wrap(l));
  // Latin-1 keeps one byte per character, so the xref offsets below are byte offsets
  const text = ['BT /F1 10 Tf 12 TL 50 750 Td', ...wrapped.map((l) => `(${escape(l)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
