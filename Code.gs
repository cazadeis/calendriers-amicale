// Calendriers Amicale : fait le lien entre l'application et ce Google Sheet.
// A coller dans Extensions > Apps Script, puis Deployer > Nouveau deploiement > Application Web.

const COLONNES = {
  Rues: ['tournee', 'rue', 'ordre'],
  Foyers: ['id', 'tournee', 'rue', 'numero', 'complement', 'commentaire', 'ajoute_par', 'ajoute_le'],
  Passages: ['id', 'date', 'campagne', 'tournee', 'foyer_id', 'prenom', 'statut', 'montant', 'mode', 'rdv'],
  Caisse: ['id', 'date', 'campagne', 'prenom', 'tournee', 'especes_attendues', 'especes_comptees',
    'cheques_attendus', 'cheques_comptes', 'nb_cheques_attendus', 'nb_cheques_comptes', 'ecart'],
};
const DATES = ['date', 'ajoute_le'];

function feuille_(nom) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nom); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
// Rues n'a pas d'id : une rue est unique par tournee + nom.
function cle_(nom, r) { return nom === 'Rues' ? r[0] + '|' + r[1] : String(r[0]); }

function lignes_(nom) {
  const v = feuille_(nom).getDataRange().getValues();
  const h = v.shift();
  return v.filter(r => r.some(c => c !== ''))
    .map(r => Object.fromEntries(h.map((k, i) => [k, typeof r[i] === 'string' ? r[i].trim() : r[i]])));
}

// Foyers ajoutes a la main dans le Sheet sans id : on leur en donne un.
function idsManquants_() {
  const sh = feuille_('Foyers');
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (v[i][0] === '' && v[i][2] !== '') sh.getRange(i + 1, 1).setValue('f' + Utilities.getUuid().slice(0, 8));
  }
}

function doGet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    idsManquants_();
    const l = feuille_('Listes').getDataRange().getValues();
    const campagne = l[0][6];
    const liste = i => l.slice(1).map(r => String(r[i]).trim()).filter(x => x !== '');
    return json_({
      campagne,
      tournees: liste(0),
      prenoms: liste(3),
      rues: lignes_('Rues'),
      foyers: lignes_('Foyers'),
      passages: lignes_('Passages').filter(p => p.campagne == campagne),
    });
  } finally {
    lock.releaseLock();
  }
}

// Recoit les saisies en attente des telephones. Une saisie renvoyee deux fois
// (reseau coupe pendant la reponse) n'est ecrite qu'une fois grace a son id.
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ops = JSON.parse(e.postData.contents).ops || [];
    const vus = {};
    const fait = [];
    for (const op of ops) {
      const d = op.data;
      if (op.type === 'comment') {
        const sh = feuille_('Foyers');
        const i = sh.getRange('A:A').getValues().flat().map(String).indexOf(d.id);
        if (i > 0) sh.getRange(i + 1, 6).setValue(d.commentaire);
      } else if (COLONNES[op.type]) {
        const sh = feuille_(op.type);
        if (!vus[op.type]) vus[op.type] = new Set(sh.getDataRange().getValues().map(r => cle_(op.type, r)));
        const ligne = COLONNES[op.type].map(k => (DATES.includes(k) && d[k] ? new Date(d[k]) : (d[k] ?? '')));
        const cle = cle_(op.type, ligne);
        if (!vus[op.type].has(cle)) {
          sh.appendRow(ligne);
          vus[op.type].add(cle);
        }
      }
      fait.push(op.opId);
    }
    return json_({ ok: true, fait });
  } catch (err) {
    return json_({ ok: false, erreur: String(err) });
  } finally {
    lock.releaseLock();
  }
}
