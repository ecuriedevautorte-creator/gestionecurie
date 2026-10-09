import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { enregistrerParametres } from '../src/ecriture';
import type { Cheval } from '../src/model';
import { appliquerRepartitionInitiale } from '../src/plan';

const cheval = (id: string, nom: string, paddock: string | null = null) =>
  ({ id, nom, paddock, sortie: null, supprimeLe: null, creeLe: '', creePar: '', modifieLe: '', modifiePar: '' }) as unknown as Cheval;

describe('répartition des chevaux sur le plan', () => {
  it('première fois : Quercus et Quillac au paddock 7, les juments au 5', async () => {
    await db.chevaux.bulkPut([cheval('a', 'QUERCUS DE VAUTORTE'), cheval('b', 'QUILLAC'), cheval('c', 'VELEDA'), cheval('d', 'MONA')]);
    await appliquerRepartitionInitiale('Pierre-Alexandre');
    const p = Object.fromEntries((await db.chevaux.toArray()).map((c) => [c.nom, c.paddock]));
    expect(p).toEqual({ 'QUERCUS DE VAUTORTE': 'paddock-7', QUILLAC: 'paddock-7', VELEDA: 'paddock-5', MONA: 'paddock-12' });
  });
  it("déjà placés avec l'ancienne répartition : seuls Quercus et Quillac passent au 7, une seule fois", async () => {
    await db.parametres.clear();
    await enregistrerParametres({ paddocksInitialises: true }, 'Pierre-Alexandre');
    await db.chevaux.bulkPut([cheval('a', 'QUERCUS DE VAUTORTE', 'paddock-5'), cheval('b', 'QUILLAC', 'paddock-5'), cheval('c', 'VELEDA', 'paddock-5')]);
    expect(await appliquerRepartitionInitiale('Chloé')).toBe(2);
    await db.chevaux.update('a', { paddock: 'paddock-5' }); // déplacé à la main ensuite : on n'y touche plus
    expect(await appliquerRepartitionInitiale('Chloé')).toBe(0);
    expect((await db.chevaux.get('c'))!.paddock).toBe('paddock-5');
  });
});
