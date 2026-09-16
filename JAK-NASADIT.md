# Kapybaří diplomka — jak to dostat jí do telefonu

Tahle složka je celá appka. Nepotřebuje Clauda, účet ani internet (po prvním načtení).
Je to obyčejný statický web: nahraješ soubory, dostaneš odkaz.

## 1. GitHub Pages

Repozitář je tady už připravený a mám v něm první commit. Zbývá ho jen poslat na GitHub.

1. Na github.com založ nový repozitář, třeba `diplomka`. **Nezaškrtávej** README ani .gitignore,
   ať zůstane prázdný.
2. V téhle složce spusť (nahraď `TVUJ-UCET`):

```bash
git remote add origin https://github.com/TVUJ-UCET/diplomka.git && git branch -M main && git push -u origin main
```

3. Na GitHubu: **Settings → Pages → Source: Deploy from a branch → větev `main`, složka `/ (root)`** → Save.
4. Za minutu až dvě to běží na `https://TVUJ-UCET.github.io/diplomka/`. Ten odkaz jí pošli.

Repozitář může být klidně veřejný — nejsou v něm žádné údaje, jen appka. Pokud v něm ale
budou vaše fotky, dej ho **private**; Pages fungují i tak, jen je potřeba placený plán,
takže v tom případě raději fotky vynech a použij Netlify (níž).

Pozn.: `.nojekyll` v repozitáři už je — bez něj by GitHub soubory hnal přes Jekyll.

### Když budeš něco měnit

```bash
git add -A && git commit -m "uprava" && git push
```

Do dvou minut je to venku. **Po každé změně `index.html` zvedni verzi cache v `sw.js`**
(`kapybari-diplomka-v3` → `v4`), jinak jí prohlížeč bude dál servírovat starou verzi z offline cache.

### Alternativa bez gitu

