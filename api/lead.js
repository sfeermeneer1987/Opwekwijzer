/* ==================================================================
   /api/lead.js - de enige deur naar de leaddatabase.

   Waarom via de server en niet rechtstreeks vanuit de browser:
   - de databasesleutel blijft geheim (Vercel-omgevingsvariabele)
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

  // 3. Validatie - dezelfde regels als in de interface, nu ook hier.
  const naam = String(b.naam || '').trim();
  const email = String(b.email || '').trim();
  const telefoon = String(b.telefoon || '').trim();
  if (naam.length < 3) { res.status(400).json({ error: 'naam ontbreekt' }); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: 'e-mail ongeldig' }); return; }
  if (telefoon.replace(/\D/g, '').length < 9) { res.status(400).json({ error: 'telefoon ongeldig' }); return; }
  if (!['panelen', 'accu', 'beide'].includes(b.route)) { res.status(400).json({ error: 'route onbekend' }); return; }

  const num = v => (v === null || v === undefined || v === '' || !isFinite(v)) ? null : Number(v);

  const lead = {
    route: b.route,
    naam, email, telefoon,
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
    status: 'nieuw'
  };

  try {
    const r = await fetch(URL_ + '/rest/v1/opwekwijzer_leads', {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(lead)
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('supabase weigerde de lead:', r.status, t);
      res.status(502).json({ error: 'opslaan mislukt' });
      return;
    }
    // TODO (fase 2): hier de e-mail/pushmelding naar de kopende installateur.
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead-fout:', e);
    res.status(502).json({ error: 'opslaan mislukt' });
  }
}
