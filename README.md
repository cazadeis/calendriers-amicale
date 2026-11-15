# Calendriers Amicale

Application pour les tournées de calendriers de l'amicale des sapeurs-pompiers.
Elle fonctionne sans réseau, et les données sont dans un Google Sheet.

## Installation (une seule fois)

1. Ouvrir le Google Sheet, puis **Extensions > Apps Script**.
2. Effacer le contenu, coller celui de `Code.gs`, puis enregistrer.
3. **Déployer > Nouveau déploiement**, choisir le type **Application Web** :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
4. Autoriser l'accès quand Google le demande, puis copier l'**URL de l'application Web** (elle finit par `/exec`).
5. Le lien d'installation à envoyer aux équipiers est :
   `https://cazadeis.github.io/calendriers-amicale/#api=` suivi de l'URL copiée.
   Ne l'envoyez qu'à eux : quiconque a ce lien peut lire et écrire dans le Sheet.

Sur le téléphone, ouvrir le lien puis **Ajouter à l'écran d'accueil** (menu ⋮ sur Android, bouton Partager sur iPhone).

## Si vous modifiez Code.gs

**Déployer > Gérer les déploiements > ✏️ > Version : Nouvelle version**. L'URL reste la même.

## Vérifier

```
node test.js
```
