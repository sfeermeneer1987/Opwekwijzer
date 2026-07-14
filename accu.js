/* ==================================================================
   OpwekWijzer — accu.js  (v1.0.0)
   De omslagpunt-motor.

   Waarom dit bestand bestaat: tot nu toe was de accu een extraatje onderin het
   rapport. Vanaf 2027 is hij de hoofdvraag. Reden: teruglevering gaat geld
   KOSTEN. Elke kWh die de accu opslaat levert daardoor twee keer op — u koopt
   hem niet in (€0,28) én u betaalt er geen terugleverkosten over (€0,11).

   Alles is instelbaar, want elk contract is anders. Wat we niet doen: de
   uitkomst mooier maken dan hij is. Kan de accu niet uit, dan zeggen we dat.
================================================================== */
window.Accu = (function(){
"use strict";

const STD = {
  prijs:      0.28,    // €/kWh die u betaalt aan uw leverancier
  vergoed:    0.00,    // €/kWh die u terugkrijgt (vast contract, ná salderen)
  vergoedDyn: 0.052,   // idem bij dynamisch: gemiddelde uurprijs op zonuren
  kosten:     0.11,    // €/kWh terugleverkosten  <-- hier zit het omslagpunt
  vast:       0,       // €/maand vaste terugleverkosten
  cycli:      280,     // volle laadbeurten per jaar (realistisch, geen 365)
  retour:     0.89,    // rendement heen/terug (Enphase, AC-gekoppeld)
  deg:        0.0045,  // achteruitgang panelen per jaar
  jaren:      25,
  garJaar:    15, garCycli: 6000     // Enphase: 15 jaar of 6.000 cycli
};

// richtprijs geïnstalleerd — TODO: vervangen zodra Marco echte inkoopprijzen geeft
const PRIJSKAART = cap => Math.round(1500 + 800*cap);

const nl   = (v,d) => (Number(v)||0).toLocaleString('nl-NL',
                {minimumFractionDigits:d||0, maximumFractionDigits:d||0});
const euro = v => '€ ' + nl(v,0);

/* ---------- één jaar, met een accu van 'cap' kWh (cap=0 is: geen accu) ---------- */
function jaar(d, cap, o){
  const overschot = Math.max(0, (d.opwek||0) - (d.zelf0||0));
  const avondgat  = Math.max(0, (d.verbruik||0) - (d.zelf0||0));  // wat later nog open staat

  const opgeslagen = cap<=0 ? 0 : Math.min(
    cap * o.cycli * o.retour,   // wat de accu fysiek per jaar kan rondpompen
    overschot,                  // meer dan er over is, kan hij niet opslaan
    avondgat                    // en meer dan u later gebruikt, heeft geen zin
  );
  const terug = overschot - opgeslagen;

  return {
    cap,
    opgeslagen: Math.round(opgeslagen),
    terug: Math.round(terug),
    geld: Math.round(
        ((d.zelf0||0) + opgeslagen) * o.prijs   // dit hoeft u niet in te kopen
      + terug * o.vergoed                       // hier krijgt u iets voor
      - terug * o.kosten                        // en hier betáált u voor
      - o.vast * 12
    )
  };
}

function tvt(extra, prijs, o){
  if(extra <= 0) return null;
  let cum = 0;
  for(let j=1; j<=o.jaren; j++){
    const jr = extra * Math.pow(1-o.deg, j-1);
    if(cum + jr >= prijs) return Math.round((j-1 + (prijs-cum)/jr)*10)/10;
    cum += jr;
  }
  return null;                    // niet binnen 25 jaar terugverdiend
}

function reken(d, keuze){
  const o = Object.assign({}, STD, keuze||{});
  if(d.contract !== 'vast' && (!keuze || keuze.vergoed == null)) o.vergoed = o.vergoedDyn;

  const nul = jaar(d, 0, o);
  const garantie = Math.min(o.garJaar, o.garCycli/o.cycli);

  const maten = [5,10,15].map(cap=>{
    const m = jaar(d, cap, o);
    const extra = m.geld - nul.geld;
    const prijs = PRIJSKAART(cap);
    const t = tvt(extra, prijs, o);
    return Object.assign(m, {extra, prijs, tvt:t, rendabel: !!(t && t <= garantie)});
  });

  // De beste is niet de grootste, maar die zichzelf het snelst terugverdient.
  const beste = maten.filter(m=>m.tvt).sort((a,b)=>a.tvt-b.tvt)[0] || null;

  return {
    opties:o, garantie, zonder:nul, maten, beste,
    winstPerKwh: Math.round((o.prijs - o.vergoed + o.kosten)*100)/100,
    kostenNu: Math.round(nul.terug * o.kosten)     // wat teruglevering u straks kóst
  };
}

/* ---------- de tabel ---------- */
function tabelHTML(r){
  let h = '<table class="rtab"><tr>'
    + '<th>Accu</th><th>Slaat op</th><th>Levert op</th><th>Kost</th><th>Terugverdiend</th></tr>';
  r.maten.forEach(m=>{
    const merk = (r.beste && m.cap===r.beste.cap) ? ' class="top"' : '';
    h += '<tr'+merk+'>'
      + '<td><b>'+m.cap+' kWh</b></td>'
      + '<td>'+nl(m.opgeslagen)+' kWh</td>'
      + '<td>'+euro(m.extra)+' /jr</td>'
      + '<td>'+euro(m.prijs)+'</td>'
      + '<td>'+(m.tvt ? nl(m.tvt,1)+' jr '+(m.rendabel?'✓':'⚠️') : '> 25 jr')+'</td>'
      + '</tr>';
  });
  return h + '</table>';
}

/* ---------- het advies — de reden dat mensen dit doorsturen ---------- */
function adviesHTML(r, d){
  const o = r.opties;
  let h = '';

  if(!r.beste){
    return '<div class="adviesblok"><b>Eerlijk advies: wacht nog even met een accu</b>'
      + 'Bij uw verbruik verdient geen enkele maat zichzelf binnen 25 jaar terug. Meestal komt dat '
      + 'doordat u het grootste deel van uw opwek al direct zelf gebruikt — er valt simpelweg weinig '
      + 'op te slaan. Laat uw installatie wél accu-klaar opleveren, dan kunt u later alsnog bijzetten.</div>';
  }

  const b = r.beste;
  h += '<div class="adviesblok"><b>Ons advies: '+b.cap+' kWh</b>'
    + 'Die verdient zichzelf het snelst terug: '+nl(b.tvt,1)+' jaar. '
    + (b.rendabel ? 'Dat is binnen de garantie van '+nl(r.garantie)+' jaar. '
                  : 'Dat is net búiten de garantie van '+nl(r.garantie)+' jaar — reken uzelf niet rijk. ')
    + 'Elke kWh die u opslaat is <b>€ '+nl(r.winstPerKwh,2)+'</b> waard: u koopt hem niet in, '
    + 'én u betaalt er geen terugleverkosten over.</div>';

  // waarom groter niet altijd beter is — hier hebben mensen echt iets aan
  const groot = r.maten[r.maten.length-1];
  if(groot.cap > b.cap && groot.opgeslagen <= b.opgeslagen * 1.15){
    h += '<div class="adviesblok"><b>Groter is bij u niet beter</b>'
      + 'Een accu van '+groot.cap+' kWh slaat nauwelijks meer op dan die van '+b.cap+' kWh ('
      + nl(groot.opgeslagen)+' tegen '+nl(b.opgeslagen)+' kWh per jaar). U loopt tegen uw eigen dak '
      + 'en verbruik aan: er is niet méér overschot om in te stoppen. Betaalt u toch voor die extra '
      + 'kilowattuur, dan koopt u lucht.</div>';
  }

  if(r.kostenNu > 0){
    h += '<div class="adviesblok"><b>Wat teruglevering u straks kost</b>'
      + 'Zonder accu levert u '+nl(r.zonder.terug)+' kWh per jaar terug. Bij € '+nl(o.kosten,2)
      + ' terugleverkosten per kWh betaalt u daarvoor <b>'+euro(r.kostenNu)+' per jaar</b> — in plaats '
      + 'van dat u er iets aan verdient. Dat is precies het bedrag dat een accu voor u wegneemt.</div>';
  }

  if(d.contract === 'vast'){
    h += '<div class="adviesblok"><b>Met een dynamisch contract wordt dit beter</b>'
      + 'U rekent nu met een vast tarief. Bij dynamische uurprijzen kan de accu óók laden wanneer '
      + 'stroom bijna niets kost, en dat verkort de terugverdientijd verder. Laat de installateur '
      + 'dit voor uw situatie doorrekenen.</div>';
  }
  return h;
}

/* ---------- CSS die de landingspagina nog niet kent ---------- */
function css(){
  if(document.getElementById('accuCss')) return;
  const s=document.createElement('style');
  s.id='accuCss';
  s.textContent='.tik.vier{grid-template-columns:1fr 1fr 1fr 1fr}'
    +'#accuBlok .rtab th{font-size:11.5px}'
    +'#knopPdf{margin-top:18px;width:100%}';
  document.head.appendChild(s);
}

/* ---------- het blok in het rapport, met de tarief-schuif ---------- */
function blok(d, doel, tarief){
  if(!doel) return null;
  css();
  const r = reken(d, (tarief!=null) ? {kosten: tarief} : null);
  const nu = r.opties.kosten;

  doel.innerHTML =
      '<h3>De thuisbatterij — uw omslagpunt</h3>'
    + '<div class="tikkop">Wat rekent uw leverancier voor teruglevering?</div>'
    + '<div class="tik vier" id="tkKosten">'
    + [0, 0.08, 0.11, 0.15].map(v=>
        '<button data-v="'+v+'"'+(Math.abs(v-nu)<0.001?' class="aan"':'')+'>'
        + (v===0 ? 'niets' : '€ '+nl(v,2)) + '</button>').join('')
    + '</div>'
    + '<div class="klein" style="margin:-2px 0 12px">Weet u het niet? € 0,11 is het huidige marktpeil '
    + 'bij vaste contracten. Kies “niets” om te zien wat er zónder terugleverkosten overblijft.</div>'
    + tabelHTML(r)
    + adviesHTML(r, d)
    + '<div class="klein">Richtprijzen inclusief installatie (marktpeil) — uw installateur maakt de '
    + 'exacte prijs. Gerekend met '+r.opties.cycli+' laadbeurten per jaar en '
    + nl(r.opties.retour*100)+'% rendement heen/terug.</div>';

  doel.querySelectorAll('#tkKosten button').forEach(b=>{
    b.addEventListener('click', ()=> blok(d, doel, parseFloat(b.dataset.v)));
  });

  d.accu = r;              // het rapport en de PDF lezen dit uit
  return r;
}

/* ---------- PDF: printweergave, dan “Opslaan als PDF” ----------
   Bewust geen PDF-bibliotheek: die weegt honderden kilobytes en breekt op
   mobiel. De printdialoog van de telefoon doet dit beter, en de klant kan het
   bestand meteen doorsturen naar zijn installateur.                        */
function print(d, rapportHTML){
  const r = d.accu || reken(d);
  const w = window.open('', '_blank');
  if(!w){ alert('Sta pop-ups toe om het rapport op te slaan.'); return; }
  const datum = new Date().toLocaleDateString('nl-NL', {day:'numeric', month:'long', year:'numeric'});

  w.document.write(
    '<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>OpwekWijzer-rapport'+(d.adres?' — '+d.adres:'')+'</title>'
  + '<style>'
  + '@page{margin:16mm}'
  + 'body{font:13px/1.55 -apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#1a1a1a;'
  +   'max-width:720px;margin:0 auto;padding:18px}'
  + 'h1{font-size:22px;margin:0 0 3px}'
  + 'h2{font-size:16px;margin:22px 0 8px;border-bottom:2px solid #f0a500;padding-bottom:4px}'
  + 'h3{font-size:14px;margin:16px 0 6px}'
  + '.kop{border-bottom:3px solid #14301f;padding-bottom:10px;margin-bottom:16px}'
  + '.kop .sub{color:#666;font-size:12px}'
  + 'table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-variant-numeric:tabular-nums}'
  + 'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e6e3dc;font-size:12.5px}'
  + 'th{background:#f4f2ec;font-size:11.5px}'
  + 'tr.top td{background:#fdf6e4;font-weight:600}'
  + '.adviesblok{background:#f6f8f4;border-left:3px solid #1d4a2f;padding:10px 12px;margin:10px 0;'
  +   'page-break-inside:avoid;font-size:12.5px}'
  + '.adviesblok b{display:block;margin-bottom:3px}'
  + '.tikkop,.tik,.klein button,#tkKosten,#knopPdf,button{display:none !important}'
  + '.klein{color:#777;font-size:11px}'
  + '.bron{margin-top:24px;padding-top:10px;border-top:1px solid #ddd;color:#777;font-size:11px}'
  + '</style></head><body>'
  + '<div class="kop"><h1>Uw energierapport</h1>'
  + '<div class="sub">'+(d.adres||'')+' · opgesteld op '+datum+' · OpwekWijzer.nl</div></div>'
  + rapportHTML
  + '<div class="bron"><b>Bronnen en aannames.</b> Dakvlakken uit de 3D-gebouwenkaart van het Kadaster '
  + '(3D BAG). Opbrengst per dakvlak berekend met PVGIS van het Joint Research Centre van de Europese '
  + 'Commissie. Gerekend met de situatie ná het einde van salderen (1 januari 2027), een leveringsprijs '
  + 'van € '+nl(r.opties.prijs,2)+' per kWh en € '+nl(r.opties.kosten,2)+' terugleverkosten per kWh. '
  + 'Dit is een onderbouwde indicatie, geen offerte: uw installateur maakt de definitieve berekening na '
  + 'een controle ter plaatse.</div>'
  + '</body></html>');
  w.document.close();
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 400);
}

return {reken, blok, tabelHTML, adviesHTML, print, STD};
})();
