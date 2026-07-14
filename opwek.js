/* ==================================================================
   OpwekWijzer - opwek.js
   De consumentenmotor. Bewust ZELFSTANDIG: alleen roof.js wordt
   hergebruikt (het 3D-dak), verder niets.

   Bronnen in de berekening:
   - 3D BAG (Kadaster/TU Delft): het echte dak, per vlak helling + richting
   - PVGIS (EU JRC): opbrengst per dakvlak, via onze eigen proxy
   - Salderen stopt 1-1-2027 (Rijksoverheid): we rekenen de situatie erna

   De leaddatabase is NIET vanuit de browser bereikbaar. Alles loopt via
   /api/lead.js, waar de sleutel geheim blijft en de toestemming serverzijdig
   wordt afgedwongen.
================================================================== */
(function(){
"use strict";

const PRIJS=0.28;                 // euro/kWh levering
const TERUG={vast:0.0025, dyn:0.052};
const PANEEL_WP=450, PW=1.13, PH=1.72;
const INV_VOET=1600, INV_PANEEL=270;      // indicatieve marktprijs
const CYCLI=280, DEG=0.0045, JAREN=25;

// zelfverbruik zonder accu: aandeel van de opwek dat direct zelf gebruikt wordt
const BASIS_ZELF={weg:0.34, thuis:0.45};

const SYSTEEM={
  enphase:{
    naam:'Enphase IQ Battery 5P', stap:5, max:20,
    kwModule:3.84, kwPiek:7.68, additief:true,
    fase:'1-fase en 3-fase (FlexPhase, zelfde hardware)',
    retour:0.89, koppel:'AC - werkt met elke omvormer',
    gar:15, cycli:6000,
    nood:'IQ System Controller (ca. 1.500-2.000 euro, kan later)',
    prijs:k=>1500+800*k
  },
  sigen:{
    naam:'Sigenergy SigenStor', stap:5, max:48,
    omv1:[3,4,5,6], omv3:[5,8,10,12,15,20,25], additief:false,
    fase:'1-fase (3-6 kW) of 3-fase (5-25 kW), aparte varianten',
    retour:0.97, koppel:'DC - hybride omvormer in de accutoren',
    gar:10, cycli:3048,
    nood:'Energy Gateway HomeMax (ca. 1.800-2.800 euro)',
    prijs:k=>5500+390*Math.max(0,k-5)
  }
};

const $=id=>document.getElementById(id);
const nl=(v,d)=>(Number(v)||0).toLocaleString('nl-NL',{minimumFractionDigits:d||0, maximumFractionDigits:d||0});
const euro=v=>'\u20ac '+nl(v,0);
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
  setTimeout(()=>f.classList.remove('on'), 6000);
}

const D={route:null, dossier:{}};

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

/* ==================================================================
   ROUTE A - zonnepanelen (en 'beide'): adres -> echt dak -> opbrengst
================================================================== */
$('knopDak').addEventListener('click', async ()=>{
  const pc=($('pc').value||'').replace(/\s+/g,'').toUpperCase();
  const nr=($('nr').value||'').trim();
  if(!/^\d{4}[A-Z]{2}$/.test(pc) || !nr){
    fout('foutAdres','Vul een geldige postcode (1234 AB) en huisnummer in.'); return;
  }
  $('wachtDak').classList.add('on');
  try{
    // 1. adres -> coordinaat + adres-id (PDOK Locatieserver)
    const q=encodeURIComponent(pc+' '+nr);
    const r=await fetch('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q='+q
      +'&fq=type:adres&rows=1&fl=id,weergavenaam,centroide_ll');
    const j=await r.json();
    const doc=j.response && j.response.docs && j.response.docs[0];
    if(!doc) throw new Error('adres niet gevonden');
    const m=/POINT\(([\d.]+) ([\d.]+)\)/.exec(doc.centroide_ll);
    const lon=parseFloat(m[1]), lat=parseFloat(m[2]);
    D.dossier.adres=doc.weergavenaam; D.dossier.postcode=pc; D.dossier.huisnummer=nr;
    D.dossier.lat=lat; D.dossier.lon=lon;

    // 2. welk pand staat daar?
    const r2=await fetch('https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id='
      +encodeURIComponent(doc.id)+'&fl=pandidentificatie');
    const j2=await r2.json();
    const d2=j2.response && j2.response.docs && j2.response.docs[0];
    let pand=d2 && d2.pandidentificatie;
    if(Array.isArray(pand)) pand=pand[0];
    if(!pand) throw new Error('pand niet gevonden');
    D.dossier.pand_id=String(pand);

    // 3. het echte dak uit 3D BAG + panelen erin
    const model=await window.Roof.load(D.dossier.pand_id);
    if(!model) throw new Error(window.Roof.error()||'3D-dak niet beschikbaar');
    const out=window.Roof.layout(model, {pw:PW, ph:PH, margin:0.30, zonOnly:true, off:{h:0,s:0}, dead:{}, live:{}});
    const actief=out.panels.filter(p=>!p.off);
    if(!actief.length) throw new Error('geen geschikt dakvlak gevonden');

    // 4. opbrengst per dakvlak via PVGIS (1 kWp, daarna schalen)
    const per={};
    out.faces.forEach(f=>{
      if(!f.count) return;
      per[f.index]={tilt:Math.round(f.tilt||30), azi:(f.azi!=null?Math.round(f.azi):180), aantal:f.count};
    });
    let opwek=0;
    for(const k of Object.keys(per)){
      const v=per[k];
      const aspect=Math.round(((v.azi-180)%360+540)%360-180);   // BAG-azimut -> PVGIS
      let ey=900;                                                // vangnet
      try{
        const pr=await fetch('/api/pvgis.js?lat='+D.dossier.lat+'&lon='+D.dossier.lon
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
    D.dossier.panels=actief.map(p=>p.ll);      // hoekpunten voor het dakplan

    reken();
    teaser();
  }catch(e){
    fout('foutAdres','Dat lukte niet: '+e.message+'. Controleer het adres, of probeer het zo nog eens.');
  }finally{
    $('wachtDak').classList.remove('on');
  }
});

/* ==================================================================
   ROUTE B - alleen thuisbatterij: vier tikken, geen dak nodig
================================================================== */
$('knopAccu').addEventListener('click', ()=>{
  D.dossier.opwek=parseInt(pakOpwek(),10);
  D.dossier.aantal=Math.round(D.dossier.opwek/(PANEEL_WP*0.9));
  D.dossier.kwp=Math.round(D.dossier.opwek/900*10)/10;
  D.dossier.verbruik=parseInt(pakVerbruik2(),10);
  D.dossier.profiel='weg';
  D.dossier.contract=pakContract();
  D.dossier.fase=pakFase();
  reken();
  teaser();
});

/* ==================================================================
   DE REKENSOM - bewust eenvoudig en uitlegbaar (indicatie, geen offerte)
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
  return Math.max(D.dossier.kwp*1.25, (D.dossier.verbruik/365)*0.60);
}
function specs(sys, wensKwh){
  const C=SYSTEEM[sys];
  const modules=Math.max(1, Math.min(Math.round(wensKwh/C.stap), C.max/C.stap));
  const cap=modules*C.stap;
  let kw, omv=null;
  if(C.additief){ kw=modules*C.kwModule; }
  else{
    // kleinste Energy Controller die de accu in ~2 uur vol krijgt en bij de panelen past
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
  const batMax=Math.min(sp.cap*CYCLI*sp.C.retour, D.dossier.opwek-zelf0, Math.max(0,D.dossier.verbruik-zelf0));
  const batKwh=Math.round(Math.max(0,batMax));
  const gB=geld(zelf0,batKwh);
  const invP=INV_VOET + D.dossier.aantal*INV_PANEEL;
  D.dossier.zelf0=zelf0;
  D.dossier.besparing0=g0;
  D.dossier.besparingB=gB;
  D.dossier.accuExtra=gB-g0;
  D.dossier.accuWens=wens;
  D.dossier.enphase=sp;
  D.dossier.sigen=specs('sigen', wens);
  D.dossier.invPanelen=invP;
  D.dossier.tvtPanelen=tvt(g0, invP);
  D.dossier.tvtAccu = D.dossier.accuExtra>0 ? Math.round(sp.prijs/D.dossier.accuExtra*10)/10 : null;
}

/* ==================================================================
   TEASER - drie grote cijfers gratis, de rest achter het formulier
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
  let svg='<svg viewBox="0 0 '+((x1-x0)*s).toFixed(0)+' '+((y1-y0)*s).toFixed(0)+'" width="100%" style="display:block">';
  pts.forEach(h=>{
    svg+='<path d="M'+h.map(P).join(' L')+' Z" fill="#1d2b3a" stroke="#f0a500" stroke-width="0.8"/>';
  });
  return svg+'</svg>';
}

function teaser(){
  const accuRoute=(D.route==='accu');
  $('adresCheck').textContent = D.dossier.adres ? D.dossier.adres : '';
  const dp=$('dakplan');
  if(!accuRoute && D.dossier.panels){
    dp.style.display='block';
    dp.innerHTML=dakplanSVG()+'<div class="dp-sub">Uw dak, uit de officiele 3D-gebouwenkaart - '
      +D.dossier.aantal+' panelen op de zonzijde</div>';
  } else dp.style.display='none';

  const g=$('grote');
  if(accuRoute){
    const sp=D.dossier.enphase;
    g.innerHTML='<div><b>'+nl(sp.cap)+' kWh</b><span>advies-accu ('+sp.modules+' modules)</span></div>'
      +'<div><b>+'+euro(D.dossier.accuExtra)+'</b><span>extra per jaar</span></div>'
      +'<div><b>'+(D.dossier.tvtAccu?nl(D.dossier.tvtAccu,1)+' jr':'-')+'</b><span>accu terugverdiend</span></div>';
    $('teaserNoot').textContent='Berekend voor uw opwek, verbruik en contract - situatie na 2027.';
    $('gateKop').textContent='Ontvang uw volledige accu-rapport - gratis';
    $('gateLijst').innerHTML='<li>De complete specificatiekaart: vermogen, laadtijd, fases, noodstroom</li>'
      +'<li>Enphase en Sigenergy eerlijk naast elkaar, met garantie in laadcycli</li>'
      +'<li>Vrijblijvend voorstel van een gecertificeerd installateur uit uw regio</li>';
  } else {
    g.innerHTML='<div><b>'+nl(D.dossier.aantal)+'</b><span>panelen passen</span></div>'
      +'<div><b>'+euro(D.dossier.besparing0)+'</b><span>besparing per jaar</span></div>'
      +'<div><b>'+(D.dossier.tvtPanelen?nl(D.dossier.tvtPanelen,1)+' jr':'-')+'</b><span>terugverdiend</span></div>';
    $('teaserNoot').textContent='Opbrengst per dakvlak via EU-PVGIS - situatie na het einde van salderen (2027).';
    $('gateKop').textContent='Ontvang uw volledige dakrapport - gratis';
    $('gateLijst').innerHTML='<li>Opbrengst en besparing per dakvlak, met en zonder thuisbatterij</li>'
      +'<li>Het accu-advies in echte specificaties (vermogen, laadtijd, garantie)</li>'
      +'<li>Vrijblijvend voorstel van een gecertificeerd installateur uit uw regio</li>';
  }
  toon('stapTeaser');
}

/* ==================================================================
   DE LEAD - alleen met expliciete toestemming, via ons eigen endpoint
================================================================== */
$('knopLead').addEventListener('click', async ()=>{
  const naam=($('ldNaam').value||'').trim();
  const mail=($('ldMail').value||'').trim();
  const tel=($('ldTel').value||'').trim();
  if(naam.length<3){ fout('foutLead','Vul uw naam in.'); return; }
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)){ fout('foutLead','Vul een geldig e-mailadres in.'); return; }
  if(tel.replace(/\D/g,'').length<9){ fout('foutLead','Vul een geldig telefoonnummer in.'); return; }
  if(!$('ldOk').checked){ fout('foutLead','Zet het vinkje: zonder uw toestemming mogen wij niets delen.'); return; }

  const knop=$('knopLead');
  knop.disabled=true; knop.textContent='Versturen...';
  const d=D.dossier, sp=d.enphase||{};
  const kaal=Object.assign({},d); delete kaal.panels;
  const lead={
    route:D.route, naam, email:mail, telefoon:tel,
    postcode:d.postcode||null, huisnummer:d.huisnummer||null, adres:d.adres||null,
    pand_id:d.pand_id||null,
    verbruik:d.verbruik, contract:d.contract, fase:d.fase,
    aantal_panelen:d.aantal||null, kwp:d.kwp||null, opwek:d.opwek||null,
    besparing:(D.route==='accu'?d.accuExtra:d.besparing0)||null,
    tvt:(D.route==='accu'?d.tvtAccu:d.tvtPanelen)||null,
    accu_kwh:sp.cap||null, accu_modules:sp.modules||null, accu_kw:sp.kw||null,
    accu_merk:sp.C?sp.C.naam:null,
    dossier:kaal,
    bron:new URLSearchParams(location.search).get('utm_campaign')
        || new URLSearchParams(location.search).get('utm_source') || 'direct',
    consent:true,
    consent_tekst:$('avgTekst').textContent.trim(),
    website:($('website')&&$('website').value)||''    // honeypot: mensen laten dit leeg
  };
  try{
    const r=await fetch('/api/lead.js',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(lead)
    });
    if(!r.ok) throw new Error('opslaan mislukte ('+r.status+')');
    rapport();
  }catch(e){
    fout('foutLead','Er ging iets mis bij het versturen. Probeer het nog eens.');
    knop.disabled=false; knop.textContent='Toon mijn rapport';
  }
});

/* ==================================================================
   HET VOLLEDIGE RAPPORT - de beloning na het formulier
================================================================== */
function specTabel(sp, dyn){
  const C=sp.C;
  return '<table class="rtab">'
    +'<tr><th colspan="2">'+C.naam+'</th></tr>'
    +'<tr class="top"><td>Capaciteit</td><td>'+nl(sp.cap)+' kWh - '+sp.modules+' module'+(sp.modules>1?'s':'')+' van '+C.stap+' kWh</td></tr>'
    +'<tr><td>Continu vermogen</td><td>'+nl(sp.kw,2)+' kW'
      +(C.additief?' (telt op per module'+(C.kwPiek?', piek '+nl(sp.modules*C.kwPiek,1)+' kW':'')+')'
                  :' (Energy Controller '+sp.omv+' kW)')+'</td></tr>'
    +'<tr><td>Vol of leeg in</td><td>'+nl(sp.laadUren,1)+' uur'
      +(dyn?(sp.laadUren<=2.5?' - past in de goedkoopste uren':' - te traag voor de kortste prijsdips'):'')+'</td></tr>'
    +'<tr><td>Aansluiting</td><td>'+C.fase+'</td></tr>'
    +'<tr><td>Koppeling</td><td>'+C.koppel+' &middot; '+nl(C.retour*100)+'% rendement heen/terug</td></tr>'
    +'<tr><td>Noodstroom</td><td>optie: '+C.nood+'</td></tr>'
    +'<tr><td>Garantie</td><td>'+C.gar+' jaar of '+nl(C.cycli)+' laadcycli (ca. '+nl(C.cycli/CYCLI)+' jaar dagelijks)</td></tr>'
    +'<tr><td>Richtprijs geinstalleerd</td><td>'+euro(sp.prijs)+'</td></tr>'
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
      +'<tr><td>Adres</td><td>'+(d.adres||'-')+'</td></tr>'
      +'<tr><td>Panelen op de zonzijde</td><td>'+d.aantal+' x '+PANEEL_WP+' Wp = '+nl(d.kwp,2)+' kWp</td></tr>'
      +'<tr class="top"><td>Opbrengst per jaar</td><td>'+nl(d.opwek)+' kWh (PVGIS, per dakvlak)</td></tr>'
      +'</table>'
      +'<h3>Wat het oplevert (situatie na 2027)</h3>'
      +'<table class="rtab">'
      +'<tr><td>U gebruikt zelf direct</td><td>'+nl(d.zelf0)+' kWh ('+nl(d.zelf0/d.opwek*100)+'%)</td></tr>'
      +'<tr class="top"><td>Besparing per jaar</td><td>'+euro(d.besparing0)+'</td></tr>'
      +'<tr><td>Indicatieve investering</td><td>'+euro(d.invPanelen)+' (marktpeil, incl. 0% btw)</td></tr>'
      +'<tr><td>Terugverdiend in</td><td>'+(d.tvtPanelen?nl(d.tvtPanelen,1)+' jaar':'meer dan 25 jaar')+'</td></tr>'
      +'</table>';
  } else {
    h+='<h2>Uw accu-rapport</h2>'
      +'<table class="rtab">'
      +'<tr><td>Uw opwek</td><td>'+nl(d.opwek)+' kWh per jaar</td></tr>'
      +'<tr><td>Uw verbruik</td><td>'+nl(d.verbruik)+' kWh per jaar</td></tr>'
      +'<tr><td>Contract</td><td>'+(dyn?'dynamisch (uurprijzen)':'vast tarief')+'</td></tr>'
      +'</table>';
  }

  h+='<h3>De thuisbatterij: wat verandert er?</h3>'
    +'<table class="rtab">'
    +'<tr><th></th><th>Zonder accu</th><th>Met accu ('+nl(d.enphase.cap)+' kWh)</th></tr>'
    +'<tr><td>Besparing per jaar</td><td>'+euro(d.besparing0)+'</td><td><b>'+euro(d.besparingB)+'</b></td></tr>'
    +'<tr class="top"><td>De accu voegt toe</td><td colspan="2">'+euro(d.accuExtra)+' per jaar &middot; terugverdiend in '
    +(d.tvtAccu?nl(d.tvtAccu,1)+' jaar':'-')+'</td></tr>'
    +'</table>';

  h+='<h3>Welke accu past - de specificaties</h3>'
    + specTabel(d.enphase, dyn)
    + specTabel(d.sigen, dyn);

  // eerlijk advies - de reden dat mensen deze tool doorsturen
  const gr=Math.min(d.enphase.C.gar, d.enphase.C.cycli/CYCLI);
  if(d.tvtAccu && d.tvtAccu<=gr){
    h+='<div class="adviesblok"><b>Een accu is in uw situatie rendabel</b>'
      +'Hij verdient zichzelf terug binnen de garantieperiode. Let bij offertes vooral op de '
      +'gegarandeerde laadcycli - daar zit het echte verschil tussen merken.</div>';
  } else {
    h+='<div class="adviesblok"><b>Eerlijk advies: de accu kan nog net niet uit</b>'
      +'Bij uw verbruik en contract duurt terugverdienen langer dan de garantie dekt. '
      +(dyn?'':'Met een dynamisch contract wordt het beeld vaak flink beter - vraag de installateur dit door te rekenen. ')
      +'Overweeg te wachten tot de prijzen verder dalen, of laat uw installatie alvast accu-klaar maken.</div>';
  }
  if(dyn && d.enphase.C.additief){
    h+='<div class="adviesblok"><b>U heeft een dynamisch contract - let op het vermogen</b>'
      +'De goedkoopste uren duren kort. Bij Enphase telt het vermogen op per module ('
      +nl(d.enphase.C.kwModule,2)+' kW per stuk); bij Sigenergy bepaalt de gekozen omvormer de grens. '
      +'Uw advies-accu laadt in '+nl(d.enphase.laadUren,1)+' uur volledig - snel genoeg om elke prijsdip te pakken.</div>';
  }

  $('rapportBody').innerHTML=h;
  toon('stapRapport');
}

})();
