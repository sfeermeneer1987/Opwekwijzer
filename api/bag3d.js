// Doorgeefluik naar de 3D BAG-API (TU Delft / Kadaster).
// De browser praat met ONS domein (zelfde origin), wij praten met api.3dbag.nl.
// Daarmee kan een CORS-blokkade het ophalen van het 3D-model nooit tegenhouden.
export default async function handler(req, res) {
  const id = String(req.query.id || '').replace(/[^0-9A-Za-z.\-]/g, '');
  if (!id) {
    res.status(400).json({ error: 'geen id' });
    return;
  }
  const fid = 'NL.IMBAG.Pand.' + id.replace(/^NL\.IMBAG\.Pand\./, '');
  const url = 'https://api.3dbag.nl/collections/pand/items/' + encodeURIComponent(fid);

  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      res.status(r.status).json({ error: 'bron gaf HTTP ' + r.status, id: fid });
      return;
    }
    const data = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: 'bron onbereikbaar: ' + (e && e.message ? e.message : 'onbekend') });
  }
}
