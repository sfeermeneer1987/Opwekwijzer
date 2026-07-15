/* ==================================================================
   OpwekWijzer — opwek.js  (v1.6.2)
   De consumentenmotor. Bewust ZELFSTANDIG: alleen roof.js (3D-dak),
   viewer.js (het beeld) en accu.js (het omslagpunt) worden bijgeladen.

   Bronnen in de berekening:
   - 3D BAG (Kadaster/TU Delft): het echte dak, per vlak helling+richting
   - PVGIS (EU JRC): opbrengst per dakvlak, via onze eigen proxy
   - Salderen stopt 1-1-2027 (Rijksoverheid): we rekenen de situatie erna

   v1.5.0: accu.js rekent de accu door met terugleverkosten + PDF-download.
   v1.6.0: enter-toets werkt overal, de accu-teaser toont wat teruglevering
   kóst (de haak), gate-teksten beloven niets dat de site niet doet, en
   foutmeldingen plakken geen punt meer achter een vraagteken.
   v1.6.1: teaser-viewer naar v1.1.0 — de panelen leggen zichzelf, met teller.
   v1.6.2: viewer naar v2.0.0 — schaduwen, PBR en de PDOK-luchtfoto op het echte dak.
================================================================== */
(function(){
"use strict";

/* ---------------- instellingen ---------------- */
const PRIJS=0.28;                 // €/kWh levering
const TERUG={vast:0.0025, dyn:0.052};
const PANEEL_WP=450, PW=1.13, PH=1.72;
const INV_VOET=1600, INV_PANEEL=270;      // indicatieve marktprijs (Milieu Centraal-peil)
const CYCLI=280, DEG=0.0045, JAREN=25;
const TERUGKOST=0.11;             // €/kWh terugleverkosten, marktpeil (teaser; rapport is instelbaar)

// zelfverbruik zonder accu: aandeel van de opwek dat direct zelf gebruikt wordt
const BASIS_ZELF={weg:0.34, thuis:0.45};

// de twee A-systemen, met de specs die ertoe doen
const SYSTEEM={
  enphase:{
    naam:'Enphase IQ Battery 5P', stap:5, max:20,
    kwModule:3.84, kwPiek:7.68, additief:true,
    fase:'1-fase én 3-fase (FlexPhase, zelfde hardware)',
    retour:0.89, koppel:'AC — werkt met elke omvormer',
    gar:15, cycli:6000,
    nood:'IQ System Controller (± €1.500–2.000, kan later)',
    prijs:k=>1500+800*k
  },
  sigen:{
    naam:'Sigenergy SigenStor', stap:5, max:48,
    omv1:[3,4,5,6], omv3:[5,8,10,12,15,20,25], additief:false,
    fase:'1-fase (3–6 kW) of 3-fase (5–25 kW), aparte varianten',
    retour:0.97, koppel:'DC — hybride omvormer in de accutoren',
    gar:10, cycli:3048,
    nood:'Energy Gateway HomeMax (± €1.800–2.800)',
    prijs:k=>5500+390*Math.max(0,k-5)
  }
};

/* ---------------- gereedschap ---------------- */
const $=id=>document.getElementById(id);
const nl=(v,d)=>(Number(v)||0).toLocaleString('nl-NL',{minimumFractionDigits:d||0, maximumFractionDigits:d||0});
const euro=v=>'€ '+nl(v,0);
function toon(id){
  document.querySelectorAll('.stap').forEach(s=>s.classList.remove('on'));
  $(id).classList.add('on');
  $('hero').style.display = (id==='stap0') ? '' : 'none';
  window.scrollTo({top:0, behavior:'smooth'});
}
function tikgroep(id){
  const g=$(id);
  g.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
    g.querySelectorAll('button').forEach(x=>x.classList.remove('aan'));
    b.classList.add('aan');
  }));
  return ()=> g.querySelector('.aan').dataset.v;
}
function fout(id, tekst){
  const f=$(id);
  f.textContent=tekst; f.classList.add('on');
  setTimeout(()=>f.classList.remove('on'), 8000);
}
// een los bestand bijladen, pas op het moment dat we het nodig hebben
function laadScript(src, vlag){
  if(window[vlag]) return Promise.resolve();
  return new Promise(ok=>{
    const s=document.createElement('script');
    s.src=src; s.onload=ok; s.onerror=ok;
    document.head.appendChild(s);
  });
}
// enter = klikken. Zonder dit doet het “ga”-knopje op het mobiele toetsenbord niets.
function enter(velden, knop){
  velden.forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('keydown', e=>{
      if(e.key==='Enter'){ e.preventDefault(); $(knop).click(); }
    });
  });
}

