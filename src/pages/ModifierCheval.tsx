import { useState } from 'preact/hooks';
import { db, useLive } from '../db';
import { enregistrerCheval } from '../ecriture';
import { USAGES, type Cheval, type Intervalle, type Sexe, type Usage } from '../model';
import { LIBELLES_INTERVALLES, useIntervalles } from '../reglages';

export function PageModifierCheval({ id, utilisateur }: { id: string; utilisateur: string }) {
  const c = useLive(() => db.chevaux.get(id), [id]);
  if (c === undefined) return null;
  return <Formulaire cheval={c} utilisateur={utilisateur} />;
}

type Champs = Pick<Cheval, 'nom' | 'sexe' | 'robe' | 'race' | 'pere' | 'mere' | 'sire' | 'transpondeur' | 'motifSortie' | 'destination' | 'notes'> & {
  naissance: string;
  entree: string;
  sortie: string;
  usage: Usage | '';
};

function Formulaire({ cheval, utilisateur }: { cheval: Cheval; utilisateur: string }) {
  const generaux = useIntervalles();
  const [f, setF] = useState<Champs>({
    nom: cheval.nom,
    sexe: cheval.sexe,
    robe: cheval.robe,
    race: cheval.race,
    pere: cheval.pere,
    mere: cheval.mere,
    sire: cheval.sire,
    transpondeur: cheval.transpondeur,
    motifSortie: cheval.motifSortie,
    destination: cheval.destination,
    notes: cheval.notes,
    naissance: cheval.naissance ?? '',
    entree: cheval.entree ?? '',
    sortie: cheval.sortie ?? '',
    usage: cheval.usage ?? '',
  });
  const [intervalles, setIntervalles] = useState<Record<string, Intervalle>>({ ...(cheval.intervalles ?? {}) } as Record<string, Intervalle>);
  const maj = (k: keyof Champs) => (e: Event) => setF((x) => ({ ...x, [k]: (e.target as HTMLInputElement).value }));

  const enregistrer = async (e: Event) => {
    e.preventDefault();
    if (f.transpondeur && !/^\d{15}$/.test(f.transpondeur) && !confirm('Le transpondeur ne fait pas 15 chiffres. Enregistrer quand même ?')) return;
    await enregistrerCheval(
      {
        ...cheval,
        ...f,
        nom: f.nom.trim().toUpperCase(),
        sexe: f.sexe as Sexe,
        naissance: f.naissance || null,
        naissanceAnneeSeule: f.naissance === cheval.naissance ? cheval.naissanceAnneeSeule : false,
        entree: f.entree || null,
        sortie: f.sortie || null,
        usage: f.usage || null,
        intervalles,
      },
      utilisateur,
    );
    location.hash = `#/cheval/${cheval.id}`;
  };

  const texte = (libelle: string, k: keyof Champs, type = 'text', aide?: string) => (
    <label class="champ">
      <span>{libelle}</span>
      <input type={type} value={f[k] as string} onInput={maj(k)} inputMode={k === 'transpondeur' ? 'numeric' : undefined} />
      {aide && <small class="discret">{aide}</small>}
    </label>
  );

  return (
    <form class="page saisie" onSubmit={enregistrer}>
      <a href={`#/cheval/${cheval.id}`} class="retour">
        ← {cheval.nom}
      </a>
      <h1>Modifier la fiche</h1>

      <fieldset class="carte">
        <legend>Identité</legend>
        {texte('Nom', 'nom')}
        <label class="champ">
          <span>Sexe</span>
          <select value={f.sexe} onChange={maj('sexe')}>
            <option value="">—</option>
            <option>Mâle</option>
            <option>Femelle</option>
            <option>Hongre</option>
          </select>
        </label>
        {texte('Robe', 'robe')}
        {texte('Race', 'race')}
        {texte('Date de naissance', 'naissance', 'date')}
        {texte('Père', 'pere')}
        {texte('Mère', 'mere')}
        {texte('N° SIRE', 'sire')}
        {texte('N° transpondeur', 'transpondeur', 'text', '15 chiffres')}
      </fieldset>

      <fieldset class="carte">
        <legend>Usage</legend>
        <div class="puces enveloppe">
          {USAGES.map((u) => (
            <button type="button" class={f.usage === u ? 'puce active' : 'puce'} onClick={() => setF((x) => ({ ...x, usage: x.usage === u ? '' : u }))}>
              {u}
            </button>
          ))}
        </div>
        <p class="discret petit">Course et Sport compétition : rappel grippe proposé à 6 mois au lieu de 12.</p>
      </fieldset>

      <fieldset class="carte">
        <legend>Présence</legend>
        {texte("Date d'entrée", 'entree', 'date')}
        {texte('Date de sortie', 'sortie', 'date', 'Laisser vide tant que le cheval est présent')}
        {texte('Motif de sortie', 'motifSortie')}
        {texte('Destination', 'destination')}
        <label class="champ">
          <span>Notes</span>
          <textarea rows={3} value={f.notes} onInput={maj('notes')} />
        </label>
      </fieldset>

      <fieldset class="carte">
        <legend>Intervalles propres à ce cheval</legend>
        <p class="discret petit">Laisse vide pour garder le réglage général (entre parenthèses).</p>
        {Object.entries(LIBELLES_INTERVALLES).map(([cle, libelle]) => (
          <div class="champ">
            <span>
              {libelle} <span class="discret">({generaux[cle].valeur} {generaux[cle].unite})</span>
            </span>
            <div class="intervalle">
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={intervalles[cle]?.valeur ?? ''}
                onInput={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  setIntervalles((x) => {
                    const y = { ...x };
                    if (v) y[cle] = { valeur: v, unite: x[cle]?.unite ?? generaux[cle].unite };
                    else delete y[cle];
                    return y;
                  });
                }}
              />
              <select
                value={intervalles[cle]?.unite ?? generaux[cle].unite}
                onChange={(e) =>
                  setIntervalles((x) => (x[cle] ? { ...x, [cle]: { ...x[cle], unite: (e.target as HTMLSelectElement).value as Intervalle['unite'] } } : x))
                }
              >
                <option value="jours">jours</option>
                <option value="semaines">semaines</option>
                <option value="mois">mois</option>
              </select>
            </div>
          </div>
        ))}
      </fieldset>

      <button class="bouton large" type="submit">
        Enregistrer
      </button>
    </form>
  );
}
