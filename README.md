# Kapybaří diplomka

Gamifikovaný tracker diplomové práce. Etapy s bossy, XP a levely, 16 kapybar ve sbírce,
týdenní rozvrh a truhly s odměnami.

Statický web — žádný build, žádné závislosti. Běží z GitHub Pages.

## Soubory

| Soubor | K čemu je |
|---|---|
| `index.html` | celá aplikace |
| `odmeny.json` | truhly s odměnami — tohle se upravuje |
| `fotky/` | fotky k odměnám |
| `sw.js` | offline režim; **při každé změně appky zvedni verzi cache** |
| `manifest.webmanifest`, `icon-*.png` | ikona a chování po přidání na plochu |
| `JAK-NASADIT.md` | návod krok za krokem |
| `worker/` | nepovinný backend na Cloudflare — centrální data a upozornění |

## Kde se ukládají data

Ve výchozím stavu všechno lokálně: postup (úkoly, XP, rozvrh) v `localStorage`,
fotky nahrané v appce v `IndexedDB`. Žádný server se nepoužívá.

Se zapnutou synchronizací (`worker/`) se postup navíc ukládá do Cloudflare D1
a srovnává mezi zařízeními. Slučuje se po jednotlivých úkolech podle toho, kdy se
kterého někdo naposledy dotkl, takže souběžná práce na mobilu a notebooku se nepřepisuje.
Fotky na server nejdou nikdy.

Zálohu si uživatel stáhne jako JSON v sekci Profil.
