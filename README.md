# StudentHUB

Študentský portál pre približne 200 študentov:
- odovzdávanie prác,
- rozvrh hodín,
- súkromné a skupinové správy,
- nástenka v štýle sticky notes,
- register študentov,
- administrácia s hromadným preposielaním prác lektorom.

**Technológie:** web beží na **GitHub Pages**, dáta a prihlasovanie zabezpečuje **Firebase** (Authentication, Firestore, Storage).

## Úrovne prístupu

| | Študent | Admin |
|---|---|---|
| Domov s nástenkou | číta | píše, upravuje, pripína oznamy |
| Rozvrh | číta, filtruje podľa krúžku | pridáva a upravuje hodiny |
| Práce | iba svoje: nahráva, sťahuje, maže, kým nie sú odoslané | všetky: filtruje, sťahuje ZIP, posiela lektorovi |
| Správy | súkromné správy; v skupinách iba čítajú | súkromné správy, skupiny a hromadná správa všetkým |
| Log | – | všetka aktivita v portáli |
| Prehľad spotreby | – | využitie bezplatných limitov, upozornenie pri 75 % |
| Register | zoznam schválených študentov | + export CSV, schvaľovanie, roly |
| Nastavenia | – | zapína a vypína funkcie, limit veľkosti súboru |

Súkromné správy nečíta ani admin. Študent nevidí cudzie práce ani administráciu. Neplatí to len pre zobrazenie: rovnaké obmedzenia vynucujú aj pravidlá Firebase, takže ich nemožno obísť.

## Náklady

| Služba | Plán | Cena pre StudentHUB |
|---|---|---|
| GitHub Pages | Free | 0 € |
| Firebase Authentication | Spark/Blaze | 0 € (zadarmo do 50 000 používateľov) |
| Firestore (databáza) | Spark/Blaze | 0 € (1 GB, 50 000 čítaní a 20 000 zápisov denne) |
| Firebase Storage (súbory) | **Blaze** | 0 € do 5 GB v regióne `us-central1`, `us-east1` alebo `us-west1` |

Firebase Storage pri nových projektoch vyžaduje plán **Blaze** (treba pridať kartu). V rámci bezplatných limitov nič nezaplatíš, ale určite si nastav **upozornenie na rozpočet** (krok 1.6).

---

## 1. Firebase projekt

1. <https://console.firebase.google.com> → **Add project** → `studenthub`. Odporúčam samostatný projekt, nie niektorý z tvojich existujúcich. Google Analytics môžeš vypnúť.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Build → Firestore Database → Create database**:
   - región `eur3 (Europe)`,
   - **Start in production mode**.

   Potom **Rules** → vlož obsah `firebase/firestore.rules` → **Publish**.
4. **Upgrade** na plán Blaze (vľavo dole).
5. **Build → Storage → Get started**:
   - región `us-central1` (bezplatný limit platí len pre US regióny),
   - production mode.

   Potom **Rules** → vlož obsah `firebase/storage.rules` → **Publish**. Firebase sa opýta, či môže Storage čítať Firestore: potvrď.
6. **Rozpočet:** <https://console.cloud.google.com/billing> → **Budgets & alerts** → **Create budget**, suma napr. 1 €, upozornenie e-mailom pri 50 % a 100 %.
7. **Project settings** (ozubené koleso) → **General → Your apps → Web (</>)**:
   - zaregistruj aplikáciu (Firebase Hosting nezaškrtávaj),
   - skopíruj hodnoty `firebaseConfig` do `js/config.js`.

> Hodnoty v `config.js` sú verejné a smú byť na GitHube. Dáta chránia pravidlá v priečinku `firebase/`.

## 2. GitHub Pages

1. Na GitHube vytvor repozitár `studenthub`. Bezplatné GitHub Pages vyžadujú verejný repozitár: verejný je však len kód, nie dáta študentov.
2. Nahraj doň všetky súbory z tohto priečinka.
3. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → Save.
4. O minútu je portál na `https://TVOJE-MENO.github.io/studenthub/`.
5. Vo Firebase: **Authentication → Settings → Authorized domains → Add domain** → `TVOJE-MENO.github.io`.

