import { useEffect, useMemo, useState } from 'preact/hooks';
import { aujourdhui, formater } from '../dates';
import { db, useLive } from '../db';
import { ajouterIntervalle } from '../echeances';
import { enregistrerSoin, nouvelId, supprimerSoin } from '../ecriture';
import { cleNom } from '../import/excel';
import { estPresent, LIBELLES_SOIN, type Cheval, type Intervalle, type Soin, type TypeSoin } from '../model';
import { intervallePropose, useIntervalles } from '../reglages';
import { PadSignature } from './Signature';

const TYPES: TypeSoin[] = ['marechal', 'veterinaire', 'vaccin', 'vermifuge', 'ordonnance', 'osteo', 'dentiste'];
const TYPES_MARECHAL = ['Parage', 'Ferrure', 'Ferrure + Parage'];
const VACCINS = ['TG', 'TGRhino', 'Grippe', 'Tétanos', 'Rhinopneumonie'];
/** Saisie groupée proposée pour ces soins (tout l'effectif le même jour). */
const GROUPABLES: TypeSoin[] = ['marechal', 'vermifuge', 'vaccin', 'osteo', 'dentiste'];

interface Formulaire {
  type: TypeSoin;
  chevaux: string[];
  date: string;
  precision: string;
  praticien: string;
  motif: string;
  cout: string;
  intervalle: Intervalle | null;
  /** Vrai tant que l'intervalle n'a pas été changé à la main : il suit les réglages. */
  intervalleAuto: boolean;
  prochaineManuelle: string;
  lienFacture: string;
  diagnostic: string;
  traitement: string;
  posologie: string;
  dureeJours: string;
  /** Signature du vétérinaire (image PNG), '' si non signé. */
  signature: string;
}

export function PageSaisieSoin({ id, params, utilisateur }: { id: string; params: URLSearchParams; utilisateur: string }) {
  const nouveau = id === 'nouveau';
  const d = useLive(async () => {
    const [chevaux, soins] = await Promise.all([db.chevaux.toArray(), db.soins.toArray()]);
    const existant = nouveau ? undefined : await db.soins.get(id);
    const modele = params.get('depuis') ? await db.soins.get(params.get('depuis')!) : undefined;
    const journal = nouveau ? [] : await db.journal.where('ficheId').equals(id).sortBy('le');
    return { chevaux: chevaux.filter((c) => !c.supprimeLe), soins: soins.filter((s) => !s.supprimeLe), existant, modele, journal };
  }, [id, params.toString()]);

  if (!d) return null;
  if (!nouveau && !d.existant) return <p class="page">Ce soin n'existe plus.</p>;
  return <Formulaire {...d} nouveau={nouveau} params={params} utilisateur={utilisateur} />;
}

function etatInitial(existant: Soin | undefined, modele: Soin | undefined, params: URLSearchParams): Formulaire {
  const base = existant ?? modele;
  const chevalParam = params.get('cheval');
  return {
    type: base?.type ?? (params.get('type') as TypeSoin) ?? 'marechal',
    chevaux: existant ? [existant.chevalId] : modele ? [modele.chevalId] : chevalParam ? [chevalParam] : [],
    date: existant?.date ?? aujourdhui(),
    precision: base?.precision ?? '',
    praticien: base?.praticien ?? '',
    motif: existant?.motif ?? '',
    cout: existant?.cout != null ? String(existant.cout).replace('.', ',') : modele?.cout != null ? String(modele.cout).replace('.', ',') : '',
    intervalle: base?.intervalle ?? null,
    intervalleAuto: !base,
    prochaineManuelle: existant?.prochaineManuelle ?? '',
    lienFacture: existant?.lienFacture ?? '',
    diagnostic: String(existant?.details.diagnostic ?? ''),
    traitement: String(existant?.details.traitement ?? ''),
    posologie: String(base?.details.posologie ?? ''),
    dureeJours: base?.details.dureeJours != null ? String(base.details.dureeJours) : '',
    signature: String(existant?.details.signature ?? ''),
  };
}

