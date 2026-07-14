# OpwekWijzer

Onafhankelijke rekentool voor zonnepanelen en thuisbatterijen — en daarmee een leadmachine.
De consument berekent gratis wat zijn dak oplevert en welke accu bij hem past; met zijn
uitdrukkelijke toestemming gaat die berekening als compleet dossier naar één installatiebedrijf.

**Het onderscheid:** wij leveren geen naam met een telefoonnummer, maar een lead mét het echte dak
(3D BAG), de opbrengst per dakvlak (PVGIS) en een accu-advies in échte specificaties. Daar mag een
hogere prijs tegenover staan.

---

## Architectuur

Statische site + serverless functies. Geen build, geen framework — bewust: snel, goedkoop,
en over vijf jaar nog te onderhouden.

```
index.html        de funnel (3 routes: panelen / accu / beide)
opwek.js          de rekenmotor + leadverzending
roof.js           3D-dakmodel: BAG-model parsen, dakvlakken, paneelindeling
privacy.html      privacyverklaring (wettelijk vereist voor het leadmodel)
vercel.json       schone URL's + beveiligingsheaders
api/bag3d.js      proxy naar api.3dbag.nl   (CORS)
api/pvgis.js      proxy naar PVGIS (EU JRC) (CORS + maandcache)
api/lead.js       de enige deur naar de leaddatabase
```

### De funnel

1. **Keuze** — zonnepanelen, thuisbatterij, of beide.
2. **Route A (dak):** postcode + huisnummer → PDOK Locatieserver → pand-ID → 3D BAG-model →
   paneelindeling per dakvlak → PVGIS-opbrengst per vlak (1 kWp, geschaald naar het werkelijke
   vermogen).
3. **Route B (accu):** vier tikvragen, geen dak nodig — de kortste funnel, en de grootste
   doelgroep (iedereen die al panelen heeft).
4. **Teaser:** drie cijfers gratis (vertrouwen wint van schaarste).
5. **Gate:** naam/e-mail/telefoon + expliciete AVG-toestemming → lead → volledig rapport.

### Gegevensbronnen

| Bron | Waarvoor | Voorwaarden |
|---|---|---|
| 3D BAG (TU Delft/Kadaster) | het echte dak: vlakken, helling, azimut | open data |
| PDOK Locatieserver | adres → coördinaat + pand-ID | open data |
| PVGIS v5.3 (EU JRC) | opbrengst per dakvlak | gratis, ook commercieel; **geen CORS** → proxy verplicht |

PVGIS-azimut: `aspect = b3_azimut − 180` (BAG: 0=noord, 180=zuid; PVGIS: 0=zuid).

---

## Leaddatabase

Supabase, tabel `opwekwijzer_leads`. Row Level Security staat aan; de tabel is vanuit de browser
**niet** benaderbaar. Alle inserts lopen via `/api/lead.js`, dat serverzijdig valideert, de
toestemming afdwingt en een honeypot toepast.

Elke lead bewaart ook de exacte consent-tekst en het tijdstip — het bewijs dat de AVG vraagt.

### Omgevingsvariabelen (Vercel → Settings → Environment Variables)

```
SUPABASE_URL          https://<project>.supabase.co
SUPABASE_SERVICE_KEY  service-role key uit Supabase (GEHEIM — nooit in de repo)
```

Zonder deze twee weigert `/api/lead.js` te werken. Dat is opzet: liever een zichtbare fout dan
stilletjes leads verliezen.

---

## Deployen

De repo is gekoppeld aan Vercel. Elke commit op `main` gaat automatisch live (~30 sec).

Na de eerste koppeling:
1. Zet **Deployment Protection uit** (Settings → Deployment Protection), anders krijgt elke
   bezoeker een Vercel-inlogscherm.
2. Zet de twee omgevingsvariabelen.
3. Koppel het domein **opwekwijzer.nl** (Settings → Domains).

---

## Juridisch — niet optioneel

Dit bedrijf verhandelt persoonsgegevens. Drie dingen moeten kloppen, altijd:

1. **Toestemming** is expliciet, niet vooraf aangevinkt, en in gewone taal ("maximaal één
   installatiebedrijf"). De tekst wordt bij elke lead opgeslagen.
2. **Verwerkersovereenkomst / datadeel-overeenkomst** met elk installatiebedrijf dat leads afneemt:
   alleen gebruiken voor dit doel, niet doorverkopen, verwijderen na gebruik.
3. **Privacyverklaring** actueel houden (`privacy.html`), inclusief KvK-nummer zodra ingeschreven.

---

## Roadmap

- [ ] KvK-inschrijving + KvK-nummer in de privacyverklaring
- [ ] E-mail-/pushmelding naar de koper bij een nieuwe lead (`api/lead.js`, TODO staat er al)
- [ ] Koperportaal: leads bekijken, regiofilter, tegoed (fase 2)
- [ ] Campagnedomein salderstop.nl → route "accu" met utm-bron
- [ ] 3D-viewer in de consumentenfunnel (nu 2D-legplan)
- [ ] Prijsdifferentiatie: dossier-rijke leads duurder dan kale leads
