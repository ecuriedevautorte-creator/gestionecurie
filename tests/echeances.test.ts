import { describe, expect, it } from 'vitest';
import { ajouterMois, ageEnAnnees, formater } from '../src/dates';
import { calculerEcheances, statutDuSoin } from '../src/echeances';
import type { Cheval, Soin } from '../src/model';

const trace = { creeLe: '2026-01-01T00:00:00Z', creePar: 't', modifieLe: '2026-01-01T00:00:00Z', modifiePar: 't' };
const cheval = (id: string, sortie: string | null = null): Cheval => ({
  ...trace, id, nom: id, sexe: '', robe: '', race: '', naissance: null, pere: '', mere: '', proprietaireId: null,
  sire: '', transpondeur: '', entree: null, sortie, motifSortie: '', destination: '', notes: '', usage: null,
});
const soin = (id: string, chevalId: string, type: Soin['type'], date: string, intervalle: Soin['intervalle'], precision = ''): Soin => ({
  ...trace, id, chevalId, type, date, precision, praticien: '', motif: '', cout: null, intervalle, prochaineManuelle: null, lienFacture: '', details: {},
});

describe('dates', () => {
  it('formate en JJ/MM/AAAA', () => expect(formater('2026-03-01')).toBe('01/03/2026'));
  it('ajoute des mois comme EDATE', () => {
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28');
    expect(ajouterMois('2025-10-27', 6)).toBe('2026-04-27');
  });
  it("calcule l'âge", () => expect(ageEnAnnees('2011-05-04', '2026-05-03')).toBe(14));
});

describe('échéances', () => {
  const ref = '2026-10-09';
  it('EN RETARD si dépassée, BIENTÔT à 14 jours pour le maréchal et 7 jours sinon', () => {
    const c = cheval('A');
    const e = calculerEcheances([c], [
      soin('1', 'A', 'marechal', '2026-09-09', { valeur: 6, unite: 'semaines' }), // 21/10 : dans 12 j
      soin('2', 'A', 'vermifuge', '2026-08-15', { valeur: 2, unite: 'mois' }), // 15/10 : dans 6 j
      soin('3', 'A', 'vaccin', '2026-03-01', { valeur: 6, unite: 'mois' }, 'TG'), // 01/09 : retard
      soin('4', 'A', 'osteo', '2026-09-01', { valeur: 1, unite: 'mois' }), // 01/10 : retard
    ], ref);
    const parCle = Object.fromEntries(e.map((x) => [x.cle, x.statut]));
    expect(parCle).toEqual({ marechal: 'BIENTÔT', vermifuge: 'BIENTÔT', 'vaccin:TG': 'EN RETARD', osteo: 'EN RETARD' });
  });
  it('à 10 jours : BIENTÔT pour le maréchal, OK pour le vermifuge', () => {
    const e = calculerEcheances([cheval('A')], [
      soin('1', 'A', 'marechal', '2026-09-09', { valeur: 40, unite: 'jours' }),
      soin('2', 'A', 'vermifuge', '2026-09-09', { valeur: 40, unite: 'jours' }),
    ], ref);
    expect(e.map((x) => x.statut)).toEqual(['BIENTÔT', 'OK']);
  });
  it('seul le dernier soin compte, les anciens sont FAIT', () => {
    const c = cheval('A');
    const ancien = soin('1', 'A', 'marechal', '2026-01-01', { valeur: 4, unite: 'semaines' });
    const recent = soin('2', 'A', 'marechal', '2026-10-01', { valeur: 4, unite: 'semaines' });
    expect(calculerEcheances([c], [ancien, recent], ref)).toHaveLength(1);
    expect(statutDuSoin(ancien, [ancien, recent], c, ref)).toBe('FAIT');
    expect(statutDuSoin(recent, [ancien, recent], c, ref)).toBe('OK');
  });
  it("un cheval sorti ne génère plus d'alerte", () => {
    const e = calculerEcheances([cheval('A', '2026-06-30')], [soin('1', 'A', 'marechal', '2026-01-01', { valeur: 4, unite: 'semaines' })], ref);
    expect(e).toHaveLength(0);
  });
});