## 3. Povolenie sťahovania súborov (CORS)

Prehliadač smie sťahovať súbory zo Storage iba z povolenej adresy.

1. V `firebase/cors.json` prepíš `TVOJE-MENO` na svoje GitHub meno.
2. Otvor <https://console.cloud.google.com> (vyber projekt `studenthub`).
3. Vpravo hore klikni na ikonu **Cloud Shell**.
4. Nahraj tam `cors.json` (menu ⋮ → Upload).
5. Spusti (názov bucketu nájdeš vo Firebase → Storage, napr. `studenthub-xxxx.firebasestorage.app`):

```bash
gcloud storage buckets update gs://NAZOV-BUCKETU --cors-file=cors.json
```

## 4. Prvý administrátor

1. Otvor portál → **Registrácia** → zaregistruj sa.
2. Vo Firebase: **Firestore Database → Data → users →** tvoj dokument:
   - pole `approved` zmeň na `true`,
   - pole `role` zmeň na `admin`.
3. Obnov stránku a uvidíš menu **Administrácia**.

## 5. Ako sa študenti dostanú do portálu

Sú dve možnosti:
- **Študenti sa zaregistrujú sami.** Pošli im odkaz a v *Administrácia → Používatelia* ich schváľ. Kým nie sú schválení, nevidia nič.
- **Admin pridá študenta** cez *Pridať študenta*. Portál vygeneruje dočasné heslo, ktoré mu pošleš. Študent si ho potom zmení v *Môj profil*.

Každý má vlastné heslo. Zabudnuté heslo sa obnovuje odkazom z e-mailu, ktorý posiela Firebase.

## 6. Kde sú práce uložené a ako sú chránené

- **Úložisko:** súkromný bucket Cloud Storage v projekte. Súbory nemajú verejnú adresu.
- **Prístup:** každý študent zapisuje a číta iba v priečinku `submissions/<jeho-id>/`. Všetky práce vidí iba admin. Pravidlá overujú prihlásenie aj schválenie účtu pri každej požiadavke.
- **Šifrovanie:** prenos ide cez HTTPS, dáta v úložisku Google šifruje (AES-256).
- **Limity:** maximálne 50 MB na súbor. Admin si v nastaveniach zvolí vlastný limit (predvolene 30 MB). Povolené typy: pdf, doc(x), odt, ppt(x), xls(x), zip, rar, 7z, obrázky.
- **Kapacita:** do 5 GB zadarmo, čo je napríklad 200 študentov × 5 prác × 5 MB. Pri raste nad limit Google účtuje zhruba 0,02 € za GB mesačne.
- **Zálohy:** na konci semestra si admin stiahne všetky práce cez *Administrácia → Práce → Stiahnuť ZIP* a staré môže zmazať.

## 7. Ako portál šetrí bezplatný limit databázy

Bezplatný Firestore dovoľuje 50 000 čítaní denne. Portál je navrhnutý tak, aby sa doň s rezervou zmestil aj pri 200 aktívnych študentoch:

- **Cache v prehliadači.** Register, nástenka, rozvrh, predmety, zadania a nastavenia sa ukladajú v prehliadači. Malý dokument `meta/versions` obsahuje čas poslednej zmeny každej z týchto častí. Pri prihlásení sa prečíta iba tento jeden dokument a celá zbierka sa stiahne znova, len ak ju admin medzičasom zmenil.
- **Živé aktualizácie.** Keď admin pridá oznam alebo zmení rozvrh, študentom s otvoreným portálom sa nástenka aj rozvrh obnovia samy.
- **Správy po častiach.** Otvorenie konverzácie načíta posledných 25 správ, staršie až po kliknutí na *Načítať staršie správy*.
- **Lokálna cache Firestore.** Ak sa študent vráti do 30 minút, odbery správ účtujú iba zmenené dokumenty.
- **Admin a práce.** V preposielaní sa predvolene načítajú iba práce, ktoré ešte neboli odoslané lektorovi.
- **Súkromie.** Po odhlásení sa cache v prehliadači zmaže, takže na zdieľanom počítači nezostanú kontakty študentov.