/* ---------------- de staat van dit bezoek ---------------- */
const D={route:null, dossier:{}, leadId:null, naam:null, mail:null, model:null, panelen:null};

/* ---------------- stap 0: keuze ---------------- */
document.querySelectorAll('#stap0 .keuze button').forEach(b=>{
  b.addEventListener('click', ()=>{
    D.route=b.dataset.route;
    toon(D.route==='accu' ? 'stapAccu' : 'stapAdres');
  });
});
document.querySelectorAll('.terug').forEach(b=>{
  b.addEventListener('click', ()=>toon(b.dataset.naar||'stap0'));
});

const pakVerbruik = tikgroep('tkVerbruik');
const pakProfiel  = tikgroep('tkProfiel');
const pakOpwek    = tikgroep('tkOpwek');
const pakVerbruik2= tikgroep('tkVerbruik2');
const pakContract = tikgroep('tkContract');
const pakFase     = tikgroep('tkFase');

enter(['pc','nr'],'knopDak');
enter(['ldNaam','ldMail'],'knopLead');
enter(['ldTel'],'knopBel');

/* ==================================================================
   ROUTE A — zonnepanelen (en 'beide'): adres -> echt dak -> opbrengst
================================================================== */
async function haalJson(url, ms){
  const ctl=new AbortController();
  const t=setTimeout(()=>ctl.abort(), ms||9000);
  try{
    const r=await fetch(url,{signal:ctl.signal});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function toMerc(lat,lng){
  const x=lng*20037508.342789244/180;
  let y=Math.log(Math.tan((90+lat)*Math.PI/360))/(Math.PI/180);
  return {x, y:y*20037508.342789244/180};
}
function toLokaal(lat,lng,oLat,oLng){
  const R=6378137;
  return {x:(lng-oLng)*Math.PI/180*R*Math.cos(oLat*Math.PI/180),
          y:(lat-oLat)*Math.PI/180*R};
}
function inPoly(pt,poly){
  let in_=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    if(((yi>pt.y)!==(yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi)) in_=!in_;
  }
  return in_;
}
function pandNummer(f){
  const p=f.properties||{};
  for(const k of [p.identificatie, p.pandidentificatie, p.pand_id, p.id, f.id]){
    if(k==null) continue;
    const m=String(k).match(/\d{16}/);
    if(m) return m[0];
  }
  return null;
}

// Het adrespunt ligt per definitie IN het pand. We vragen de BAG-panden rond dat
// punt op en pakken het pand waar het punt binnenvalt.
async function vindPand(lat,lng){
  const m=toMerc(lat,lng), d=6;
  const url='https://service.pdok.nl/lv/bag/wfs/v2_0?service=WFS&version=2.0.0&request=GetFeature'
    +'&typeName=bag:pand&outputFormat=application/json&srsName=EPSG:4326&count=20'
    +'&bbox='+(m.x-d)+','+(m.y-d)+','+(m.x+d)+','+(m.y+d)+',EPSG:3857';
  const gj=await haalJson(url, 12000);
  let id=null, eerste=null;
  (gj.features||[]).forEach(f=>{
    const g=f.geometry; if(!g||id) return;
    const nr=pandNummer(f);
    if(nr && !eerste) eerste=nr;
    const polys = g.type==='Polygon' ? [g.coordinates] : (g.type==='MultiPolygon' ? g.coordinates : []);
    polys.forEach(rings=>{
      if(!rings||!rings[0]||id) return;
      const ring=rings[0].map(c=> (c[0]>40 ? {lat:c[0],lng:c[1]} : {lat:c[1],lng:c[0]}) );
      const lok=ring.map(p=>toLokaal(p.lat,p.lng,lat,lng));
      if(inPoly({x:0,y:0}, lok)) id=nr;
    });
  });
  return id || eerste;   // valt het punt net buiten (aanbouw): pak het pand ernaast
}

$('knopDak').addEventListener('click', async ()=>{
  const pcRuw=($('pc').value||'').replace(/\s+/g,'').toUpperCase();
  const nr=($('nr').value||'').trim();
  if(!/^\d{4}[A-Z]{2}$/.test(pcRuw) || !nr){
    fout('foutAdres','Vul een geldige postcode (1234 AB) en huisnummer in.'); return;
  }
  const pc=pcRuw.slice(0,4)+' '+pcRuw.slice(4);      // PDOK matcht het beste met spatie
  $('wachtDak').classList.add('on');
  try{
    // 1. adres -> coördinaat (PDOK Locatieserver, officiîl)
    const url='https://api.pdok.nl/bzk/locatieserver/search/v3_1/free'
      +'?rows=5&fq=type:adres&fl=centroide_ll,weergavenaam,type&q='+encodeURIComponent(pc+' '+nr);
    const j=await haalJson(url, 9000);
    const docs=(j.response && j.response.docs) || [];
    const doc=docs.find(x=>x.type==='adres') || docs[0];
    const m=doc && doc.centroide_ll && doc.centroide_ll.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
    if(!m) throw new Error('dit adres staat niet in de BAG. Kloppen de postcode en het huisnummer?');
    const lon=parseFloat(m[1]), lat=parseFloat(m[2]);
    D.dossier.adres=doc.weergavenaam||(pc+' '+nr);
    D.dossier.postcode=pcRuw; D.dossier.huisnummer=nr;
    D.dossier.lat=lat; D.dossier.lon=lon;

    // 2. welk pand staat daar? (BAG-WFS op het adrespunt)
    const pand=await vindPand(lat, lon);
    if(!pand) throw new Error('geen gebouw gevonden op dit adres');
    D.dossier.pand_id=String(pand);

    // 3. het echte dak uit 3D BAG + panelen erin
    const model=await window.Roof.load(D.dossier.pand_id);
    if(!model) throw new Error(window.Roof.error()||'voor dit pand is nog geen 3D-dak beschikbaar');
    const out=window.Roof.layout(model, {pw:PW, ph:PH, margin:0.30, zonOnly:true, off:{h:0,s:0}, dead:{}, live:{}});
    const actief=out.panels.filter(p=>!p.off);
    if(!actief.length) throw new Error('op dit dak past geen paneel op de zonzijde');

    // het 3D-model en de panelen bewaren we: daar tekent viewer.js het huis mee
    D.model=model;
    D.panelen=out.panels;

    // 4. opbrengst per dakvlak via PVGIS (1 kWp per vlak, daarna schalen)
    const per={};
    out.faces.forEach(f=>{
      if(!f.count) return;
      per[f.index]={tilt:Math.round(f.tilt||30), azi:(f.azi!=null?Math.round(f.azi):180), aantal:f.count};
    });
    let opwek=0;
    for(const k of Object.keys(per)){
      const v=per[k];
      const aspect=Math.round(((v.azi-180)%360+540)%360-180);   // BAG-azimut -> PVGIS
      let ey=900;                                               // vangnet
      try{
        const pr=await fetch('/api/pvgis.js?lat='+lat+'&lon='+lon
          +'&peakpower=1&loss=14&angle='+v.tilt+'&aspect='+aspect
          +'&mountingplace=building&pvtechchoice=crystSi&outputformat=json');
        const pj=await pr.json();
        if(pj.outputs && pj.outputs.totals && pj.outputs.totals.fixed) ey=pj.outputs.totals.fixed.E_y;
      }catch(e){}
      v.kwh = ey * (v.aantal*PANEEL_WP/1000);
      opwek += v.kwh;
    }
    D.dossier.aantal=actief.length;
    D.dossier.kwp=actief.length*PANEEL_WP/1000;
    D.dossier.opwek=Math.round(opwek);
    D.dossier.vlakken=per;
    D.dossier.verbruik=parseInt(pakVerbruik(),10);
    D.dossier.profiel=pakProfiel();
    D.dossier.contract='vast';
    D.dossier.fase='1';
    D.dossier.panels=actief.map(p=>p.ll);      // hoekpunten voor het legplan

    reken();
    teaser();
  }catch(e){
    const m=String(e.message||e);
    fout('foutAdres','Dat lukte niet: '+m+(/[.!?…]$/.test(m)?'':'.'));
  }finally{
    $('wachtDak').classList.remove('on');
  }
});

/* ==================================================================
   ROUTE B — alleen thuisbatterij: vier tikken, geen dak nodig
================================================================== */
$('knopAccu').addEventListener('click', ()=>{
  D.dossier.opwek=parseInt(pakOpwek(),10);
  D.dossier.aantal=Math.round(D.dossier.opwek/ (PANEEL_WP*0.9));   // indicatie
  D.dossier.kwp=Math.round(D.dossier.opwek/900*10)/10;
  D.dossier.verbruik=parseInt(pakVerbruik2(),10);
  D.dossier.profiel='weg';
  D.dossier.contract=pakContract();
  D.dossier.fase=pakFase();
  reken();
  teaser();
});

/* ==================================================================
   DE REKENSOM — panelen. De accu wordt door accu.js gedaan, want die
   heeft terugleverkosten nodig en dat is een heel ander verhaal.
================================================================== */
function zelfDeel(){
  const basis=BASIS_ZELF[D.dossier.profiel]||0.34;
  const dekking=Math.min(1, D.dossier.verbruik/Math.max(1,D.dossier.opwek));
  return Math.max(0.15, Math.min(0.80, basis*Math.sqrt(dekking)));
}
function geld(zelfKwh, batKwh){
  const t=TERUG[D.dossier.contract]||TERUG.vast;
  const eigen=zelfKwh+batKwh;
  const terug=Math.max(0, D.dossier.opwek-eigen);
  return Math.round(eigen*PRIJS + terug*t);
}
function tvt(besparing, investering){
  let cum=0;
  for(let j=1;j<=JAREN;j++){
    const jr=besparing*Math.pow(1-DEG,j-1);
    if(cum+jr>=investering) return Math.round((j-1+(investering-cum)/jr)*10)/10;
    cum+=jr;
  }
  return null;
}
function adviesAccu(){
  const uitPanelen=D.dossier.kwp*1.25;
  const uitVerbruik=(D.dossier.verbruik/365)*0.60;
  return Math.max(uitPanelen, uitVerbruik);
}
function specs(sys, wensKwh){
  const C=SYSTEEM[sys];
  const modules=Math.max(1, Math.min(Math.round(wensKwh/C.stap), C.max/C.stap));
  const cap=modules*C.stap;
  let kw, omv=null;
  if(C.additief){ kw=modules*C.kwModule; }
  else{
    const wens=Math.max(cap/2, (D.dossier.kwp||3)/1.25);
    const reeks=D.dossier.fase==='3'?C.omv3:C.omv1;
    omv=reeks.find(k=>k>=wens)||reeks[reeks.length-1];
    kw=omv;
  }
  return {C, modules, cap, kw, omv, laadUren:Math.round(cap/kw*10)/10, prijs:Math.round(C.prijs(cap))};
}
function reken(){
  const zelf0=Math.round(D.dossier.opwek*zelfDeel());
  const g0=geld(zelf0,0);

  const wens=adviesAccu();
  const sp=specs('enphase', wens);
  const invP=INV_VOET + D.dossier.aantal*INV_PANEEL;

  D.dossier.zelf0=zelf0;               // accu.js rekent hierop verder
  D.dossier.besparing0=g0;
  D.dossier.accuWens=wens;
  D.dossier.enphase=sp;
  D.dossier.sigen=specs('sigen', wens);
  D.dossier.invPanelen=invP;
  D.dossier.tvtPanelen=tvt(g0, invP);
}

/* ==================================================================
   HET 3D-BEELD — viewer.js laadt zichzelf pas als er iets te tonen is
================================================================== */
function toon3D(){
  if(!D.model || !D.panelen) return;
  laadScript('/viewer.js?v=2.0.0','Viewer3D').then(()=>{
    if(window.Viewer3D) window.Viewer3D.toon(D.model, D.panelen);
  });
}

/* ==================================================================
   TEASER — het huis in 3D + drie grote cijfers, de rest achter de gate
================================================================== */
function dakplanSVG(){
  const pan=D.dossier.panels;
  if(!pan || !pan.length) return '';
  let x0=1/0,x1=-1/0,y0=1/0,y1=-1/0;
  const pts=pan.map(hoeken=>hoeken.map(q=>{
    const rd=window.Roof.toRd(q.lat,q.lng);
    x0=Math.min(x0,rd.x); x1=Math.max(x1,rd.x);
    y0=Math.min(y0,rd.y); y1=Math.max(y1,rd.y);
    return rd;
  }));
  x0-=1; x1+=1; y0-=1; y1+=1;
  const s=Math.min(560/(x1-x0), 300/(y1-y0));
  const P=rd=>((rd.x-x0)*s).toFixed(1)+' '+((y1-rd.y)*s).toFixed(1);
  let svg='<svg viewBox="0 0 '+((x1-x0)*s).toFixed(0)+' '+((y1-y0)*s).toFixed(0)
    +'" width="100%" style="display:block">';
  pts.forEach(h=>{
    svg+='<path d="M'+h.map(P).join(' L')+' Z" fill="#1d2b3a" stroke="#f0a500" stroke-width="0.8"/>';
  });
  return svg+'</svg>';
}

function teaser(){
  const accuRoute=(D.route==='accu');
  $('adresCheck').textContent = D.dossier.adres ? '📍 '+D.dossier.adres : '';
  const dp=$('dakplan');
  if(!accuRoute && D.dossier.panels){
    dp.style.display='block';
    dp.innerHTML=dakplanSVG()+'<div class="dp-sub">Het legplan — '
      +D.dossier.aantal+' panelen op de zonzijde</div>';
    toon3D();
  } else {
    dp.style.display='none';
    const v=document.getElementById('vw3d');
    if(v) v.style.display='none';
  }

  const g=$('grote');
  if(accuRoute){
    const sp=D.dossier.enphase;
    // De haak: niet terugkaatsen wat de bezoeker net intikte, maar tonen wat
    // teruglevering straks kóst — het bedrag dat een accu wegneemt.
    const overschot=Math.max(0, D.dossier.opwek-D.dossier.zelf0);
    const kost=Math.round(overschot*TERUGKOST);
    g.innerHTML='<div><b>'+nl(sp.cap)+' kWh</b><span>advies-accu ('+sp.modules+' modules)</span></div>'
      +'<div><b>'+nl(overschot)+'</b><span>kWh overschot per jaar</span></div>'
      +'<div><b>− '+euro(kost)+'</b><span>terugleverkosten per jaar, zonder accu</span></div>';
    $('teaserNoot').innerHTML='In uw rapport: drie accumaten naast elkaar — en hoe u dit bedrag wegneemt.<br>'
      +'Gerekend met € 0,11/kWh terugleverkosten (marktpeil) — in het rapport instelbaar.';
    $('gateKop').textContent='Bekijk uw volledige accu-rapport — gratis';
    $('gateLijst').innerHTML='<li>5, 10 en 15 kWh naast elkaar: opbrengst, prijs, terugverdientijd</li>'
      +'<li>Enphase en Sigenergy eerlijk vergeleken, met garantie in laadcycli</li>'
      +'<li>Ons eerlijke advies — ook als dat is: wacht nog even</li>';
  } else {
    const perMaand=Math.round(D.dossier.besparing0/12);
    const over25=Math.round(D.dossier.besparing0*21.5);   // 25 jaar, na degradatie
    D.dossier.perMaand=perMaand; D.dossier.over25=over25;
    g.innerHTML='<div><b>'+nl(D.dossier.aantal)+'</b><span>panelen passen</span></div>'
      +'<div><b>'+euro(perMaand)+'</b><span>lager per maand</span></div>'
      +'<div><b>'+(D.dossier.tvtPanelen?nl(D.dossier.tvtPanelen,1)+' jr':'—')+'</b><span>terugverdiend</span></div>';
    $('teaserNoot').innerHTML='Over 25 jaar levert dit dak u naar schatting <b>'+euro(over25)+'</b> op.<br>'
      +'Opbrengst per dakvlak via EU-PVGIS · gerekend ná het einde van salderen (2027).';
    $('gateKop').textContent='Bekijk uw volledige dakrapport — gratis';
    $('gateLijst').innerHTML='<li>Opbrengst en besparing per dakvlak, met en zonder thuisbatterij</li>'
      +'<li>Drie accumaten doorgerekend én de terugleverkosten vanaf 2027</li>'
      +'<li>Uw legplan en de complete berekening, als PDF om te bewaren</li>';
  }
  toon('stapTeaser');
}

/* ==================================================================
   DE LEAD — in twee micro-stappen.
   A) naam + e-mail  -> lage drempel; de lead wordt HIER AL opgeslagen.
   B) telefoon + belvoorkeur -> pas dan is hij verkoopbaar.
================================================================== */
function leadBasis(){
  const d=D.dossier, sp=d.enphase||{};
  const kaal=Object.assign({},d); delete kaal.panels; delete kaal.accu;
  const acc=d.accu && d.accu.beste;
  return {
    route:D.route,
    postcode:d.postcode||null, huisnummer:d.huisnummer||null, adres:d.adres||null,
    pand_id:d.pand_id||null,
    verbruik:d.verbruik, contract:d.contract, fase:d.fase,
    aantal_panelen:d.aantal||null, kwp:d.kwp||null, opwek:d.opwek||null,
    besparing:d.besparing0||null,
    tvt:d.tvtPanelen||null,
    accu_kwh:acc?acc.cap:(sp.cap||null),
    accu_modules:sp.modules||null, accu_kw:sp.kw||null,
    accu_merk:sp.C?sp.C.naam:null,
    dossier:kaal,
    bron:new URLSearchParams(location.search).get('utm_campaign')
        || new URLSearchParams(location.search).get('utm_source') || 'direct',
    website:($('website')&&$('website').value)||''    // honeypot
  };
}

$('knopLead').addEventListener('click', async ()=>{
  const naam=($('ldNaam').value||'').trim();
  const mail=($('ldMail').value||'').trim();
  if(naam.length<3){ fout('foutLead','Vul uw naam in.'); return; }
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)){ fout('foutLead','Vul een geldig e-mailadres in.'); return; }
  if(!$('ldOk').checked){ fout('foutLead','Zet het vinkje: zonder uw toestemming mogen wij niets doen.'); return; }

  const knop=$('knopLead');
  knop.disabled=true; knop.textContent='Een moment…';
  const lead=Object.assign(leadBasis(), {
    naam, email:mail, telefoon:null, stap:'A',
    consent:true, consent_tekst:$('avgTekst').textContent.trim()
  });
  try{
    const r=await fetch('/api/lead.js',{method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(lead)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error('opslaan mislukte ('+r.status+')');
    D.leadId=j.id||null;
    D.naam=naam; D.mail=mail;
    rapport();
  }catch(e){
    fout('foutLead','Er ging iets mis bij het versturen. Probeer het nog eens.');
    knop.disabled=false; knop.textContent='Toon mijn volledige rapport';
  }
});

function belStap(){
  const knop=$('knopBel'), groep=$('tkBel');
  if(!knop || knop.dataset.klaar) return;
  knop.dataset.klaar='1';

  if(groep){
    groep.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
      groep.querySelectorAll('button').forEach(x=>x.classList.remove('aan'));
      b.classList.add('aan');
    }));
  }

  knop.addEventListener('click', async ()=>{
    const tel=($('ldTel').value||'').trim();
    if(tel.replace(/\D/g,'').length<9){ fout('foutBel','Vul een geldig telefoonnummer in.'); return; }
    knop.disabled=true; knop.textContent='Versturen…';
    const keuze=groep ? groep.querySelector('.aan') : null;
    const wanneer=keuze ? (keuze.dataset.t||'binnen 1 werkdag') : 'binnen 1 werkdag';
    try{
      const r=await fetch('/api/lead.js',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign(leadBasis(), {
          lead_id:D.leadId, naam:D.naam, email:D.mail,
          telefoon:tel, belvoorkeur:(keuze&&keuze.dataset.v)||'geen voorkeur', stap:'B',
          consent:true, consent_tekst:$('avgTekst').textContent.trim()
        }))});
      if(!r.ok) throw new Error('mislukt');
      $('belBlok').innerHTML='<div class="succes"><b>Gelukt — uw voorstel is aangevraagd.</b> '
        +'Eén gecertificeerd installatiebedrijf uit uw regio belt u '+wanneer
        +'. Geen verkoper aan de deur, geen verplichtingen.</div>';
    }catch(e){
      fout('foutBel','Er ging iets mis. Probeer het nog eens.');
      knop.disabled=false; knop.textContent='Ja, laat één installateur mij bellen';
    }
  });
}

