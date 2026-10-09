import { useState } from 'preact/hooks';
import { aujourdhui } from '../dates';
import { db, useLive } from '../db';
import { enregistrerCheval, enregistrerProprietaire, nouvelId } from '../ecriture';
import { USAGES, type Cheval, type Intervalle, type Proprietaire, type Sexe, type Usage } from '../model';
import { reduirePhoto } from '../photo';
import { intervalleDe, useIntervalles } from '../reglages';
import { EditeurIntervalles } from './EditeurIntervalles';
import { emplacementsDe } from '../plan';
import { ChoixEmplacements } from './Plan';

export function PageModifierCheval({ id, utilisateur }: { id: string; utilisateur: string }) {
  const c = useLive(() => db.chevaux.get(id), [id]);
  const proprietaires = useLive(() => db.proprietaires.toArray());
  if (c === undefined || proprietaires === undefined) return null;
  return <Formulaire cheval={c} nouveau={false} proprietaires={proprietaires} utilisateur={utilisateur} />;
}

export function PageNouveauCheval({ utilisateur }: { utilisateur: string }) {
  const proprietaires = useLive(() => db.proprietaires.toArray());
  const [vierge] = useState<Cheval>(() => ({
    id: nouvelId(),
    creeLe: '',
    creePar: '',
    modifieLe: '',
    modifiePar: '',
    supprimeLe: null,
    aVerifier: [],
    nom: '',
    sexe: '',
    robe: '',
    race: '',
    naissance: null,
    pere: '',
    mere: '',
    proprietaireId: null,
    sire: '',
    transpondeur: '',
    entree: aujourdhui(),
    sortie: null,
    motifSortie: '',
    destination: '',
    notes: '',
    usage: null,
    intervalles: {},
    photo: null,
  }));
  if (proprietaires === undefined) return null;
  return <Formulaire cheval={vierge} nouveau proprietaires={proprietaires} utilisateur={utilisateur} />;
}

type Champs = Pick<Cheval, 'nom' | 'sexe' | 'robe' | 'race' | 'pere' | 'mere' | 'sire' | 'transpondeur' | 'motifSortie' | 'destination' | 'notes'> & {
  naissance: string;
  entree: string;
  sortie: string;
  usage: Usage | '';
  proprietaireId: string;
};

const AUTRE = '__autre__';