Orientačne: bežné prihlásenie a prezretie portálu stojí 5 až 15 čítaní (namiesto 200 a viac). Pri 200 študentoch a niekoľkých návštevách denne to vychádza na niekoľko tisíc čítaní z 50 000. Aktuálnu spotrebu vidíš vo Firebase → **Firestore Database → Usage**.

### Koľko spotrebujú správy

| Akcia | Zápisy | Čítania |
|---|---|---|
| Odoslanie správy | 2 (správa + konverzácia) a 1 do logu | 1 za každého člena, ktorý má portál otvorený |
| Otvorenie konverzácie | – | až 25 (staršie správy až na požiadanie) |
| Otvorenie portálu | – | 1 za každú konverzáciu, v ktorej je študent členom |

Príklad: 100 aktívnych študentov denne pošle po 10 správach a 5-krát otvorí konverzáciu. To je asi 3 000 zápisov (z 20 000) a do 15 000 čítaní (z 50 000). Hromadná správa všetkým (200 členov) stojí 2 zápisy a do 200 čítaní.

## 8. Log aktivít

Menu **Log** vidia iba admini. Zaznamenáva:
- prihlásenie, registráciu, otvorenie portálu a odhlásenie,
- každú zobrazenú stránku,
- odovzdanie, stiahnutie a zmazanie prác,
- odoslanie správ (komu, ale nikdy obsah) a vytvorenie konverzácií,
- všetky zmeny, ktoré robia admini (schvaľovanie, roly, nástenka, rozvrh, predmety, nastavenia, preposielanie prác).

Pri každom zázname je čas, meno, e-mail, rola a typ zariadenia (počítač/mobil). Log sa dá filtrovať, exportovať do CSV a záznamy staršie ako 90 dní jedným klikom zmazať. Každý záznam stojí 1 zápis do databázy.

**GDPR:** študentom oznám, že portál zaznamenáva ich aktivitu a kto ju vidí.

## 9. Presná spotreba – Cloud Function

Karta **Administrácia → Prehľad** ukazuje odhad úložiska hneď. Presné čísla z Google Cloud (čítania a zápisy v databáze za dnešok, obsadené úložisko, stiahnuté dáta za mesiac) dodáva malá Cloud Function v priečinku `functions/`. Beží raz za hodinu a tlačidlom *Obnoviť teraz* aj na požiadanie. Ak niektorý limit prekročí 75 %, admini uvidia upozornenie na vrchu každej stránky.

Nasadenie (iba raz, projekt musí byť na pláne Blaze):

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
cd functions && npm install && cd .. && firebase deploy --only functions
```

Funkcia beží v regióne `europe-west1` a pri hodinovom spúšťaní sa zmestí do bezplatného limitu Cloud Functions aj Cloud Scheduler.

## 10. Poznámky

- Firebase projekty sa neuspávajú pri nečinnosti.
- **GDPR:** register obsahuje osobné údaje. Študentom daj vedieť, kto ich vidí. Pri odchode zo školy ich deaktivuj alebo zmaž (*Authentication → Users* a dokument v `users`).
- Vyhľadávače portál neindexujú (`noindex`).

## Štruktúra

```
index.html                vstupná stránka
css/style.css             vzhľad (svetlý/tmavý režim, mobil)
js/config.js              ← tu vyplníš Firebase konfiguráciu
js/lib.js                 Firebase, pomocné funkcie
js/icons.js               vektorové ikony
js/main.js                prihlásenie, menu, navigácia
js/views/*.js             jednotlivé stránky portálu
firebase/firestore.rules  pravidlá databázy
firebase/storage.rules    pravidlá súborov
firebase/cors.json        povolenie sťahovania z GitHub Pages
functions/                Cloud Function pre presnú spotrebu Firebase
NAPADY.md                 návrhy ďalších funkcií
```
