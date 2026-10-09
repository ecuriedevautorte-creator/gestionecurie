import type { Intervalle } from '../model';
import { LIBELLES_INTERVALLES } from '../reglages';

const texteIntervalle = (i: Intervalle | undefined) => (!i ? '—' : i.valeur === 0 ? 'pas de rappel' : `${i.valeur} ${i.unite}`);

/**
 * Liste des intervalles où chaque ligne peut rester vide (on suit alors « reference », affiché entre parenthèses).
 * Valeur 0 : pas de rappel.
 */
export function EditeurIntervalles(props: { valeurs: Record<string, Intervalle>; reference: Record<string, Intervalle>; onChange: (v: Record<string, Intervalle>) => void }) {
  const { valeurs, reference } = props;
  return (
    <>
      {Object.entries(LIBELLES_INTERVALLES).map(([cle, libelle]) => (
        <div class="champ">
          <span>
            {libelle} <span class="discret">({texteIntervalle(reference[cle])})</span>
          </span>
          <div class="intervalle">
            <input
              type="number"
              min="0"
              inputMode="numeric"
              aria-label={libelle}
              value={valeurs[cle]?.valeur ?? ''}
              onInput={(e) => {
                const brut = (e.target as HTMLInputElement).value;
                const y = { ...valeurs };
                if (brut === '') delete y[cle];
                else y[cle] = { valeur: Math.max(0, Number(brut)), unite: valeurs[cle]?.unite ?? reference[cle]?.unite ?? 'mois' };
                props.onChange(y);
              }}
            />
            <select
              aria-label={`${libelle} : unité`}
              value={valeurs[cle]?.unite ?? reference[cle]?.unite ?? 'mois'}
              onChange={(e) => valeurs[cle] && props.onChange({ ...valeurs, [cle]: { ...valeurs[cle], unite: (e.target as HTMLSelectElement).value as Intervalle['unite'] } })}
            >
              <option value="jours">jours</option>
              <option value="semaines">semaines</option>
              <option value="mois">mois</option>
            </select>
          </div>
        </div>
      ))}
    </>
  );
}
