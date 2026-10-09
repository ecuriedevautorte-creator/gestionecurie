// Test sur le vrai classeur (non versionné : il contient des données personnelles).
// Lancer avec : CLASSEUR=/chemin/Gestion_Ecurie.xlsx npm test
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importerClasseur } from '../src/import/excel';

const chemin = process.env.CLASSEUR ?? '';

describe.skipIf(!existsSync(chemin))('import du classeur réel', () => {
  it('lit les chevaux, les soins et signale les anomalies', async () => {
    const buf = readFileSync(chemin);
    const r = await importerClasseur(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
      auteur: 'test',
      maintenant: '2026-10-09T12:00:00Z',
      ref: '2026-10-09',
    });
    const compte = (t: string) => r.soins.filter((s) => s.type === t).length;
    console.log(JSON.stringify({ chevaux: r.chevaux.length, proprietaires: r.proprietaires.map((p) => p.nom), vet: compte('veterinaire'), marechal: compte('marechal'), vaccin: compte('vaccin'), vermifuge: compte('vermifuge'), saillies: r.saillies.length, ignorees: r.lignesIgnorees }, null, 1));
    for (const a of r.anomalies) console.log(`[${a.gravite}] ${a.onglet}${a.ligne ? ' L' + a.ligne : ''} ${a.cheval ?? ''} — ${a.message}${a.correction ? ' → ' + a.correction : ''}`);
    expect(r.chevaux).toHaveLength(26);
    expect(compte('marechal')).toBe(29);
    expect(compte('vaccin')).toBe(16);
    expect(r.chevaux.find((c) => c.nom === 'BRADY')!.transpondeur).toBe('52821000283783');
    expect(r.chevaux.find((c) => c.nom === 'BERLINGOT')!.transpondeur).toBe('250259600463208');
  });
});
