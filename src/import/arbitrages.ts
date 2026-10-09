// Réponses de PAF (09/10/2026) aux points « à trancher » du premier import.
// « garder » : la donnée est importée telle quelle, sans bandeau « À vérifier ».
// « corriger » : la correction proposée est appliquée.
// Clé : « type de point|nom du cheval » (« * » vaut pour tous les chevaux).

export type Arbitrage = 'garder' | 'corriger';

export const DATE_ARBITRAGES = '09/10/2026';

export const ARBITRAGES: Record<string, Arbitrage> = {
  'parents-inverses|QUERCUS DE VAUTORTE': 'corriger',
  'naissance-poulinage|QONTADOR VAUTORTE': 'garder',
  'transpondeur|BRADY': 'garder',
  'nom-proche|GALIOPEE DE FRAJUS / GATSBY DE FREJUS': 'garder',
  'sans-motif|*': 'garder',
  'vaccin-date|ROSEE VALTORTAISE': 'garder',
  'vaccin-date|BRADY': 'garder',
  'vaccin-date|VALINO DU PONT': 'garder',
  'vaccin-date|OLE DE CORMON': 'garder',
  'echo-avant-saillie|VELEDA': 'garder',
};

export function arbitrage(type: string, cheval: string): Arbitrage | undefined {
  return ARBITRAGES[`${type}|${cheval}`] ?? ARBITRAGES[`${type}|*`];
}
