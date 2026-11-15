'use strict';

// ---------- Logique (testee dans test.js) ----------

const MODES = ['Espèces', 'Chèque', 'Virement/QR'];
const FAITS = ['Don', 'Refus', 'Ne pas repasser'];

// Donnees du Sheet + saisies pas encore envoyees.
function vue(data, queue) {
  const d = { ...data, rues: [...data.rues], foyers: data.foyers.map(f => ({ ...f })), passages: [...data.passages] };
  const ids = new Set([...d.foyers, ...d.passages].map(x => String(x.id)));
  const rueCle = r => r.tournee + '|' + r.rue;
  const rues = new Set(d.rues.map(rueCle));
  for (const { type, data: x } of queue) {
    if (type === 'Rues' && !rues.has(rueCle(x))) { d.rues.push(x); rues.add(rueCle(x)); }
    if (type === 'Foyers' && !ids.has(x.id)) { d.foyers.push({ ...x }); ids.add(x.id); }
    if (type === 'Passages' && !ids.has(x.id)) { d.passages.push(x); ids.add(x.id); }
    if (type === 'comment') { const f = d.foyers.find(f => f.id === x.id); if (f) f.commentaire = x.commentaire; }
  }
  return d;
}

// foyer_id -> passages tries du plus ancien au plus recent
function parFoyer(d) {
  const m = new Map();
  for (const p of [...d.passages].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    if (!m.has(p.foyer_id)) m.set(p.foyer_id, []);
    m.get(p.foyer_id).push(p);
  }
  return m;
}
const statutDe = (m, id) => { const l = m.get(id); return l ? l[l.length - 1].statut : 'À faire'; };

function ruesDe(d, t) {
  const ordre = new Map(d.rues.filter(r => r.tournee === t).map(r => [r.rue, Number(r.ordre) || 999]));
  for (const f of d.foyers) if (f.tournee === t && !ordre.has(f.rue)) ordre.set(f.rue, 999);
  return [...ordre].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0]), 'fr')).map(x => x[0]);
}

const nat = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'fr', { numeric: true });
function foyersDe(d, t, rue) {
  return d.foyers.filter(f => f.tournee === t && f.rue === rue)
    .sort((a, b) => nat(a.numero, b.numero) || nat(a.complement, b.complement));
}

function stats(d, t, m) {
  const s = { total: 0, faits: 0, repasser: 0, rdv: 0, montant: 0 };
  for (const f of d.foyers) {
    if (f.tournee !== t) continue;
    s.total++;
    const st = statutDe(m, f.id);
    if (FAITS.includes(st)) s.faits++;
    else if (st === 'Absent') s.repasser++;
    else if (st === 'Rendez-vous') s.rdv++;
  }
  for (const p of d.passages) if (p.tournee === t && p.statut === 'Don') s.montant += Number(p.montant) || 0;
  return s;
}

const jourLocal = x => {
  const t = new Date(x);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
};

function caisse(d, prenom, jour) {
  const c = { especes: 0, cheques: 0, nbCheques: 0, virements: 0, tournees: [] };
  for (const p of d.passages) {
    if (p.prenom !== prenom || p.statut !== 'Don' || jourLocal(p.date) !== jour) continue;
    const m = Number(p.montant) || 0;
    if (p.mode === 'Espèces') c.especes += m;
    else if (p.mode === 'Chèque') { c.cheques += m; c.nbCheques++; }
    else c.virements += m;
    if (!c.tournees.includes(p.tournee)) c.tournees.push(p.tournee);
  }
  return c;
}

const cents = n => Math.round(n * 100) / 100;
const montant = s => cents(parseFloat(String(s).replace(',', '.').replace(/\s/g, '')));

if (typeof module !== 'undefined') {
  module.exports = { vue, parFoyer, statutDe, ruesDe, foyersDe, stats, caisse, jourLocal, montant };
}

// ---------- Interface ----------

