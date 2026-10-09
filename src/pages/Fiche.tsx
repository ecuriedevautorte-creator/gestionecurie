import type { ComponentChildren } from 'preact';
import { ageEnAnnees, ajouterJours, annee, aujourdhui, ecartJours, formater, moisEnLettres } from '../dates';
import { db, useLive } from '../db';
import { calculerEcheances, statutDuSoin, statutOrdonnance, type Statut } from '../echeances';
import { enregistrerCheval, trancherConflit } from '../ecriture';
import { reduirePhoto } from '../photo';
import { emplacementsDe, nomEmplacement } from '../plan';
import { useState } from 'preact/hooks';
import { formaterEuros } from '../import/excel';
import { DUREE_GESTATION_JOURS, estPresent, LIBELLES_SOIN, type Cheval, type Conflit, type EntreeJournal, type Saillie, type Soin, type TypeSoin } from '../model';

const ICONES: Record<TypeSoin, string> = {
  veterinaire: '🩺',
  ordonnance: '💊',
  marechal: '🔨',
  osteo: '🤲',
  dentiste: '🦷',
  vaccin: '💉',
  vermifuge: '🪱',
};

export function PageFiche({ id, utilisateur }: { id: string; utilisateur: string }) {
  const ref = aujourdhui();
  const d = useLive(async () => {
    const cheval = await db.chevaux.get(id);
    if (!cheval) return { cheval: null };
    const nbDocuments = (await db.documents.where('chevalId').equals(id).toArray()).filter((x) => !x.supprimeLe).length;
    const [soins, saillies, tousChevaux, proprietaire] = await Promise.all([
      db.soins.where('chevalId').equals(id).toArray(),
      db.saillies.toArray(),
      db.chevaux.toArray(),
      cheval.proprietaireId ? db.proprietaires.get(cheval.proprietaireId) : undefined,
    ]);
    return { cheval, soins: soins.filter((s) => !s.supprimeLe), saillies, tousChevaux, proprietaire, nbDocuments };
  }, [id]);

  if (!d) return null;
  if (!d.cheval) {
    return (
      <div class="page">
        <a href="#/" class="retour">
          ← Chevaux
        </a>
        <p>Ce cheval n'existe pas ou a été supprimé.</p>
      </div>
    );
  }
  const { cheval: c, soins, saillies, tousChevaux, proprietaire, nbDocuments } = d;
  const present = estPresent(c, ref);
  const echeances = calculerEcheances([c], soins, ref);
  const sesSaillies = saillies.filter((s) => s.jumentId === c.id).sort((a, b) => ((a.dateSaillie ?? '') < (b.dateSaillie ?? '') ? 1 : -1));
  const naissanceDe = saillies.find((s) => s.poulainId === c.id);
  const parId = new Map(tousChevaux!.map((x) => [x.id, x]));
  const aVerifier = [...(c.aVerifier ?? []), ...soins.flatMap((s) => (s.aVerifier ?? []).map((m) => `${LIBELLES_SOIN[s.type]} du ${formater(s.date)} : ${m}`)), ...sesSaillies.flatMap((s) => s.aVerifier ?? [])];

  return (
    <div class="page">
      <a href="#/" class="retour">
        ← Chevaux
      </a>
      <header class="titre-fiche">
        <div class="titre-haut">
          <div class="titre-identite">
            <h1>{c.nom}</h1>
            <p class="discret">
              {[c.race, c.sexe, c.robe].filter(Boolean).join(' · ')}
              {c.naissance && ` · ${c.naissanceAnneeSeule ? `né${c.sexe === 'Femelle' ? 'e' : ''} en ${annee(c.naissance)}` : ageLisible(c.naissance, ref)}`}
            </p>
            <span class={present ? 'pastille verte' : 'pastille grise'}>{present ? 'Présent' : `Sorti le ${formater(c.sortie)}`}</span>
            {c.usage && <span class="pastille bleue"> {c.usage}</span>}
            {emplacementsDe(c).length > 0 && present && (
              <a class="pastille beige" href="#/plan">
                📍 {emplacementsDe(c).map(nomEmplacement).join(' · ')}
              </a>
            )}
          </div>
          <PhotoFiche cheval={c} utilisateur={utilisateur} />
        </div>
        <div class="actions-fiche">
          <a class="bouton" href={`#/soin/nouveau?cheval=${c.id}`}>
            + Ajouter un soin
          </a>
          <a class="bouton secondaire" href={`#/cheval/${c.id}/modifier`}>
            Modifier
          </a>
        </div>
        <Export id={c.id} />
        <a class="lien-documents" href={`#/documents/${c.id}`}>
          📁 Documents{nbDocuments ? ` (${nbDocuments})` : ''}
        </a>
      </header>

      {aVerifier.length > 0 && (
        <div class="bandeau">
          <strong>À vérifier</strong>
          <ul>
            {aVerifier.map((m) => (
              <li>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <Conflits
        utilisateur={utilisateur}
        liste={[
          ...(c.conflits ?? []).map((x) => ({ table: 'chevaux' as const, id: c.id, quoi: 'Fiche', conflit: x })),
          ...soins.flatMap((s) => (s.conflits ?? []).map((x) => ({ table: 'soins' as const, id: s.id, quoi: `${LIBELLES_SOIN[s.type]} du ${formater(s.date)}`, conflit: x }))),
          ...sesSaillies.flatMap((s) => (s.conflits ?? []).map((x) => ({ table: 'saillies' as const, id: s.id, quoi: 'Suivi de poulinière', conflit: x }))),
        ]}
      />

      <Section titre="Prochaines échéances">
        {!present ? (
          <p class="discret">Cheval sorti : plus d'alerte.</p>
        ) : echeances.length === 0 ? (
          <p class="discret">Aucune échéance enregistrée.</p>
        ) : (
          <ul class="echeances">
            {echeances.map((e) => (
              <li>
                <span>
                  {e.libelle}
                  <span class="discret petit"> · dernier le {formater(e.soin.date)}</span>
                </span>
                <span class="echeance-date">
                  {formater(e.prochaine)}
                  <PastilleStatut statut={e.statut} jours={e.joursRestants} />
                  <a class="fait" href={`#/soin/nouveau?depuis=${e.soin.id}`}>
                    ✓ Fait
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Frais soins={soins} />

      <Section titre="Identité">
        <dl class="identite">
          <Champ nom="Date de naissance" valeur={c.naissance ? (c.naissanceAnneeSeule ? `${annee(c.naissance)} (année seule)` : formater(c.naissance)) : ''} />
          <Champ nom="Père" valeur={c.pere} />
          <Champ nom="Mère" valeur={c.mere} />
          <Champ nom="Propriétaire" valeur={proprietaire ? [proprietaire.nom, proprietaire.adresse].filter(Boolean).join('\n') : ''} />
          <Champ nom="N° SIRE" valeur={c.sire} />
          <Champ nom="N° transpondeur" valeur={c.transpondeur} />
          <Champ nom="Usage" valeur={c.usage ?? ''} />
          <Champ nom="Date d'entrée" valeur={formater(c.entree)} />
          <Champ nom="Date de sortie" valeur={formater(c.sortie)} />
          <Champ nom="Motif de sortie" valeur={c.motifSortie} />
          <Champ nom="Destination" valeur={c.destination} />
          <Champ nom="Notes" valeur={c.notes} />
        </dl>
      </Section>

      {(sesSaillies.length > 0 || naissanceDe) && (
        <Section titre="Élevage">
          {naissanceDe && (
            <p>
              Né{c.sexe === 'Femelle' ? 'e' : ''} de{' '}
              <a href={`#/cheval/${naissanceDe.jumentId}`}>{parId.get(naissanceDe.jumentId)?.nom}</a> et {naissanceDe.etalon}
              {naissanceDe.poulinage && `, pouliné le ${formater(naissanceDe.poulinage)}`}.
            </p>
          )}
          {sesSaillies.map((s) => (
            <CarteSaillie saillie={s} poulain={s.poulainId ? parId.get(s.poulainId) : undefined} ref_={ref} />
          ))}
        </Section>
      )}

      <Section titre={`Historique des soins (${soins.length})`}>
        <Frise soins={soins} cheval={c} ref_={ref} />
      </Section>
    </div>
  );
}

function ageLisible(naissance: string, ref: string): string {
  const ans = ageEnAnnees(naissance, ref);
  if (ans >= 1) return `${ans} an${ans > 1 ? 's' : ''}`;
  const mois = Math.floor(ecartJours(naissance, ref) / 30.44);
  return mois < 1 ? `${ecartJours(naissance, ref)} jours` : `${mois} mois`;
}

function Section(props: { titre: string; children: ComponentChildren }) {
  return (
    <section class="carte">
      <h2>{props.titre}</h2>
      {props.children}
    </section>
  );
}

function Champ({ nom, valeur }: { nom: string; valeur: string }) {
  return (
    <>
      <dt>{nom}</dt>
      <dd class={valeur ? '' : 'discret'}>{valeur || '—'}</dd>
    </>
  );
}

export function PastilleStatut({ statut, jours }: { statut: Statut; jours?: number }) {
  const classe = statut === 'EN RETARD' ? 'rouge' : statut === 'BIENTÔT' ? 'orange' : statut === 'OK' ? 'verte' : 'grise';
  let detail = '';
  if (jours !== undefined && statut === 'EN RETARD') detail = ` (${-jours} j)`;
  if (jours !== undefined && statut === 'BIENTÔT') detail = jours === 0 ? " (aujourd'hui)" : ` (${jours} j)`;
  return (
    <span class={`pastille ${classe}`}>
      {statut}
      {detail}
    </span>
  );
}

function Frais({ soins }: { soins: Soin[] }) {
  const avecCout = soins.filter((s) => s.cout !== null);
  const total = avecCout.reduce((t, s) => t + (s.cout ?? 0), 0);
  const parType = new Map<TypeSoin, number>();
  for (const s of avecCout) parType.set(s.type, (parType.get(s.type) ?? 0) + (s.cout ?? 0));
  const anneeEnCours = String(new Date().getFullYear());
  const totalAnnee = avecCout.filter((s) => s.date.startsWith(anneeEnCours)).reduce((t, s) => t + (s.cout ?? 0), 0);
  const inconnus = soins.filter((s) => s.cout === null && (s.type === 'veterinaire' || s.type === 'marechal')).length;
  return (
    <Section titre="Frais">
      <div class="totaux">
        <div>
          <span class="discret petit">Total</span>
          <strong class="gros">{formaterEuros(total)}</strong>
        </div>
        <div>
          <span class="discret petit">En {anneeEnCours}</span>
          <strong class="gros">{formaterEuros(totalAnnee)}</strong>
        </div>
      </div>
      {parType.size > 0 && (
        <ul class="repartition">
          {[...parType].map(([t, v]) => (
            <li>
              <span>{LIBELLES_SOIN[t]}</span>
              <span>{formaterEuros(v)}</span>
            </li>
          ))}
        </ul>
      )}
      {inconnus > 0 && <p class="discret petit">{inconnus} soin(s) sans coût connu.</p>}
    </Section>
  );
}

function CarteSaillie({ saillie: s, poulain, ref_ }: { saillie: Saillie; poulain?: Cheval; ref_: string }) {
  const terme = s.termeManuel ?? (s.dateSaillie ? ajouterJours(s.dateSaillie, DUREE_GESTATION_JOURS) : null);
  let statut: string;
  if (s.poulinage) statut = 'Pouliné';
  else if (terme && ref_ > terme) statut = 'À surveiller (terme dépassé)';
  else if (terme) statut = `Pleine · ${ecartJours(ref_, terme)} j restants`;
  else statut = 'Pleine';
  return (
    <div class="saillie">
      <p>
        <strong>Saillie {s.dateSaillie ? `du ${formater(s.dateSaillie)}` : '(date inconnue)'}</strong> par {s.etalon || 'étalon non précisé'}
      </p>
      <p class="discret">
        Terme prévu : {terme ? formater(terme) : '—'} · <span class={s.poulinage ? 'pastille verte' : 'pastille bleue'}>{statut}</span>
      </p>
      <ul class="petit">
        {s.echos
          .filter((e) => e.date || e.observation)
          .map((e, i) => (
            <li>
              Écho {i + 1} {e.date ? `du ${formater(e.date)}` : '(sans date)'} : {e.observation || '—'}
            </li>
          ))}
      </ul>
      {s.poulinage && (
        <p>
          Poulinage le {formater(s.poulinage)} : {s.poulainSexe && `${s.poulainSexe.toLowerCase()}, `}
          {poulain ? <a href={`#/cheval/${poulain.id}`}>{poulain.nom}</a> : s.poulainNom || 'poulain sans nom'}
        </p>
      )}
    </div>
  );
}

function Frise({ soins, cheval, ref_ }: { soins: Soin[]; cheval: Cheval; ref_: string }) {
  if (soins.length === 0) return <p class="discret">Aucun soin enregistré.</p>;
  const tries = [...soins].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const groupes: [string, Soin[]][] = [];
  for (const s of tries) {
    const m = moisEnLettres(s.date);
    if (groupes.length && groupes[groupes.length - 1][0] === m) groupes[groupes.length - 1][1].push(s);
    else groupes.push([m, [s]]);
  }
  return (
    <div class="frise">
      {groupes.map(([mois, liste]) => (
        <div class="frise-mois">
          <h3>{mois}</h3>
          <ol>
            {liste.map((s) => {
              const statut = s.type === 'ordonnance' ? null : statutDuSoin(s, soins, cheval, ref_);
              const ord = s.type === 'ordonnance' ? statutOrdonnance(s, ref_) : null;
              const lignes = [...new Set([s.motif, s.details.diagnostic, s.details.traitement, s.details.posologie].filter(Boolean).map(String))];
              return (
                <li class={`soin soin-${s.type}`} onClick={(ev) => (ev.target as HTMLElement).tagName !== 'A' && (location.hash = `#/soin/${s.id}`)}>
                  <span class="soin-icone" aria-hidden="true">
                    {ICONES[s.type]}
                  </span>
                  <div class="soin-corps">
                    <div class="soin-tete">
                      <strong>
                        {LIBELLES_SOIN[s.type]}
                        {s.precision && ` · ${s.precision}`}
                      </strong>
                      <span class="discret petit">{formater(s.date)}</span>
                    </div>
                    {lignes.map((t) => (
                      <p class="petit">{t}</p>
                    ))}
                    <p class="discret petit">
                      {[s.praticien, s.cout !== null ? formaterEuros(s.cout) : null].filter(Boolean).join(' · ')}
                      {s.lienFacture && (
                        <>
                          {' · '}
                          <a href={s.lienFacture} target="_blank" rel="noopener">
                            Facture
                          </a>
                        </>
                      )}
                    </p>
                    {s.details.signature && <img class="signature-soin" src={String(s.details.signature)} alt="Signature du vétérinaire" />}
                    {statut && <PastilleStatut statut={statut} />}
                    {ord && <span class={`pastille ${ord === 'En cours' ? 'orange' : 'grise'}`}>{ord}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function valeurLisible(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(vide)';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formater(v);
  if (typeof v === 'string' && v.startsWith('data:image')) return 'photo';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Deux gérants ont modifié le même champ sans voir la modification de l'autre : on choisit la bonne valeur. */
function Conflits(props: { utilisateur: string; liste: { table: EntreeJournal['table']; id: string; quoi: string; conflit: Conflit }[] }) {
  if (!props.liste.length) return null;
  return (
    <div class="bandeau">
      <strong>Modifications simultanées à vérifier</strong>
      <ul>
        {props.liste.map(({ table, id, quoi, conflit }) => (
          <li>
            {quoi}, champ « {conflit.champ} » :
            <div class="choix-conflit">
              {conflit.valeurs.map((v) => (
                <button class="bouton secondaire petit-bouton" onClick={() => trancherConflit(table, id, conflit.champ, v.valeur, props.utilisateur)}>
                  Garder « {valeurLisible(v.valeur)} » ({v.par})
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Export({ id }: { id: string }) {
  const [enCours, setEnCours] = useState<'' | 'excel' | 'pdf'>('');
  const [erreur, setErreur] = useState('');
  const lancer = async (format: 'excel' | 'pdf') => {
    setEnCours(format);
    setErreur('');
    try {
      const m = await import('../export/cheval');
      await (format === 'excel' ? m.exporterExcel(id) : m.exporterPdf(id));
    } catch (e) {
      console.error(e);
      setErreur("L'export n'a pas abouti.");
    }
    setEnCours('');
  };
  return (
    <div class="export">
      <span class="discret petit">Exporter la fiche :</span>
      <button class="bouton secondaire petit-bouton" disabled={!!enCours} onClick={() => lancer('excel')}>
        {enCours === 'excel' ? 'Préparation…' : 'Excel'}
      </button>
      <button class="bouton secondaire petit-bouton" disabled={!!enCours} onClick={() => lancer('pdf')}>
        {enCours === 'pdf' ? 'Préparation…' : 'PDF'}
      </button>
      {erreur && <span class="erreur petit">{erreur}</span>}
    </div>
  );
}

/** Photo à droite du nom : un appui l'agrandit ; sans photo, l'emplacement permet d'en ajouter une. */
function PhotoFiche({ cheval, utilisateur }: { cheval: Cheval; utilisateur: string }) {
  const [grande, setGrande] = useState(false);
  const [erreur, setErreur] = useState('');
  const choisir = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const fichier = input.files?.[0];
    input.value = '';
    if (!fichier) return;
    try {
      await enregistrerCheval({ ...cheval, photo: await reduirePhoto(fichier) }, utilisateur);
      setGrande(false);
      setErreur('');
    } catch {
      setErreur("Image illisible");
    }
  };
  const champFichier = <input type="file" accept="image/*" hidden onChange={choisir} />;
  if (!cheval.photo)
    return (
      <label class="photo-titre vide" title="Ajouter une photo">
        <span aria-hidden="true">📷</span>
        <span class="petit">{erreur || 'Ajouter une photo'}</span>
        {champFichier}
      </label>
    );
  return (
    <>
      <button type="button" class="photo-titre" onClick={() => setGrande(true)} aria-label={`Agrandir la photo de ${cheval.nom}`}>
        <img src={cheval.photo} alt="" />
      </button>
      {grande && (
        <div class="visionneuse" role="dialog" aria-label={`Photo de ${cheval.nom}`} onClick={(e) => e.target === e.currentTarget && setGrande(false)}>
          <img src={cheval.photo} alt={`Photo de ${cheval.nom}`} />
          <div class="visionneuse-actions">
            <label class="bouton secondaire">
              Changer la photo
              {champFichier}
            </label>
            <button
              type="button"
              class="bouton-texte"
              onClick={async () => {
                if (!confirm('Retirer la photo de ce cheval ?')) return;
                await enregistrerCheval({ ...cheval, photo: null }, utilisateur);
                setGrande(false);
              }}
            >
              Retirer
            </button>
            <button type="button" class="bouton" onClick={() => setGrande(false)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
}
