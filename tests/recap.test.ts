import { describe, expect, it } from 'vitest';
import type { Cheval, Soin } from '../src/model';
import { construireRecap } from '../src/recap';

const trace = { creeLe: '2026-01-01T00:00:00Z', creePar: 't', modifieLe: '2026-01-01T00:00:00Z', modifiePar: 't' };
const cheval = (id: string, sortie: string | null = null): Cheval => ({
  ...trace, id, nom: id, sexe: '', robe: '', race: '', naissance: null, pere: '', mere: '', proprietaireId: null,
  sire: '', transpondeur: '', entree: null, sortie, motifSortie: '', destination: '', notes: '', usage: null,
});
const soin = (id: string, chevalId: string, type: Soin['type'], date: string, intervalle: Soin['intervalle'], precision = ''): Soin => ({
  ...trace, id, chevalId, type, date, precision, praticien: '', motif: '', cout: null, intervalle, prochaineManuelle: null, lienFacture: '', details: {},
});

describe('récapitulatif hebdomadaire', () => {
  const ref = '2026-10-12';
  it('liste les soins en retard et bientôt, sans les chevaux sortis ni les échéances lointaines', () => {
    const r = construireRecap(
      [cheval('QUERCUS'), cheval('OBBY'), cheval('PARTI', '2026-09-01')],
      [
        soin('1', 'QUERCUS', 'marechal', '2026-06-01', { valeur: 4, unite: 'mois' }), // 01/10 : 11 j de retard
        soin('2', 'OBBY', 'vaccin', '2025-10-15', { valeur: 12, unite: 'mois' }, 'Grippe'), // 15/10 : dans 3 j
        soin('3', 'OBBY', 'dentiste', '2026-01-01', { valeur: 24, unite: 'mois' }), // lointain
        soin('4', 'PARTI', 'marechal', '2026-01-01', { valeur: 1, unite: 'mois' }),
      ],
      ref,
    );
    expect([r.retard, r.bientot]).toEqual([1, 1]);
    expect(r.sujet).toBe('Écurie de Vautorte : 1 en retard, 1 bientôt (semaine du 12/10/2026)');
    expect(r.texte).toContain('- QUERCUS : Maréchal, prévu le 01/10/2026 (11 jours de retard)');
    expect(r.texte).toContain('- OBBY : Vaccin Grippe, prévu le 15/10/2026 (dans 3 jours)');
    expect(r.texte).not.toContain('PARTI');
    expect(r.texte).not.toContain('Dentiste');
    expect(r.html).toContain('<td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:bold">QUERCUS</td>');
  });
  it('dit quand il n’y a rien', () => {
    const r = construireRecap([cheval('A')], [], ref);
    expect(r.sujet).toBe('Écurie de Vautorte : aucune alerte cette semaine');
    expect(r.texte).toContain('Aucun soin en retard');
  });
});