if (typeof document !== 'undefined') {
  const VIDE = { campagne: null, tournees: [], prenoms: [], rues: [], foyers: [], passages: [] };
  let S;
  try { S = JSON.parse(localStorage.getItem('cal')) || {}; } catch { S = {}; }
  S = { url: '', prenom: '', queue: [], lastSync: 0, ...S, data: { ...VIDE, ...(S.data || {}) } };

  const URL_OK = /^https:\/\/script\.google\.com\/.+\/exec$/;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const euro = n => cents(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const dateFr = x => new Date(String(x).replace(' ', 'T')).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function enregistrer() {
    try { localStorage.setItem('cal', JSON.stringify(S)); }
    catch { alert("Impossible d'enregistrer sur le téléphone (mémoire pleine ou navigation privée). Ne fermez pas l'application avant la synchronisation."); }
  }

  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2000);
  }

  // ----- Synchronisation -----
  let enCours = false;
  async function sync() {
    if (enCours || !S.url || !navigator.onLine) return badge();
    enCours = true;
    badge();
    try {
      if (S.queue.length) {
        const lot = S.queue.slice();
        const r = await (await fetch(S.url, { method: 'POST', body: JSON.stringify({ ops: lot }) })).json();
        if (!r.ok) throw new Error(r.erreur);
        S.queue = S.queue.filter(o => !r.fait.includes(o.opId));
        enregistrer();
      }
      S.data = { ...VIDE, ...(await (await fetch(S.url)).json()) };
      S.lastSync = Date.now();
      enregistrer();
      if (!['foyer', 'ajout', 'caisse'].includes(E.ecran)) afficher(); // ne pas effacer une saisie en cours
    } catch (e) {
      console.warn('sync', e);
    } finally {
      enCours = false;
      badge();
    }
  }

  function badge() {
    const n = S.queue.length;
    const h = new Date(S.lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    $('#sync').textContent = !S.url ? '⚙️ non configuré'
      : !navigator.onLine ? `📵 hors ligne${n ? ' · ' + n + ' en attente' : ''}`
      : enCours ? '🔄 synchro…'
      : n ? `⏳ ${n} en attente`
      : S.lastSync ? `✓ à jour ${h}` : '⚠️ jamais synchronisé';
    $('#sync').className = n ? 'attente' : '';
  }

  function ajouter(type, data) {
    S.queue.push({ opId: uid('o'), type, data });
    enregistrer();
    badge();
    sync();
  }

  // ----- Navigation -----
  let E = { ecran: 'accueil' };
  function aller(e) { history.pushState(e, ''); E = e; afficher(); scrollTo(0, 0); }
  onpopstate = ev => { E = ev.state || { ecran: 'accueil' }; afficher(); };

  function afficher() {
    const d = vue(S.data, S.queue);
    const m = parFoyer(d);
    let ecran = E.ecran;
    if (!S.url) ecran = 'config';
    else if (!d.tournees.length) ecran = 'attente';
    else if (!S.prenom) ecran = 'prenom';
    $('#main').innerHTML = ECRANS[ecran](d, m);
    $('#retour').hidden = !['tournee', 'ajout', 'foyer', 'caisse'].includes(ecran);
    $('#titre').hidden = !$('#retour').hidden;
    badge();
  }

  const ECRANS = {
    config: () => `
      <h2>Première ouverture</h2>
      <p>Ouvrez le <b>lien d'installation</b> qui vous a été envoyé, ou collez ci-dessous l'adresse du script Google (elle se termine par <code>/exec</code>).</p>
      <input id="url" placeholder="https://script.google.com/macros/s/…/exec">
      <button class="btn" data-a="url">Valider</button>`,

    attente: () => `
      <h2>Connexion au Google Sheet…</h2>
      <p>Il faut du réseau pour le premier chargement. Si rien ne se passe, vérifiez qu'au moins une tournée est saisie dans l'onglet <b>Listes</b> du Sheet.</p>
      <button class="btn" data-a="sync">Réessayer</button>
      <button class="lien" data-a="reset">Changer l'adresse du script</button>`,

    prenom: d => `
      <h2>Qui êtes-vous ?</h2>
      ${d.prenoms.map(p => `<button class="btn" data-a="choisir" data-v="${esc(p)}">${esc(p)}</button>`).join('')}`,

    accueil: (d, m) => `
      ${d.tournees.map(t => {
        const s = stats(d, t, m);
        return `<button class="carte" data-a="tournee" data-v="${esc(t)}">
          <b>${esc(t)}</b><span class="m">${euro(s.montant)}</span>
          <span>${s.faits}/${s.total} faits · ${s.repasser} à repasser${s.rdv ? ' · ' + s.rdv + ' RDV' : ''}</span>
          <progress max="${s.total || 1}" value="${s.faits}"></progress></button>`;
      }).join('')}
      <button class="btn" data-a="caisse">💰 Caisse du jour</button>
      <button class="lien" data-a="changer">${esc(S.prenom)} · changer de prénom</button>`,

    tournee: (d, m) => {
      const t = E.tournee;
      const garder = { tous: () => true, afaire: s => s === 'À faire', repasser: s => s === 'Absent', rdv: s => s === 'Rendez-vous' }[E.filtre];
      const filtres = [['tous', 'Tous'], ['afaire', 'À faire'], ['repasser', 'Repasser'], ['rdv', 'RDV']]
        .map(([k, l]) => `<button class="${E.filtre === k ? 'sel' : ''}" data-a="filtre" data-v="${k}">${l}</button>`).join('');
      const blocs = ruesDe(d, t).map(rue => {
        const fs = foyersDe(d, t, rue).filter(f => garder(statutDe(m, f.id)));
        if (!fs.length && E.filtre !== 'tous') return '';
        return `<h3>${esc(rue)}</h3>
          ${fs.map(f => {
            const l = m.get(f.id) || [];
            const st = statutDe(m, f.id);
            const der = l[l.length - 1];
            return `<button class="foyer s${['À faire', 'Don', 'Absent', 'Refus', 'Ne pas repasser', 'Rendez-vous'].indexOf(st)}" data-a="foyer" data-v="${esc(f.id)}">
              <span>${esc(f.numero)}${f.complement ? ' · ' + esc(f.complement) : ''}${f.commentaire ? ' 💬' : ''}</span>
              <small>${st === 'Rendez-vous' && der.rdv ? 'RDV ' + dateFr(der.rdv) : st === 'Don' ? euro(Number(der.montant) || 0) : esc(st)}${l.length > 1 ? ' · ' + l.length + ' passages' : ''}</small></button>`;
          }).join('') || '<p class="vide">Aucun foyer, ajoutez-les au fil des portes.</p>'}
          ${E.filtre === 'tous' ? `<button class="plus" data-a="ajout" data-v="${esc(rue)}">+ foyer dans ${esc(rue)}</button>` : ''}`;
      }).join('');
      return `<h2>${esc(t)}</h2><div class="filtres">${filtres}</div>${blocs || '<p class="vide">Rien ici.</p>'}
        ${E.filtre === 'tous' ? '<button class="btn" data-a="rue">+ Ajouter une rue</button>' : ''}`;
    },

    ajout: () => `
      <h2>Nouveau foyer</h2><p>${esc(E.rue)} · ${esc(E.tournee)}</p>
      <label>Numéro<input id="num" inputmode="text" autocomplete="off" placeholder="12, 12 bis…"></label>
      <label>Complément (immeuble)<input id="cpl" autocomplete="off" placeholder="2e gauche, RDC fond…"></label>
      <button class="btn" data-a="creer">Créer et ouvrir la fiche</button>`,

    foyer: (d, m) => {
      const f = d.foyers.find(f => f.id === E.id);
      if (!f) return '<p>Foyer introuvable.</p>';
      const l = m.get(f.id) || [];
      return `
        <h2>${esc(f.numero)} ${esc(f.rue)}</h2>${f.complement ? `<p class="cpl">${esc(f.complement)}</p>` : ''}
        <p>Statut : <b>${esc(statutDe(m, f.id))}</b></p>
        <section class="don">
          <label>Montant du don (€)<input id="montant" inputmode="decimal" autocomplete="off" placeholder="10"></label>
          <div class="modes">${MODES.map(x => `<button data-a="mode" data-v="${x}">${x}</button>`).join('')}</div>
          <button class="btn ok" data-a="don">✅ Enregistrer le don</button>
        </section>
        <div class="grille">
          <button data-a="statut" data-v="Absent">🔁 Absent</button>
          <button data-a="statut" data-v="Refus">❌ Refus</button>
          <button data-a="statut" data-v="Ne pas repasser">⛔ Ne pas repasser</button>
          <button data-a="rdvouvrir">📅 Rendez-vous</button>
        </div>
        <div id="rdvbox" hidden><input type="datetime-local" id="rdv"><button class="btn" data-a="rdv">Valider le rendez-vous</button></div>
        <label>Commentaire<textarea id="com" rows="2" placeholder="Chien, sonner fort, après 18h…">${esc(f.commentaire)}</textarea></label>
        <button class="lien" data-a="com">Enregistrer le commentaire</button>
        ${l.length ? `<h3>Passages</h3><ul>${l.slice().reverse().map(p => `<li>${dateFr(p.date)} · ${esc(p.prenom)} · ${esc(p.statut)}${p.statut === 'Don' ? ' ' + euro(Number(p.montant) || 0) + ' (' + esc(p.mode) + ')' : ''}${p.rdv ? ' · RDV ' + dateFr(p.rdv) : ''}</li>`).join('')}</ul>` : ''}`;
    },

    caisse: d => {
      const c = caisse(d, S.prenom, jourLocal(Date.now()));
      E.c = c;
      return `
        <h2>Caisse du jour · ${esc(S.prenom)}</h2>
        <table>
          <tr><td>Espèces attendues</td><td>${euro(c.especes)}</td></tr>
          <tr><td>Chèques attendus</td><td>${euro(c.cheques)} (${c.nbCheques})</td></tr>
          <tr><td>Virements / QR (pour info)</td><td>${euro(c.virements)}</td></tr>
        </table>
        <label>Espèces comptées (€)<input id="esp" inputmode="decimal" data-i="ecart"></label>
        <label>Montant des chèques comptés (€)<input id="chq" inputmode="decimal" data-i="ecart"></label>
        <label>Nombre de chèques<input id="nbchq" inputmode="numeric" data-i="ecart"></label>
        <p id="ecart"></p>
        <button class="btn" data-a="caisseok">Enregistrer le comptage</button>`;
    },
  };

  // ----- Actions -----
  let modeChoisi = '';

  function passage(statut, extra = {}) {
    const f = vue(S.data, S.queue).foyers.find(f => f.id === E.id);
    const com = $('#com').value.trim();
    if (com !== String(f.commentaire ?? '')) ajouter('comment', { id: f.id, commentaire: com });
    ajouter('Passages', {
      id: uid('p'), date: new Date().toISOString(), campagne: S.data.campagne, tournee: f.tournee,
      foyer_id: f.id, prenom: S.prenom, statut, montant: '', mode: '', rdv: '', ...extra,
    });
    toast(statut === 'Don' ? 'Don enregistré 👍' : statut + ' enregistré');
    history.back();
  }

  function ecart() {
    const v = id => montant($(id).value) || 0;
    const e = cents(v('#esp') + v('#chq') - E.c.especes - E.c.cheques);
    const nb = parseInt($('#nbchq').value) || 0;
    $('#ecart').innerHTML = `Écart : <b class="${e ? 'ko' : 'okt'}">${e > 0 ? '+' : ''}${euro(e)}</b>`
      + (nb !== E.c.nbCheques ? ` · <b class="ko">${nb} chèque(s) au lieu de ${E.c.nbCheques}</b>` : '');
    return e;
  }

  const A = {
    url: () => {
      const u = $('#url').value.trim();
      if (!URL_OK.test(u)) return alert("Adresse invalide : elle doit commencer par https://script.google.com/ et finir par /exec");
      S.url = u; enregistrer(); afficher(); sync();
    },
    reset: () => { if (confirm("Effacer l'adresse du script ?")) { S.url = ''; enregistrer(); afficher(); } },
    sync: () => sync(),
    choisir: v => { S.prenom = v; enregistrer(); afficher(); },
    changer: () => { S.prenom = ''; enregistrer(); afficher(); },
    tournee: v => aller({ ecran: 'tournee', tournee: v, filtre: 'tous' }),
    filtre: v => { E.filtre = v; history.replaceState(E, ''); afficher(); },
    caisse: () => aller({ ecran: 'caisse' }),
    rue: () => {
      const nom = (prompt('Nom de la rue') || '').trim();
      if (!nom) return;
      const d = vue(S.data, S.queue);
      const max = Math.max(0, ...d.rues.filter(r => r.tournee === E.tournee).map(r => Number(r.ordre) || 0));
      ajouter('Rues', { tournee: E.tournee, rue: nom, ordre: max + 1 });
      afficher();
    },
    ajout: v => aller({ ecran: 'ajout', tournee: E.tournee, rue: v }),
    creer: () => {
      const numero = $('#num').value.trim();
      const complement = $('#cpl').value.trim();
      if (!numero && !complement) return alert('Indiquez au moins un numéro ou un complément.');
      const d = vue(S.data, S.queue);
      const deja = d.foyers.find(f => f.tournee === E.tournee && f.rue === E.rue
        && String(f.numero).toLowerCase() === numero.toLowerCase() && String(f.complement ?? '').toLowerCase() === complement.toLowerCase());
      const id = deja ? deja.id : uid('f');
      if (!deja) {
        ajouter('Foyers', { id, tournee: E.tournee, rue: E.rue, numero, complement, commentaire: '', ajoute_par: S.prenom, ajoute_le: new Date().toISOString() });
      }
      // la fiche remplace le formulaire : "retour" ramene a la tournee
      modeChoisi = '';
      E = { ecran: 'foyer', id }; history.replaceState(E, ''); afficher();
    },
    foyer: v => { modeChoisi = ''; aller({ ecran: 'foyer', id: v }); },
    mode: (v, el) => {
      modeChoisi = v;
      document.querySelectorAll('.modes button').forEach(b => b.classList.toggle('sel', b === el));
    },
    don: () => {
      const v = montant($('#montant').value);
      if (!(v > 0)) return alert('Indiquez le montant du don.');
      if (!modeChoisi) return alert('Choisissez le moyen de paiement.');
      passage('Don', { montant: v, mode: modeChoisi });
    },
    statut: v => passage(v),
    rdvouvrir: () => { $('#rdvbox').hidden = false; $('#rdv').focus(); },
    rdv: () => {
      const v = $('#rdv').value;
      if (!v) return alert('Choisissez la date et l\'heure du rendez-vous.');
      passage('Rendez-vous', { rdv: v.replace('T', ' ') });
    },
    com: () => {
      ajouter('comment', { id: E.id, commentaire: $('#com').value.trim() });
      toast('Commentaire enregistré');
    },
    caisseok: () => {
      const e = ecart();
      const c = E.c;
      ajouter('Caisse', {
        id: uid('c'), date: new Date().toISOString(), campagne: S.data.campagne, prenom: S.prenom, tournee: c.tournees.join(', '),
        especes_attendues: cents(c.especes), especes_comptees: montant($('#esp').value) || 0,
        cheques_attendus: cents(c.cheques), cheques_comptes: montant($('#chq').value) || 0,
        nb_cheques_attendus: c.nbCheques, nb_cheques_comptes: parseInt($('#nbchq').value) || 0, ecart: e,
      });
      toast('Comptage enregistré');
      history.back();
    },
  };

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-a]');
    if (el) A[el.dataset.a](el.dataset.v, el);
  });
  document.addEventListener('input', ev => { if (ev.target.dataset.i === 'ecart') ecart(); });

  // Lien d'installation : https://…/#api=<adresse du script>. Le # ne part jamais sur le reseau.
  const api = new URLSearchParams(location.hash.slice(1)).get('api');
  if (api && URL_OK.test(api)) { S.url = api; enregistrer(); }
  history.replaceState(E, '', location.pathname);

  addEventListener('online', sync);
  addEventListener('offline', badge);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(sync, 30000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  navigator.storage?.persist?.();
  afficher();
  sync();
}