function Formulaire({ cheval, nouveau, proprietaires, utilisateur }: { cheval: Cheval; nouveau: boolean; proprietaires: Proprietaire[]; utilisateur: string }) {
  const reglages = useIntervalles();
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
    proprietaireId: cheval.proprietaireId ?? '',
  });
  const [nouveauProprio, setNouveauProprio] = useState({ nom: '', adresse: '' });
  const [photo, setPhoto] = useState(cheval.photo ?? null);
  const [paddocks, setPaddocks] = useState(emplacementsDe(cheval));
  const [erreur, setErreur] = useState('');
  const [intervalles, setIntervalles] = useState<Record<string, Intervalle>>({ ...(cheval.intervalles ?? {}) } as Record<string, Intervalle>);
  const maj = (k: keyof Champs) => (e: Event) => setF((x) => ({ ...x, [k]: (e.target as HTMLInputElement).value }));
  const retour = nouveau ? '#/' : `#/cheval/${cheval.id}`;

  const enregistrer = async (e: Event) => {
    e.preventDefault();
    const nom = f.nom.trim().toUpperCase();
    if (!nom) return setErreur('Indique le nom du cheval.');
    if (nouveau && (await db.chevaux.filter((c) => !c.supprimeLe && c.nom === nom).count()) > 0 && !confirm(`Un cheval s'appelle déjà ${nom}. Créer quand même une deuxième fiche ?`)) return;
    if (f.transpondeur && !/^\d{15}$/.test(f.transpondeur) && !confirm('Le transpondeur ne fait pas 15 chiffres. Enregistrer quand même ?')) return;
    let proprietaireId = f.proprietaireId || null;
    if (f.proprietaireId === AUTRE) {
      if (!nouveauProprio.nom.trim()) return setErreur('Indique le nom du nouveau propriétaire.');
      proprietaireId = nouvelId();
      await enregistrerProprietaire(
        { id: proprietaireId, creeLe: '', creePar: '', modifieLe: '', modifiePar: '', nom: nouveauProprio.nom.trim(), adresse: nouveauProprio.adresse.trim() },
        utilisateur,
      );
    }
    await enregistrerCheval(
      {
        ...cheval,
        ...f,
        nom,
        sexe: f.sexe as Sexe,
        naissance: f.naissance || null,
        naissanceAnneeSeule: f.naissance === cheval.naissance ? cheval.naissanceAnneeSeule : false,
        entree: f.entree || null,
        sortie: f.sortie || null,
        usage: f.usage || null,
        proprietaireId,
        intervalles,
        photo,
        paddocks,
        paddock: paddocks[0] ?? null,
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

  // ce que le cheval aurait sans réglage propre : celui de sa catégorie, sinon le général
  const sansReglagePropre = Object.fromEntries(
    Object.keys(reglages.generaux).map((cle) => [cle, intervalleDe(cle, { usage: f.usage || null } as Cheval, reglages)!]),
  );

  return (
    <form class="page saisie" onSubmit={enregistrer}>
      <a href={retour} class="retour">
        ← {nouveau ? 'Chevaux' : cheval.nom}
      </a>
      <h1>{nouveau ? 'Nouveau cheval' : 'Modifier la fiche'}</h1>

      <fieldset class="carte">
        <legend>Photo</legend>
        <div class="photo-edition">
          {photo ? <img class="photo-cheval" src={photo} alt="" /> : <div class="photo-cheval vide" aria-hidden="true">🐴</div>}
          <div class="photo-actions">
            <label class="bouton secondaire">
              {photo ? 'Changer la photo' : 'Ajouter une photo'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const fichier = (e.target as HTMLInputElement).files?.[0];
                  if (!fichier) return;
                  try {
                    setPhoto(await reduirePhoto(fichier));
                  } catch {
                    setErreur("Cette image n'a pas pu être lue.");
                  }
                }}
              />
            </label>
            {photo && (
              <button type="button" class="bouton-texte" onClick={() => setPhoto(null)}>
                Retirer la photo
              </button>
            )}
          </div>
        </div>
      </fieldset>

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
        <label class="champ">
          <span>Propriétaire</span>
          <select value={f.proprietaireId} onChange={maj('proprietaireId')}>
            <option value="">—</option>
            {[...proprietaires]
              .filter((p) => !p.supprimeLe)
              .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
              .map((p) => (
                <option value={p.id}>{p.nom}</option>
              ))}
            <option value={AUTRE}>Nouveau propriétaire…</option>
          </select>
        </label>
        {f.proprietaireId === AUTRE && (
          <>
            <label class="champ">
              <span>Nom du propriétaire</span>
              <input value={nouveauProprio.nom} onInput={(e) => setNouveauProprio((x) => ({ ...x, nom: (e.target as HTMLInputElement).value }))} />
            </label>
            <label class="champ">
              <span>Adresse</span>
              <textarea rows={2} value={nouveauProprio.adresse} onInput={(e) => setNouveauProprio((x) => ({ ...x, adresse: (e.target as HTMLTextAreaElement).value }))} />
            </label>
          </>
        )}
      </fieldset>

      <fieldset class="carte">
        <legend>Catégorie</legend>
        <div class="puces enveloppe">
          {USAGES.map((u) => (
            <button type="button" class={f.usage === u ? 'puce active' : 'puce'} onClick={() => setF((x) => ({ ...x, usage: x.usage === u ? '' : u }))}>
              {u}
            </button>
          ))}
        </div>
        <p class="discret petit">Les rappels proposés suivent la catégorie (Réglages › Intervalles), sauf réglage propre à ce cheval ci-dessous.</p>
      </fieldset>

      <fieldset class="carte">
        <legend>Présence</legend>
        <div class="champ">
          <span>Emplacement sur le plan (un ou plusieurs paddocks)</span>
          <ChoixEmplacements valeurs={paddocks} onChange={setPaddocks} nomCheval={f.nom || 'ce cheval'} />
        </div>
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
        <p class="discret petit">Laisse vide pour suivre {f.usage ? `la catégorie ${f.usage}` : 'le réglage général'} (valeur entre parenthèses). 0 = pas de rappel.</p>
        <EditeurIntervalles valeurs={intervalles} reference={sansReglagePropre} onChange={setIntervalles} />
      </fieldset>

      {erreur && <p class="erreur">{erreur}</p>}
      <button class="bouton large" type="submit">
        {nouveau ? 'Créer la fiche' : 'Enregistrer'}
      </button>
    </form>
  );
}