/* ==================================================================
   HET VOLLEDIGE RAPPORT — de beloning na het formulier
================================================================== */
function specTabel(sp, dyn){
  const C=sp.C;
  return '<table class="rtab">'
    +'<tr><th colspan="2">'+C.naam+'</th></tr>'
    +'<tr class="top"><td>Capaciteit</td><td>'+nl(sp.cap)+' kWh — '+sp.modules+' module'+(sp.modules>1?'s':'')+' van '+C.stap+' kWh</td></tr>'
    +'<tr><td>Continu vermogen</td><td>'+nl(sp.kw,2)+' kW'
      +(C.additief?' (telt op per module'+(C.kwPiek?', piek '+nl(sp.modules*C.kwPiek,1)+' kW':'')+')'
                  :' (Energy Controller '+sp.omv+' kW)')+'</td></tr>'
    +'<tr><td>Vol of leeg in</td><td>'+nl(sp.laadUren,1)+' uur'
      +(dyn?(sp.laadUren<=2.5?' — past in de goedkoopste uren ✓':' — te traag voor de kortste prijsdips ⚠️'):'')+'</td></tr>'
    +'<tr><td>Aansluiting</td><td>'+C.fase+'</td></tr>'
    +'<tr><td>Koppeling</td><td>'+C.koppel+' · '+nl(C.retour*100)+'% rendement heen/terug</td></tr>'
    +'<tr><td>Noodstroom</td><td>optie: '+C.nood+'</td></tr>'
    +'<tr><td>Garantie</td><td>'+C.gar+' jaar of '+nl(C.cycli)+' laadcycli (≈ '+nl(C.cycli/CYCLI)+' jaar dagelijks)</td></tr>'
    +'<tr><td>Richtprijs geïnstalleerd</td><td>'+euro(sp.prijs)+'</td></tr>'
    +'</table><br>';
}