[Netlify Drop](https://app.netlify.com/drop) — přetáhneš složku, za dvě minuty máš odkaz, bez účtu.
Hodí se, když nechceš fotky na GitHub.

## 2. Ať si to přidá na plochu

Na iPhonu: otevřít odkaz v **Safari** → Sdílet → **Přidat na plochu**.
Dostane ikonu s kapybarou a appka se spustí na celou obrazovku bez adresního řádku.

Tohle není kosmetika — data v Safari se po týdnu nepoužívání můžou sama smazat,
u appky přidané na plochu k tomu nedochází. Takže na plochu ano, jinak ne.

Na Androidu: Chrome → menu → Přidat na plochu.

## 3. Naplň truhly

Uprav `odmeny.json`:

```json
{ "id": "r1", "lvl": 2, "title": "Kafe na zavolání", "note": "Uvařím ti kafe.", "file": "kafe.jpg" }
```

- `lvl` — na jakém levelu se truhla odemkne
- `file` — název fotky ze složky `fotky/` (nebo `null`, když fotka není)
- `id` — nech být, podle něj se truhla poznává

Pak commit a push. Její postup se tím nesmaže — odměny se berou ze serveru, postup má
uložený zvlášť v telefonu.

Fotky zmenši na šířku ~1600 px, ať se to na mobilu načítá rychle.

> Rychlá varianta: v appce zapni **Profil → Režim Kryštof** a uprav truhly přímo tam.
> Zůstane to ale jen v tom zařízení, kde jsi to napsal. Aby to viděla ona, musí to být v `odmeny.json`.

## 4. Co jí říct

- **Termín odevzdání** ať vyplní v Profilu jako první věc. Bez něj se nerozvrhne čas.
- **Rozvrh** jí sám rozdělí úkoly po týdnech. Kouká se jen na aktuální týden, zbytek ji nemusí zajímat.
- Co za týden nestihne, **samo spadne do dalšího** — nikde se nehromadí červený dluh.
- **Zálohu** ať si jednou za čas stáhne v Profilu a pošle si ji mailem.

## 5. Centrální ukládání a upozornění (Cloudflare Worker)

Tohle je nepovinný krok. Bez něj appka funguje, jen si postup pamatuje zvlášť
na každém zařízení a neumí posílat upozornění. S ním se postup srovnává mezi
telefonem a notebookem, přežije rozbitý telefon, a ráno přijde připomínka.

Všechno se vejde do free tieru Cloudflare — platit nebudeš nic.

### Co budeš potřebovat

Účet na [cloudflare.com](https://dash.cloudflare.com/sign-up) (zdarma) a Node,
který už máš. Nic se neinstaluje natrvalo, `npx` si wrangler stáhne sám.

### Postup

```bash
cd E:\claude\diplomka_gamified\web\worker
npx wrangler login
```

**1. Databáze.** Vytvoř ji a vlož vypsané `database_id` do `wrangler.toml`
místo `SEM-VLOZ-ID-DATABAZE`:

```bash
npx wrangler d1 create kapybari-diplomka
```

**2. Tabulky:**

```bash
npx wrangler d1 execute kapybari-diplomka --remote --file=schema.sql
```

**3. Klíče pro upozornění.** Vygeneruj si **vlastní** — ty z ukázky nepoužívej:

```bash
node gen-vapid.mjs
```

Tajný JWK ulož jako secret (vloží se interaktivně, nikam se nezapíše):

```bash
npx wrangler secret put VAPID_JWK
```

Veřejný klíč dopiš do `wrangler.toml` do sekce `[vars]`:

```toml
VAPID_PUBLIC = "BI5Z…"
```

**4. Odkud se smí volat.** V `wrangler.toml` přepiš `ALLOW_ORIGIN` z `"*"` na adresu
svých Pages, ať se k API nedostane cizí stránka:

```toml
ALLOW_ORIGIN = "https://tvujucet.github.io"
```

**5. Nasazení:**

```bash
npx wrangler deploy
```

Vypíše adresu typu `https://kapybari-diplomka.tvujucet.workers.dev`. Tu si zkopíruj.

### Zapnutí v appce

1. V appce **Profil → Synchronizace** vlož adresu workeru a veřejný klíč.
2. Klikni **Zapnout synchronizaci**. Objeví se **párovací kód**.
3. Na druhém zařízení otevři stejnou appku, v Profilu vlož ten kód do pole
   „Párovací kód" a dej **Připojit se**. Od té chvíle mají obě zařízení stejná data.
4. Na telefonu (musí být přidaný na plochu) dej **Zapnout upozornění** a povol je.

Cron je nastavený na 7:00 UTC, což je 8:00 v zimě a 9:00 v létě. Změníš to v `wrangler.toml`
v sekci `[triggers]`. Upozornění chodí jen ve dny, kdy toho dne ještě nic neodškrtla —
appka ji neotravuje, když pracuje.

Vyzkoušet odeslání hned (bez čekání na ráno):

```bash
curl -X POST "https://…workers.dev/api/test-push?room=TVUJ-ROOM" -H "Authorization: Bearer TVUJ-TOKEN"
```

`room` a `token` najdeš v párovacím kódu (je to base64 s JSON uvnitř).

### Jak to řeší souběh

Obě zařízení si drží číslo revize. Když mezitím psalo to druhé, server vrátí konflikt
a appka obě verze **sloučí** — u každého úkolu vyhrává ten, kterého se někdo dotkl
naposledy. Odškrtnutí na mobilu a jiné odškrtnutí na notebooku se tedy sečtou,
nepřepíšou. Když je telefon offline, ukládá se lokálně a odešle, až bude signál.

### Bezpečnost

Přístup je na dvojici místnost + token, obojí náhodné a dost dlouhé. Kdo zná párovací
kód, vidí seznam úkolů — nikam ho neposílej veřejně. Nic citlivějšího než úkoly
a XP se na server neukládá; **fotky z truhel na serveru nejsou**, ty zůstávají
v `fotky/` v repozitáři nebo v tom jednom zařízení.

## Kde se co ukládá

| Co | Kde | Přežije |
|---|---|---|
| Postup, úkoly, XP, rozvrh | localStorage v zařízení, se zapnutou synchronizací i v D1 | restart, zavření, offline, výměnu telefonu |
| Fotky nahrané v appce | IndexedDB v tom zařízení | jen to jedno zařízení |
| Odměny a fotky od tebe | `odmeny.json` + `fotky/` na hostingu | všude, pro oba |
| Záloha | JSON soubor ke stažení | kdekoliv ho uloží |

Bez kroku 5 se postup **nesynchronizuje** — na mobilu a na notebooku by hrála dvě
různé hry. S krokem 5 se srovnává sám.
