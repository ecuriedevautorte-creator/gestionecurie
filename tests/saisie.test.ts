import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { enregistrerSoin, restaurerSoin, supprimerSoin } from '../src/ecriture';
import type { Cheval, Soin } from '../src/model';
import { intervallePropose, REGLAGES_PAR_DEFAUT as INTERVALLES_PAR_DEFAUT } from '../src/reglages';

const cheval = (usage: Cheval['usage'], intervalles?: Cheval['intervalles']) => ({ usage, intervalles }) as Cheval;

describe('intervalle proposé', () => {
  it('suit les réglages validés', () => {
    expect(intervallePropose('marechal', '', cheval(null), INTERVALLES_PAR_DEFAUT)).toEqual({ valeur: 4, unite: 'mois' });
    expect(intervallePropose('dentiste', '', cheval(null), INTERVALLES_PAR_DEFAUT)).toEqual({ valeur: 24, unite: 'mois' });
    expect(intervallePropose('veterinaire', '', cheval(null), INTERVALLES_PAR_DEFAUT)).toBeNull();
  });
  it('grippe à 6 mois en compétition, 12 sinon ; vaccin combiné = le plus court', () => {
    expect(intervallePropose('vaccin', 'TG', cheval('Loisir'), INTERVALLES_PAR_DEFAUT)).toEqual({ valeur: 12, unite: 'mois' });
    expect(intervallePropose('vaccin', 'TGRhino', cheval('Course'), INTERVALLES_PAR_DEFAUT)).toEqual({ valeur: 6, unite: 'mois' });
  });
  it('intervalles par catégorie : retraite sans maréchal, cheval prioritaire sur sa catégorie', () => {
    const r = { ...INTERVALLES_PAR_DEFAUT, parUsage: { ...INTERVALLES_PAR_DEFAUT.parUsage, Retraite: { marechal: { valeur: 0, unite: 'mois' as const }, vermifuge: { valeur: 6, unite: 'mois' as const } } } };
    expect(intervallePropose('marechal', '', cheval('Retraite'), r)).toBeNull();
    expect(intervallePropose('vermifuge', '', cheval('Retraite'), r)).toEqual({ valeur: 6, unite: 'mois' });
    expect(intervallePropose('vermifuge', '', cheval('Loisir'), r)).toEqual({ valeur: 3, unite: 'mois' });
    expect(intervallePropose('vermifuge', '', cheval('Retraite', { vermifuge: { valeur: 2, unite: 'mois' } }), r)).toEqual({ valeur: 2, unite: 'mois' });
  });
  it("priorité à l'intervalle propre au cheval", () => {
    expect(intervallePropose('marechal', '', cheval(null, { marechal: { valeur: 6, unite: 'semaines' } }), INTERVALLES_PAR_DEFAUT)).toEqual({ valeur: 6, unite: 'semaines' });
  });
});

describe('enregistrement et journal', () => {
  const soin: Soin = {
    id: 's1', creeLe: '', creePar: '', modifieLe: '', modifiePar: '', type: 'marechal', chevalId: 'c1', date: '2026-10-09',
    precision: 'Parage', praticien: 'Killian Fallais', motif: '', cout: 30, intervalle: { valeur: 4, unite: 'mois' },
    prochaineManuelle: null, lienFacture: '', details: {},
  };
  it('trace qui a saisi et qui a modifié, avec les anciennes valeurs', async () => {
    await enregistrerSoin(soin, 'Chloé');
    await enregistrerSoin({ ...soin, cout: 35 }, 'Pierre-Alexandre');
    const s = (await db.soins.get('s1'))!;
    expect([s.creePar, s.modifiePar, s.cout]).toEqual(['Chloé', 'Pierre-Alexandre', 35]);
    const journal = await db.journal.where('ficheId').equals('s1').sortBy('le');
    expect(journal.map((j) => j.operation)).toEqual(['creation', 'modification']);
    expect(journal[1].changements).toEqual({ cout: { avant: 30, apres: 35 } });
  });
  it('corbeille puis récupération', async () => {
    await supprimerSoin('s1', 'Chloé');
    expect((await db.soins.get('s1'))!.supprimeLe).toBeTruthy();
    await restaurerSoin('s1', 'Chloé');
    expect((await db.soins.get('s1'))!.supprimeLe).toBeNull();
  });
});
