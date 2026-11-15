// node test.js : verifie la logique de l'application et du script Google.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const L = require('./app.js');

// --- Application ---
const data = {
  campagne: 2027, tournees: ['T1'], prenoms: ['Eric'],
  rues: [{ tournee: 'T1', rue: 'Rue B', ordre: 1 }, { tournee: 'T1', rue: 'Rue A', ordre: 2 }],
  foyers: [
    { id: 'f1', tournee: 'T1', rue: 'Rue B', numero: '10', complement: '' },
    { id: 'f2', tournee: 'T1', rue: 'Rue B', numero: '2', complement: '' },
    { id: 'f3', tournee: 'T1', rue: 'Rue B', numero: '2', complement: '1er gauche' },
  ],
  passages: [{ id: 'p1', date: '2026-11-15T09:00:00Z', tournee: 'T1', foyer_id: 'f1', prenom: 'Eric', statut: 'Absent' }],
};
const queue = [
  { type: 'Passages', data: { id: 'p2', date: '2026-11-15T10:00:00Z', tournee: 'T1', foyer_id: 'f1', prenom: 'Eric', statut: 'Don', montant: 10, mode: 'Espèces' } },
  { type: 'Passages', data: { id: 'p1', date: 'x', foyer_id: 'f1', statut: 'Refus' } }, // deja dans le Sheet : ignore
  { type: 'Foyers', data: { id: 'f4', tournee: 'T1', rue: 'Rue C', numero: '1' } },
  { type: 'Passages', data: { id: 'p3', date: '2026-11-15T11:00:00Z', tournee: 'T1', foyer_id: 'f2', prenom: 'Eric', statut: 'Don', montant: 15.5, mode: 'Chèque' } },
  { type: 'comment', data: { id: 'f2', commentaire: 'chien' } },
];
const d = L.vue(data, queue);
const m = L.parFoyer(d);
assert.equal(d.passages.length, 3);
assert.equal(L.statutDe(m, 'f1'), 'Don'); // le passage le plus recent l'emporte
assert.equal(L.statutDe(m, 'f3'), 'À faire');
assert.equal(d.foyers.find(f => f.id === 'f2').commentaire, 'chien');
assert.equal(data.foyers[1].commentaire, undefined); // les donnees d'origine ne sont pas modifiees
assert.deepEqual(L.ruesDe(d, 'T1'), ['Rue B', 'Rue A', 'Rue C']);
assert.deepEqual(L.foyersDe(d, 'T1', 'Rue B').map(f => f.id), ['f2', 'f3', 'f1']); // 2 < 2 1er gauche < 10
assert.deepEqual(L.stats(d, 'T1', m), { total: 4, faits: 2, repasser: 0, rdv: 0, montant: 25.5 });
const c = L.caisse(d, 'Eric', L.jourLocal('2026-11-15T10:00:00Z'));
assert.deepEqual([c.especes, c.cheques, c.nbCheques], [10, 15.5, 1]);
assert.equal(L.montant('12,50'), 12.5);
assert.ok(Number.isNaN(L.montant('')));

// --- Script Google sur un faux Sheet ---
const feuilles = {
  Listes: [['Tournées', '', '', 'Prénoms', '', 'Campagne en cours', 2027], ['T1 ', '', '', 'Eric', '', '', '']],
  Rues: [['tournee', 'rue', 'ordre']],
  Foyers: [['id', 'tournee', 'rue', 'numero', 'complement', 'commentaire', 'ajoute_par', 'ajoute_le'], ['', 'T1', 'Rue Z', '5', '', '', '', '']],
  Passages: [['id', 'date', 'campagne', 'tournee', 'foyer_id', 'prenom', 'statut', 'montant', 'mode', 'rdv'],
    ['old', new Date(), 2026, 'T1', 'f0', 'Eric', 'Don', 5, 'Espèces', '']],
  Caisse: [['id']],
};
const feuille = n => ({
  getDataRange: () => ({ getValues: () => feuilles[n].map(r => [...r]) }),
  getRange: (a, col) => typeof a === 'string'
    ? { getValues: () => feuilles[n].map(r => [r[0]]) }
    : { setValue: v => { feuilles[n][a - 1][col - 1] = v; } },
  appendRow: r => feuilles[n].push(r),
});
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: feuille }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }) },
  Utilities: { getUuid: () => 'abcdef12-3456' },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8'), ctx);

const get = ctx.doGet();
assert.deepEqual(get.tournees, ['T1']);
assert.equal(get.foyers[0].id, 'fabcdef12'); // id donne au foyer saisi a la main
assert.equal(get.passages.length, 0); // campagne 2026 exclue

const ops = [
  { opId: 'o1', type: 'Foyers', data: { id: 'f9', tournee: 'T1', rue: 'Rue Z', numero: '7', ajoute_le: '2026-11-15T10:00:00Z' } },
  { opId: 'o2', type: 'Passages', data: { id: 'p9', date: '2026-11-15T10:00:00Z', campagne: 2027, tournee: 'T1', foyer_id: 'f9', statut: 'Don', montant: 20, mode: 'Chèque' } },
  { opId: 'o3', type: 'comment', data: { id: 'f9', commentaire: 'sonner fort' } },
  { opId: 'o4', type: 'Rues', data: { tournee: 'T1', rue: 'Rue Z', ordre: 1 } },
];
const post = o => ctx.doPost({ postData: { contents: JSON.stringify({ ops: o }) } });
assert.deepEqual(post(ops).fait, ['o1', 'o2', 'o3', 'o4']);
post(ops); // renvoi apres une coupure reseau : rien ne doit etre double
assert.equal(feuilles.Foyers.length, 3);
assert.equal(feuilles.Passages.length, 3);
assert.equal(feuilles.Rues.length, 2);
assert.equal(feuilles.Foyers[2][5], 'sonner fort');
assert.equal(Object.prototype.toString.call(feuilles.Passages[2][1]), '[object Date]');
assert.equal(ctx.doGet().passages[0].montant, 20);
assert.equal(post([{ opId: 'x', type: 'Foyers' }]).ok, false); // saisie invalide : erreur, rien de perdu cote telephone

console.log('OK');