function Formulaire(props: {
  chevaux: Cheval[];
  soins: Soin[];
  existant?: Soin;
  modele?: Soin;
  journal: import('../model').EntreeJournal[];
  nouveau: boolean;
  params: URLSearchParams;
  utilisateur: string;
}) {
  const { chevaux, soins, existant, nouveau } = props;
  const ref = aujourdhui();
  const reglages = useIntervalles();
  const [f, setF] = useState<Formulaire>(() => etatInitial(existant, props.modele, props.params));
  const [groupe, setGroupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const maj = (champs: Partial<Formulaire>) => setF((x) => ({ ...x, ...champs }));

  const parId = useMemo(() => new Map(chevaux.map((c) => [c.id, c])), [chevaux]);
  const premier = parId.get(f.chevaux[0]);

  // Intervalle proposé automatiquement selon le type, le vaccin et le cheval
  useEffect(() => {
    if (!f.intervalleAuto) return;
    maj({ intervalle: intervallePropose(f.type, f.precision, premier, reglages) });
  }, [f.type, f.precision, f.chevaux[0], f.intervalleAuto, JSON.stringify(reglages)]);

  const suggestions = (champ: 'praticien' | 'precision') =>
    [...new Set(soins.filter((s) => s.type === f.type && s[champ]).map((s) => s[champ]))].sort((a, b) => a.localeCompare(b, 'fr'));

  const prochaine = f.prochaineManuelle || (f.intervalle && f.intervalle.valeur > 0 && f.date ? ajouterIntervalle(f.date, f.intervalle) : '');
  const presents = chevaux.filter((c) => estPresent(c, ref)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const sortis = chevaux.filter((c) => !estPresent(c, ref)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const enregistrer = async (e: Event) => {
    e.preventDefault();
    if (!f.date) return setErreur('Indique la date du soin.');
    if (f.chevaux.length === 0) return setErreur('Choisis au moins un cheval.');
    const cout = f.cout.trim() ? Number(f.cout.replace(/\s/g, '').replace(',', '.')) : null;
    if (cout !== null && !Number.isFinite(cout)) return setErreur('Le coût doit être un nombre, par exemple 42,50.');
    const details: Soin['details'] = {};
    if (f.type === 'veterinaire') Object.assign(details, { diagnostic: f.diagnostic || null, traitement: f.traitement || null, signature: f.signature || null });
    if (f.type === 'ordonnance') Object.assign(details, { posologie: f.posologie || null, dureeJours: f.dureeJours ? Number(f.dureeJours) : null });
    const avecIntervalle = !['veterinaire', 'ordonnance'].includes(f.type);
    for (const chevalId of f.chevaux) {
      const soin: Soin = {
        ...(existant ?? { id: nouvelId(), creeLe: '', creePar: '', modifieLe: '', modifiePar: '', supprimeLe: null, aVerifier: [] }),
        type: f.type,
        chevalId,
        date: f.date,
        precision: f.precision.trim(),
        praticien: f.praticien.trim(),
        motif: f.motif.trim(),
        cout,
        // en saisie groupée, chaque cheval garde l'intervalle de sa catégorie tant qu'on n'a rien changé à la main
        intervalle: !avecIntervalle ? null : f.intervalleAuto && f.chevaux.length > 1 ? intervallePropose(f.type, f.precision, parId.get(chevalId), reglages) : f.intervalle,
        prochaineManuelle: f.type === 'veterinaire' && f.prochaineManuelle ? f.prochaineManuelle : null,
        lienFacture: f.lienFacture.trim(),
        details: { ...(existant?.details ?? {}), ...details },
      };
      if (!existant) soin.id = nouvelId();
      await enregistrerSoin(soin, props.utilisateur);
    }
    history.length > 1 ? history.back() : (location.hash = f.chevaux.length === 1 ? `#/cheval/${f.chevaux[0]}` : '#/');
  };

  const supprimer = async () => {
    if (!existant || !confirm('Mettre ce soin à la corbeille ? Il reste récupérable pendant 30 jours dans Réglages.')) return;
    await supprimerSoin(existant.id, props.utilisateur);
    location.hash = `#/cheval/${existant.chevalId}`;
  };

  const champ = (libelle: string, valeur: string, cle: keyof Formulaire, opts: { type?: string; liste?: string[]; placeholder?: string; inputmode?: string } = {}) => {
    const idListe = opts.liste ? `liste-${cle}` : undefined;
    return (
      <label class="champ">
        <span>{libelle}</span>
        <input
          type={opts.type ?? 'text'}
          value={valeur}
          list={idListe}
          placeholder={opts.placeholder}
          inputMode={opts.inputmode as 'decimal' | undefined}
          onInput={(e) => maj({ [cle]: (e.target as HTMLInputElement).value } as Partial<Formulaire>)}
        />
        {opts.liste && (
          <datalist id={idListe}>
            {opts.liste.map((v) => (
              <option value={v} />
            ))}
          </datalist>
        )}
      </label>
    );
  };

  return (
    <form class="page saisie" onSubmit={enregistrer}>
      <a href={f.chevaux.length === 1 ? `#/cheval/${f.chevaux[0]}` : '#/'} class="retour">
        ← Retour
      </a>
      <h1>{nouveau ? 'Nouveau soin' : 'Modifier le soin'}</h1>

      <fieldset class="carte">
        <legend>Type de soin</legend>
        <div class="puces enveloppe">
          {TYPES.map((t) => (
            <button
              type="button"
              class={f.type === t ? 'puce active' : 'puce'}
              disabled={!nouveau && f.type !== t}
              onClick={() => maj({ type: t, precision: t === f.type ? f.precision : '', praticien: t === f.type ? f.praticien : '' })}
            >
              {LIBELLES_SOIN[t]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset class="carte">
        <legend>{groupe ? 'Chevaux' : 'Cheval'}</legend>
        {nouveau && GROUPABLES.includes(f.type) && (
          <label class="interrupteur">
            <input
              type="checkbox"
              checked={groupe}
              onChange={(e) => {
                const coche = (e.target as HTMLInputElement).checked;
                setGroupe(coche);
                if (!coche) maj({ chevaux: f.chevaux.slice(0, 1) });
              }}
            />
            Plusieurs chevaux le même jour
          </label>
        )}
        {groupe ? (
          <ChoixMultiple presents={presents} choisis={f.chevaux} onChange={(chevaux) => maj({ chevaux })} />
        ) : (
          <select class="selection" value={f.chevaux[0] ?? ''} disabled={!nouveau} onChange={(e) => maj({ chevaux: [(e.target as HTMLSelectElement).value].filter(Boolean) })}>
            <option value="">Choisir un cheval…</option>
            <optgroup label="Présents">
              {presents.map((c) => (
                <option value={c.id}>{c.nom}</option>
              ))}
            </optgroup>
            {sortis.length > 0 && (
              <optgroup label="Sortis">
                {sortis.map((c) => (
                  <option value={c.id}>{c.nom}</option>
                ))}
              </optgroup>
            )}
          </select>
        )}
      </fieldset>

      <fieldset class="carte">
        <legend>Détails</legend>
        {champ('Date', f.date, 'date', { type: 'date' })}

        {f.type === 'marechal' && (
          <div class="champ">
            <span>Intervention</span>
            <div class="puces enveloppe">
              {TYPES_MARECHAL.map((t) => (
                <button type="button" class={f.precision === t ? 'puce active' : 'puce'} onClick={() => maj({ precision: t })}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {f.type === 'vaccin' && champ('Vaccin', f.precision, 'precision', { liste: [...new Set([...VACCINS, ...suggestions('precision')])], placeholder: 'TG, TGRhino…' })}
        {f.type === 'vermifuge' && champ('Produit', f.precision, 'precision', { liste: suggestions('precision'), placeholder: 'Eqvalan, Panacur…' })}
        {f.type === 'ordonnance' && champ('Médicament', f.precision, 'precision', { liste: suggestions('precision') })}
        {f.type === 'ordonnance' && champ('Posologie', f.posologie, 'posologie')}
        {f.type === 'ordonnance' && champ('Durée (jours)', f.dureeJours, 'dureeJours', { type: 'number', inputmode: 'numeric' })}

        {champ(libellePraticien(f.type), f.praticien, 'praticien', { liste: suggestions('praticien') })}
        {['veterinaire', 'osteo', 'dentiste'].includes(f.type) && champ('Motif', f.motif, 'motif')}
        {f.type === 'veterinaire' && champ('Diagnostic', f.diagnostic, 'diagnostic')}
        {f.type === 'veterinaire' && champ('Traitement', f.traitement, 'traitement')}
        {champ(groupe ? 'Coût par cheval (€)' : 'Coût (€)', f.cout, 'cout', { inputmode: 'decimal', placeholder: '0,00' })}
        {f.type === 'veterinaire' && champ('Lien de la facture (Drive)', f.lienFacture, 'lienFacture', { type: 'url', placeholder: 'https://drive.google.com/…' })}
      </fieldset>

      {f.type === 'veterinaire' && (
        <fieldset class="carte">
          <legend>Signature du vétérinaire</legend>
          <PadSignature valeur={f.signature} onChange={(signature) => maj({ signature })} />
        </fieldset>
      )}

      <fieldset class="carte">
        <legend>Prochaine échéance</legend>
        {f.type === 'veterinaire' ? (
          champ('Prochain rendez-vous (facultatif)', f.prochaineManuelle, 'prochaineManuelle', { type: 'date' })
        ) : f.type === 'ordonnance' ? (
          <p class="discret">{f.dureeJours && f.date ? `Fin du traitement le ${formater(ajouterIntervalle(f.date, { valeur: Number(f.dureeJours), unite: 'jours' }))}.` : 'Indique la durée pour connaître la date de fin.'}</p>
        ) : (
          <>
            <div class="champ">
              <span>{f.type === 'vaccin' || f.type === 'vermifuge' ? 'Rappel dans' : 'Prochain passage dans'}</span>
              <div class="intervalle">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={f.intervalle?.valeur ?? ''}
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value);
                    maj({ intervalleAuto: false, intervalle: v ? { valeur: v, unite: f.intervalle?.unite ?? 'mois' } : null });
                  }}
                />
                <select
                  value={f.intervalle?.unite ?? 'mois'}
                  onChange={(e) => maj({ intervalleAuto: false, intervalle: { valeur: f.intervalle?.valeur ?? 1, unite: (e.target as HTMLSelectElement).value as Intervalle['unite'] } })}
                >
                  <option value="jours">jours</option>
                  <option value="semaines">semaines</option>
                  <option value="mois">mois</option>
                </select>
              </div>
            </div>
            {f.intervalleAuto && f.intervalle && (
              <p class="discret petit">
                {f.chevaux.length > 1
                  ? "Chaque cheval reçoit l'intervalle de sa catégorie (retraite, compétition…) ou le sien."
                  : `Valeur proposée d'après les réglages${premier?.intervalles && Object.keys(premier.intervalles).length ? ' de ce cheval' : premier?.usage ? ` (${premier.usage})` : ''}.`}
              </p>
            )}
          </>
        )}
        {prochaine && f.type !== 'ordonnance' && (
          <p class="prochaine">
            {f.chevaux.length > 1 ? 'Prochaine échéance pour ces chevaux' : 'Prochaine échéance'} : <strong>{formater(prochaine)}</strong>
          </p>
        )}
      </fieldset>

      {erreur && <p class="erreur">{erreur}</p>}
      <button class="bouton large" type="submit">
        {f.chevaux.length > 1 ? `Enregistrer pour ${f.chevaux.length} chevaux` : 'Enregistrer'}
      </button>

      {existant && (
        <>
          <p class="discret petit trace">
            Saisi par {existant.creePar} le {new Date(existant.creeLe).toLocaleDateString('fr-FR')}
            {existant.modifieLe !== existant.creeLe && ` · modifié par ${existant.modifiePar} le ${new Date(existant.modifieLe).toLocaleDateString('fr-FR')}`}
            {existant.source && ` · ${existant.source}`}
          </p>
          <Historique journal={props.journal} />
          <button type="button" class="bouton-texte danger" onClick={supprimer}>
            Mettre à la corbeille
          </button>
        </>
      )}
    </form>
  );
}

function libellePraticien(t: TypeSoin): string {
  if (t === 'marechal') return 'Maréchal';
  if (t === 'vaccin' || t === 'veterinaire') return 'Vétérinaire';
  if (t === 'ordonnance') return 'Prescripteur';
  if (t === 'vermifuge') return 'Donné par';
  return 'Praticien';
}

function ChoixMultiple({ presents, choisis, onChange }: { presents: Cheval[]; choisis: string[]; onChange: (ids: string[]) => void }) {
  const [filtre, setFiltre] = useState('');
  const visibles = presents.filter((c) => cleNom(c.nom).includes(cleNom(filtre)));
  const tous = presents.length > 0 && presents.every((c) => choisis.includes(c.id));
  const basculer = (id: string) => onChange(choisis.includes(id) ? choisis.filter((x) => x !== id) : [...choisis, id]);
  return (
    <div class="choix-multiple">
      <div class="choix-tete">
        <button type="button" class="bouton-texte" onClick={() => onChange(tous ? [] : presents.map((c) => c.id))}>
          {tous ? 'Tout décocher' : `Tous les présents (${presents.length})`}
        </button>
        <span class="discret petit">{choisis.length} choisi(s)</span>
      </div>
      <input type="search" class="recherche petite" placeholder="Filtrer…" value={filtre} onInput={(e) => setFiltre((e.target as HTMLInputElement).value)} />
      <ul>
        {visibles.map((c) => (
          <li>
            <label>
              <input type="checkbox" checked={choisis.includes(c.id)} onChange={() => basculer(c.id)} />
              {c.nom}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const NOMS_CHAMPS: Record<string, string> = {
  date: 'Date',
  precision: 'Précision',
  praticien: 'Praticien',
  motif: 'Motif',
  cout: 'Coût',
  intervalle: 'Intervalle',
  prochaineManuelle: 'Prochain RDV',
  lienFacture: 'Lien facture',
  details: 'Détails',
  supprimeLe: 'Corbeille',
};

function valeurLisible(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formater(v);
  if (typeof v === 'object' && v && 'valeur' in v) return `${(v as Intervalle).valeur} ${(v as Intervalle).unite}`;
  if (typeof v === 'object')
    return (
      Object.entries(v as object)
        .filter(([, x]) => x !== null && x !== '')
        .map(([k, x]) => `${k} : ${valeurLisible(x)}`)
        .join(', ') || '—'
    );
  if (typeof v === 'string' && v.startsWith('data:image')) return 'signature';
  return String(v);
}

function Historique({ journal }: { journal: import('../model').EntreeJournal[] }) {
  const modifs = journal.filter((j) => j.operation !== 'creation');
  if (!modifs.length) return null;
  return (
    <details class="carte historique">
      <summary>Historique des modifications ({modifs.length})</summary>
      <ul>
        {modifs.map((j) => (
          <li>
            <strong>
              {new Date(j.le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}, {j.par}
            </strong>
            {j.operation === 'suppression' && ' : mis à la corbeille'}
            {j.operation === 'restauration' && ' : récupéré de la corbeille'}
            {j.operation === 'modification' && (
              <ul>
                {Object.entries(j.changements).map(([k, c]) => (
                  <li>
                    {NOMS_CHAMPS[k] ?? k} : {valeurLisible(c.avant)} → {valeurLisible(c.apres)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
