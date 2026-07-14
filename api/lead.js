/* ==================================================================
   /api/lead.js — de enige deur naar de leaddatabase.

   Waarom via de server en niet rechtstreeks vanuit de browser:
   - de databasesleutel blijft geheim (staat in een Vercel-omgevingsvariabele)
   - toestemming wordt hier afgedwongen, niet alleen in de interface
   - een simpele honeypot houdt bots buiten
   - dit is straks ook de plek voor de e-mailmelding aan de koper

   Vereiste omgevingsvariabelen (Vercel -> Settings -> Environment Variables):
     SUPABASE_URL          https://xxxx.supabase.co
     SUPABASE_SERVICE_KEY  de service-role key (GEHEIM, nooit in de repo)
================================================================== */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'alleen POST' });
    return;
  }

  const URL_ = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL_ || !KEY) {
    res.status(500).json({ error: 'server niet geconfigureerd' });
    return;
  }

  const b = req.body || {};

  // 1. Honeypot: een veld dat mensen nooit invullen, bots wel.
  if (b.website) {
    res.status(200).json({ ok: true });   // stilletjes weggooien
    return;
  }

  // 2. Toestemming is niet onderhandelbaar. Zonder consent geen lead.
  if (b.consent !== true || !b.consent_tekst) {
    res.status(400).json({ error: 'geen toestemming' });
    return;
  }

  // 3. Validatie. Stap A = naam + e-mail (lead wordt al opgeslagen als 'partieel').
  //    Stap B voegt telefoon + belvoorkeur toe en maakt de lead verkoopbaar.
  const stap = (b.stap === 'B') ? 'B' : 'A';
  const naam = String(b.naam || '').trim();
  const email = String(b.email || '').trim();
  const telefoon = String(b.telefoon || '').trim();
  if (naam.length < 3) { res.status(400).json({ error: 'naam ontbreekt' }); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: 'e-mail ongeldig' }); return; }
  if (stap === 'B' && telefoon.replace(/\D/g, '').length < 9) {
    res.status(400).json({ error: 'telefoon ongeldig' }); return;
  }
  if (!['panelen', 'accu', 'beide'].includes(b.route)) { res.status(400).json({ error: 'route onbekend' }); return; }

  const num = v => (v === null || v === undefined || v === '' || !isFinite(v)) ? null : Number(v);

  const lead = {
    route: b.route,
    naam, email,
    telefoon: telefoon || null,
    belvoorkeur: b.belvoorkeur || null,
    postcode: b.postcode || null,
    huisnummer: b.huisnummer || null,
    adres: b.adres || null,
    pand_id: b.pand_id || null,
    verbruik: num(b.verbruik),
    contract: b.contract || null,
    fase: b.fase || null,
    aantal_panelen: num(b.aantal_panelen),
    kwp: num(b.kwp),
    opwek: num(b.opwek),
    besparing: num(b.besparing),
    tvt: num(b.tvt),
    accu_kwh: num(b.accu_kwh),
    accu_modules: num(b.accu_modules),
    accu_kw: num(b.accu_kw),
    accu_merk: b.accu_merk || null,
    dossier: b.dossier || null,
    bron: String(b.bron || 'direct').slice(0, 120),
    consent: true,
    consent_tekst: String(b.consent_tekst).slice(0, 2000),
    // 'partieel' = alleen naam + e-mail (nog niet verkoopbaar, wel te mailen)
    // 'nieuw'    = compleet met telefoon, klaar om aan een installateur te verkopen
    status: stap === 'B' ? 'nieuw' : 'partieel'
  };
  if (stap === 'B') lead.compleet_at = new Date().toISOString();

  const kop = {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'Content-Type': 'application/json'
  };

  try {
    // Stap B op een bestaande lead: bijwerken in plaats van dubbel opslaan.
    if (stap === 'B' && b.lead_id) {
      const u = await fetch(URL_ + '/rest/v1/opwekwijzer_leads?id=eq.' + encodeURIComponent(b.lead_id), {
        method: 'PATCH',
        headers: Object.assign({}, kop, { Prefer: 'return=representation' }),
        body: JSON.stringify({
          telefoon: lead.telefoon,
          belvoorkeur: lead.belvoorkeur,
          status: 'nieuw',
          compleet_at: lead.compleet_at
        })
      });
      if (u.ok) {
        const rij = await u.json();
        if (Array.isArray(rij) && rij.length) {
          // TODO (fase 2): melding naar de kopende installateur - snelheid is de conversieknop.
          res.status(200).json({ ok: true, id: b.lead_id });
          return;
        }
      }
      // lukte het bijwerken niet, dan valt hij hieronder alsnog als nieuwe rij binnen
    }

    const r = await fetch(URL_ + '/rest/v1/opwekwijzer_leads', {
      method: 'POST',
      headers: Object.assign({}, kop, { Prefer: 'return=representation' }),
      body: JSON.stringify(lead)
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('supabase weigerde de lead:', r.status, t);
      res.status(502).json({ error: 'opslaan mislukt' });
      return;
    }
    const rij = await r.json();
    const id = Array.isArray(rij) && rij[0] ? rij[0].id : null;
    // TODO (fase 2): bij stap B meteen de installateur mailen.
    res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error('lead-fout:', e);
    res.status(502).json({ error: 'opslaan mislukt' });
  }
}
