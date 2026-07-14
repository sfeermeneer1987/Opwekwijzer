// Doorgeefluik naar PVGIS (EU Joint Research Centre).
// PVGIS staat geen directe aanroepen vanuit de browser toe (geen CORS),
// dus deze functie geeft de vraag door en het antwoord terug.
// Voorbeeld: /api/pvgis.js?lat=52.2&lon=5.4&peakpower=1&loss=14&angle=35&aspect=0
//
// Rekentruc: we vragen ALTIJD peakpower=1 op en schalen daarna zelf met het
// werkelijke vermogen. Zo kost een paneel aan/uit tikken geen nieuwe API-call.
export default async function handler(req, res) {
  const q = req.query || {};
  if (!q.lat || !q.lon) {
    res.status(400).json({ error: 'lat en lon zijn verplicht' });
    return;
  }
  const p = new URLSearchParams({
    lat: q.lat,
    lon: q.lon,
    peakpower: q.peakpower || '1',
    loss: q.loss || '14',
    angle: q.angle || '35',
    aspect: q.aspect || '0',
    mountingplace: q.mountingplace || 'building',
    pvtechchoice: q.pvtechchoice || 'crystSi',
    outputformat: 'json'
  });

  try {
    const r = await fetch('https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?' + p.toString(),
      { headers: { Accept: 'application/json' } });
    const t = await r.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=2592000');   // een maand: de zon verandert niet
    res.setHeader('Content-Type', 'application/json');
    res.status(r.status).send(t);
  } catch (e) {
    res.status(502).json({ error: 'PVGIS niet bereikbaar: ' + (e && e.message ? e.message : 'onbekend') });
  }
}