function rapport(){
  const d=D.dossier;
  const dyn=d.contract!=='vast';
  let h='';

  if(D.route!=='accu'){
    h+='<h2>Uw dakrapport</h2>'
      +'<h3>Het dak</h3>'
      +'<table class="rtab">'
      +'<tr><td>Adres</td><td>'+(d.adres||'—')+'</td></tr>'
      +'<tr><td>Panelen op de zonzijde</td><td>'+d.aantal+' × '+PANEEL_WP+' Wp = '+nl(d.kwp,2)+' kWp</td></tr>'
      +'<tr class="top"><td>Opbrengst per jaar</td><td>'+nl(d.opwek)+' kWh (PVGIS, per dakvlak)</td></tr>'
      +'</table>'
      +'<h3>Wat de panelen opleveren (situatie ná 2027)</h3>'
      +'<table class="rtab">'
      +'<tr><td>U gebruikt zelf direct</td><td>'+nl(d.zelf0)+' kWh ('+nl(d.zelf0/Math.max(1,d.opwek)*100)+'%)</td></tr>'
      +'<tr class="top"><td>Besparing per jaar</td><td>'+euro(d.besparing0)+'</td></tr>'
      +'<tr><td>Indicatieve investering</td><td>'+euro(d.invPanelen)+' (marktpeil, incl. 0% btw)</td></tr>'
      +'<tr><td>Terugverdiend in</td><td>'+(d.tvtPanelen?nl(d.tvtPanelen,1)+' jaar':'> 25 jaar')+'</td></tr>'
      +'</table>';
  } else {
    h+='<h2>Uw accu-rapport</h2>'
      +'<table class="rtab">'
      +'<tr><td>Uw opwek</td><td>'+nl(d.opwek)+' kWh per jaar</td></tr>'
      +'<tr><td>Uw verbruik</td><td>'+nl(d.verbruik)+' kWh per jaar</td></tr>'
      +'<tr><td>U gebruikt zelf direct</td><td>'+nl(d.zelf0)+' kWh</td></tr>'
      +'<tr><td>Contract</td><td>'+(dyn?'dynamisch (uurprijzen)':'vast tarief')+'</td></tr>'
      +'</table>';
  }

  // Het hart van het rapport: accu.js rekent drie maten door, met terugleverkosten.
  h+='<div id="accuBlok"></div>';

  h+='<h3>De twee systemen — de specificaties</h3>'
    + specTabel(d.enphase, dyn)
    + specTabel(d.sigen, dyn);

  h+='<button class="knop" id="knopPdf">Download dit rapport (PDF)</button>';

  $('rapportBody').innerHTML=h;

  laadScript('/accu.js?v=1.0.0','Accu').then(()=>{
    if(window.Accu) window.Accu.blok(D.dossier, $('accuBlok'));
  });

  const pdf=$('knopPdf');
  if(pdf) pdf.addEventListener('click', ()=>{
    if(!window.Accu) return;
    window.Accu.print(D.dossier, $('rapportBody').innerHTML);
  });

  const bb=$('belBlok');
  if(bb) bb.style.display='block';
  belStap();
  toon('stapRapport');
}

})();
