/* ==================================================================
   Watt-Piek Dakplanner — roof.js  (rekenhart)
   - WGS84 <-> RD: kaart, BAG-omtrek en 3D-model in EEN stelsel
   - 3D BAG-model ophalen (/api/bag3d.js) en de dakvlakken eruit halen
   - Panelen inpassen IN het vlak van elk dakvlak -> nooit zwevend
   - Vangnet: platte indeling als er geen 3D-model is
   Geen Three.js, geen DOM: puur rekenwerk, apart te testen.
================================================================== */
window.Roof = (function(){
"use strict";

/* ---------- WGS84 <-> RD (Rijksdriehoek), nauwkeurig tot enkele cm ---------- */
const X0=155000, Y0=463000, PHI0=52.15517440, LAM0=5.38720621;
const RPQ=[[0,1,190094.945],[1,1,-11832.228],[2,1,-114.221],[0,3,-32.391],[1,0,-0.705],[3,1,-2.340],[1,3,-0.608],[0,2,-0.008],[2,3,0.148]];
const SPQ=[[1,0,309056.544],[0,2,3638.893],[2,0,73.077],[1,2,-157.984],[3,0,59.788],[0,1,0.433],[2,2,-6.439],[1,1,-0.032],[0,4,0.092],[1,4,-0.054]];
const KPQ=[[0,1,3235.65389],[2,0,-32.58297],[0,2,-0.24750],[2,1,-0.84978],[0,3,-0.06550],[2,2,-0.01709],[1,0,-0.00738],[4,0,0.00530],[2,3,-0.00039],[4,1,0.00033],[1,1,-0.00012]];
const LPQ=[[1,0,5260.52916],[1,1,105.94684],[1,2,2.45656],[3,0,-0.81885],[1,3,0.05594],[3,1,-0.05607],[0,1,0.01199],[3,2,-0.00256],[1,4,0.00128],[0,2,0.00022],[2,0,-0.00022],[5,0,0.00026]];

function toRd(lat,lng){
  const dp=0.36*(lat-PHI0), dl=0.36*(lng-LAM0);
  let x=X0, y=Y0;
  for(const t of RPQ) x+=t[2]*Math.pow(dp,t[0])*Math.pow(dl,t[1]);
  for(const t of SPQ) y+=t[2]*Math.pow(dp,t[0])*Math.pow(dl,t[1]);
  return {x,y};
}
function toLatLng(x,y){
  const dx=(x-X0)*1e-5, dy=(y-Y0)*1e-5;
  let lat=PHI0, lng=LAM0;
  for(const t of KPQ) lat+=t[2]*Math.pow(dx,t[0])*Math.pow(dy,t[1])/3600;
  for(const t of LPQ) lng+=t[2]*Math.pow(dx,t[0])*Math.pow(dy,t[1])/3600;
  return {lat,lng};
}

/* ---------- vectoren ([x,y,z] in RD-meters) ---------- */
const cr=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dt=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const nz=a=>{ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; };

/* ---------- 2D-polygonen ---------- */
function signedArea(p){
  let s=0;
  for(let i=0,j=p.length-1;i<p.length;j=i++) s+=p[j].x*p[i].y - p[i].x*p[j].y;
  return s/2;
}
function inPoly(pt,poly){
  let ins=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    if(((yi>pt.y)!==(yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi)) ins=!ins;
  }
  return ins;
}
function edgeDist(pt,poly){
  let m=Infinity;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[j], b=poly[i];
    const dx=b.x-a.x, dy=b.y-a.y, L2=dx*dx+dy*dy;
    let t=L2? ((pt.x-a.x)*dx+(pt.y-a.y)*dy)/L2 : 0;
    t=Math.max(0,Math.min(1,t));
    m=Math.min(m, Math.hypot(pt.x-(a.x+t*dx), pt.y-(a.y+t*dy)));
  }
  return m;
}
// past het geheel binnen de polygoon, met randafstand?
function fits(poly, pts, margin){
  return pts.every(p => inPoly(p,poly) && (margin<=0 || edgeDist(p,poly) >= margin-1e-9));
}

/* ---------- triangulatie (ear clipping, met waaier als vangnet) ---------- */
function inTri(p,a,b,c){
  const d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
  if(Math.abs(d)<1e-12) return false;
  const w1=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/d;
  const w2=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/d;
  const w3=1-w1-w2;
  return w1>1e-9 && w2>1e-9 && w3>1e-9;
}
function triangulate2(pts){
  const n=pts.length;
  if(n<3) return [];
  if(n===3) return [[0,1,2]];
  let idx=pts.map((_,i)=>i);
  if(signedArea(pts)<0) idx.reverse();      // altijd tegen de klok in
  const out=[];
  let guard=n*n+10;
  while(idx.length>3 && guard-- > 0){
    let cut=false;
    for(let i=0;i<idx.length;i++){
      const ia=idx[(i-1+idx.length)%idx.length], ib=idx[i], ic=idx[(i+1)%idx.length];
      const A=pts[ia], B=pts[ib], C=pts[ic];
      const z=(B.x-A.x)*(C.y-A.y)-(B.y-A.y)*(C.x-A.x);
      if(z<=1e-12) continue;                 // niet convex / gedegenereerd
      let ok=true;
      for(const k of idx){
        if(k===ia||k===ib||k===ic) continue;
        if(inTri(pts[k],A,B,C)){ ok=false; break; }
      }
      if(ok){ out.push([ia,ib,ic]); idx.splice(i,1); cut=true; break; }
    }
    if(!cut) break;                          // vastgelopen -> waaier hieronder
  }
  if(idx.length===3) out.push([idx[0],idx[1],idx[2]]);
  else if(idx.length>3) for(let i=1;i<idx.length-1;i++) out.push([idx[0],idx[i],idx[i+1]]);
  return out;
}

/* ---------- 3D BAG ophalen ---------- */
let lastError='';
const cache={};
async function fetchJson(url, ms){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(), ms||15000);
  try{
    const r=await fetch(url,{signal:c.signal, headers:{'Accept':'application/json'}});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function load(pandId){
  const id=String(pandId||'').replace(/^NL\.IMBAG\.Pand\./,'');
  if(!id){ lastError='geen pand-ID'; return null; }
  if(cache[id]) return cache[id]==='none' ? null : cache[id];
  const routes=[
    '/api/bag3d.js?id='+encodeURIComponent(id),
    '/api/bag3d?id='+encodeURIComponent(id),
    'https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.'+encodeURIComponent(id)
  ];
  let doc=null; const fout=[];
  for(const u of routes){
    try{
      const d=await fetchJson(u);
      if(d && d.error){ fout.push(d.error); continue; }
      doc=d; break;
    }catch(e){ fout.push((e&&e.message)||'netwerkfout'); }
  }
  if(!doc){ lastError='3D BAG niet bereikbaar ('+fout.join(' | ')+')'; cache[id]='none'; return null; }
  try{
    const m=parse(doc);
    cache[id]=m;
    return m;
  }catch(e){
    lastError='3D-model onbruikbaar ('+((e&&e.message)||'onbekend')+')';
    cache[id]='none';
    return null;
  }
}

/* ---------- CityJSON -> vlakken (in RD: x=oost, y=noord, z=hoogte NAP) ---------- */
function newell(pts){
  let x=0,y=0,z=0;
  for(let i=0;i<pts.length;i++){
    const p=pts[i], q=pts[(i+1)%pts.length];
    x+=(p[1]-q[1])*(p[2]+q[2]);
    y+=(p[2]-q[2])*(p[0]+q[0]);
    z+=(p[0]-q[0])*(p[1]+q[1]);
  }
  const n=nz([x,y,z]);
  return n[2]<0 ? [-n[0],-n[1],-n[2]] : n;   // normaal wijst omhoog
}
// orthonormale basis IN het dakvlak: h = horizontaal (langs de nok), s = hellingopwaarts
function basis(n){
  const h = (Math.hypot(n[0],n[1])<1e-6) ? [1,0,0] : nz([n[1],-n[0],0]);
  const s = nz(cr(h,n));
  return {h,s};
}
function planeD(fc){
  return fc.pts.reduce((a,p)=>a+dt(p,fc.n),0)/fc.pts.length;
}
function triFace(fc){
  const {h,s}=basis(fc.n);
  const flat=fc.pts.map(p=>({x:dt(p,h), y:dt(p,s)}));
  const ox=flat[0].x, oy=flat[0].y;                    // centreren = rekenprecisie
  const loc=flat.map(p=>({x:p.x-ox, y:p.y-oy}));
  return triangulate2(loc).map(t=>({a:fc.pts[t[0]], b:fc.pts[t[1]], c:fc.pts[t[2]]}));
}

function parse(doc){
  const tr=(doc.metadata && doc.metadata.transform) || doc.transform;
  if(!tr || !tr.scale || !tr.translate) throw new Error('geen transform');
  const f=doc.feature || doc;
  const V=(f.vertices||[]).map(v=>[
    v[0]*tr.scale[0]+tr.translate[0],
    v[1]*tr.scale[1]+tr.translate[1],
    v[2]*tr.scale[2]+tr.translate[2]
  ]);
  if(!V.length) throw new Error('geen punten');

  const faces=[];
  const objs=f.CityObjects||{};
  Object.keys(objs).forEach(k=>{
    (objs[k].geometry||[]).forEach(geo=>{
      if(String(geo.lod)!=='2.2') return;                       // LoD 2.2 = echte dakvlakken
      const shells=(geo.type==='Solid') ? geo.boundaries : [geo.boundaries];
      const sv=geo.semantics && geo.semantics.values;
      const ss=geo.semantics && geo.semantics.surfaces;
      shells.forEach((shell,si)=>{
        (shell||[]).forEach((surf,fi)=>{
          const ring=surf && surf[0];
          if(!ring || ring.length<3) return;
          let type='Wall', att=null;
          if(sv && ss){
            const v=(geo.type==='Solid') ? (sv[si]&&sv[si][fi]) : sv[fi];
            att=(v!=null) ? ss[v] : null;
            if(att && att.type){
              type = att.type.indexOf('Roof')>=0 ? 'Roof'
                   : (att.type.indexOf('Ground')>=0 ? 'Ground' : 'Wall');
            }
          }
          const pts=ring.map(i=>V[i]).filter(Boolean);
          if(pts.length<3) return;
          const n=newell(pts);
          // binnenringen = openingen in het dakvlak (dakkapel, lichtkoepel)
          const holes=[];
          for(let k=1;k<surf.length;k++){
            const hr=surf[k];
            if(!hr || hr.length<3) continue;
            const hp=hr.map(i=>V[i]).filter(Boolean);
            if(hp.length>=3) holes.push(hp);
          }
          faces.push({
            type, pts, holes, n,
            tilt: (att && att.b3_hellingshoek!=null) ? att.b3_hellingshoek
                 : Math.acos(Math.max(-1,Math.min(1,Math.abs(n[2]))))*180/Math.PI,
            azi:  (att && att.b3_azimut!=null) ? att.b3_azimut : null
          });
        });
      });
    });
  });
  if(!faces.length) throw new Error('geen LoD 2.2-vlakken');

  const tris=[];
  faces.forEach(fc=>{ triFace(fc).forEach(t=>{ t.type=fc.type; tris.push(t); }); });

  let minx=1/0,maxx=-1/0,miny=1/0,maxy=-1/0,minz=1/0,maxz=-1/0;
  faces.forEach(fc=>fc.pts.forEach(p=>{
    minx=Math.min(minx,p[0]); maxx=Math.max(maxx,p[0]);
    miny=Math.min(miny,p[1]); maxy=Math.max(maxy,p[1]);
    minz=Math.min(minz,p[2]); maxz=Math.max(maxz,p[2]);
  }));

  return {
    faces, tris,
    roofs: faces.filter(fc=>fc.type==='Roof'),
    minx,maxx,miny,maxy,minz,maxz,
    cx:(minx+maxx)/2, cy:(miny+maxy)/2,
    height: maxz-minz, spanX: maxx-minx, spanY: maxy-miny
  };
}

/* ---------- panelen IN de echte dakvlakken ---------- */
/* ---------- obstakels ----------
   Een schoorsteen of dakraam blokkeert twee dingen: de plek waar hij staat, én
   het uitzicht van de panelen erachter. Dit stuk regelt het eerste — de plek.
   De schaduw laten we aan zon.js over, want die is veel groter dan de voetafdruk.

   Randvoorwaarde uit de praktijk: rondom een obstakel houd je werkruimte vrij,
   anders kan de installateur er niet bij en klemt het paneel tegen het lood.  */
const OBSTAKEL = {
  schoorsteen: {naam:'Schoorsteen', w:0.60, d:0.60, hoogte:1.00, vrij:0.30, kleur:'#8a5a3c'},
  dakraam:     {naam:'Dakraam',     w:0.78, d:1.18, hoogte:0.10, vrij:0.20, kleur:'#5b8fb9'},
  ventilatie:  {naam:'Ontluchting', w:0.30, d:0.30, hoogte:0.50, vrij:0.20, kleur:'#7a7a72'},
  dakkapel:    {naam:'Dakkapel',    w:2.00, d:1.50, hoogte:1.60, vrij:0.30, kleur:'#6b6257'},
  boom:        {naam:'Boom',        w:3.00, d:3.00, hoogte:6.00, vrij:0.00, kleur:'#4a7a3c'}
};

// z op het vlak van dit dakvlak, voor een punt (x,y) van bovenaf gezien
function zOpVlak(fc, x, y){
  const n=fc.n, d=planeD(fc);
  if(Math.abs(n[2])<1e-6) return null;          // een muur: daar ligt niets op
  return (d - n[0]*x - n[1]*y) / n[2];
}
// ligt (x,y) binnen dit dakvlak, van bovenaf gezien?
function opVlak(fc, x, y){
  return inPoly({x, y}, fc.pts.map(p=>({x:p[0], y:p[1]})));
}

/* Maakt van een obstakel een uitsparing (een 'hole') in het dakvlak waar hij op
   staat. De vrije ruimte eromheen zit er al in verwerkt.                       */
function obstakelGat(fc, o){
  const T = OBSTAKEL[o.type] || OBSTAKEL.schoorsteen;
  if(o.type==='boom') return null;              // een boom staat naast het huis, niet erop
  if(!opVlak(fc, o.x, o.y)) return null;
  const w=(o.w!=null?o.w:T.w)/2 + T.vrij;
  const d=(o.d!=null?o.d:T.d)/2 + T.vrij;
  const a=((o.hoek||0)*Math.PI)/180;            // een dakkapel ligt langs de dakrand
  const co=Math.cos(a), si=Math.sin(a);
  const uit=[];
  for(const [dx,dy] of [[-w,-d],[w,-d],[w,d],[-w,d]]){
    const x=o.x + dx*co - dy*si;
    const y=o.y + dx*si + dy*co;
    const z=zOpVlak(fc, x, y);
    if(z==null) return null;
    uit.push([x,y,z]);
  }
  return uit;
}

// De vier hoekpunten van een obstakel in RD — voor de kaart en het legplan.
function obstakelHoeken(o){
  const T = OBSTAKEL[o.type] || OBSTAKEL.schoorsteen;
  const w=(o.w!=null?o.w:T.w)/2, d=(o.d!=null?o.d:T.d)/2;
  const a=((o.hoek||0)*Math.PI)/180, co=Math.cos(a), si=Math.sin(a);
  return [[-w,-d],[w,-d],[w,d],[-w,d]].map(([dx,dy])=>
    [o.x + dx*co - dy*si, o.y + dx*si + dy*co]);
}

// opt: {pw, ph, gap, margin, clip:[{x,y} in RD], off:{h,s}, dead:{key:true}, live:{key:true},
//       obstakels:[{type,x,y,w,d,hoogte}],
//       zonOnly, orient:'auto'|'vast', max}
//   dead = panelen die de gebruiker wegtikte   live = lege vakjes die hij er zelf bij zette
function layout(model, opt){
  opt=opt||{};
  const pw0=Math.max(0.2, opt.pw||1.13), ph0=Math.max(0.2, opt.ph||1.72);
  const gap=(opt.gap!=null) ? opt.gap : 0.02;
  const margin=Math.max(0, opt.margin||0);
  const clip=(opt.clip && opt.clip.length>2) ? opt.clip : null;
  const off=opt.off||{h:0,s:0};
  const dead=opt.dead||{};
  const live=opt.live||{};
  const maxN=opt.max||800;
  const orient=opt.orient||'auto';
  const panels=[];
  const faces=[];

  // Leg panelen van pw x ph op EEN dakvlak. fh/fs = verschuiving als deel (-1..1)
  // van de beschikbare speling. Geeft de plekken + een verslag terug.
  function probeer(fc, pw, ph, fh, fs){
    let {h,s}=basis(fc.n);
    // Een dakkapel staat zelden noord-zuid: zijn raster draait met hem mee.
    if(fc.basisHoek){
      const ba=fc.basisHoek*Math.PI/180, co=Math.cos(ba), si=Math.sin(ba);
      const h2=[h[0]*co-s[0]*si, h[1]*co-s[1]*si, h[2]*co-s[2]*si];
      const s2=[s[0]*co+h[0]*si, s[1]*co+h[1]*si, s[2]*co+h[2]*si];
      h=h2; s=s2;
    }
    const marge = (fc.marge!=null) ? fc.marge : margin;   // dakkapel: kleinere rand
    const d=planeD(fc);
    const flat=fc.pts.map(p=>({x:dt(p,h), y:dt(p,s)}));
    // uitsparingen: die uit 3D BAG (dakkapel, koepel) + die de gebruiker plaatste
    const alleGaten=(fc.holes||[]).slice();
    (opt.obstakels||[]).forEach(o=>{
      if(fc.vanObstakel===o) return;          // de dakkapel blokkeert zijn eigen dakje niet
      const g=obstakelGat(fc, o);
      if(g) alleGaten.push(g);
    });
    const gaten=alleGaten.map(hp=>hp.map(p=>({x:dt(p,h), y:dt(p,s)})));
    let a0=1/0,a1=-1/0,b0=1/0,b1=-1/0;
    flat.forEach(p=>{a0=Math.min(a0,p.x);a1=Math.max(a1,p.x);b0=Math.min(b0,p.y);b1=Math.max(b1,p.y);});
    const ox=flat[0].x, oy=flat[0].y;                    // centreren = rekenprecisie

    const r={ pw, ph, h, s, lijst:[],
      breedte:a1-a0, lengte:b1-b0,
      opp:Math.abs(signedArea(flat.map(p=>({x:p.x-ox, y:p.y-oy})))),
      nc:0, nr:0, goed:0, afRand:0, afGat:0, afOmtrek:0, schuifH:0, schuifS:0, speelH:0, speelS:0,
      obstakels:(opt.obstakels||[]).filter(o=>obstakelGat(fc,o)).length };

    const sa=pw+gap, sb=ph+gap;
    const W=(a1-marge)-(a0+marge), H=(b1-marge)-(b0+marge);   // bruikbaar gebied
    if(W<pw-1e-9 || H<ph-1e-9) return r;                          // er past geen paneel

    const nc=Math.floor((W+gap)/sa), nr=Math.floor((H+gap)/sb);
    r.nc=nc; r.nr=nr;

    // Speling = wat er na het raster overblijft. Verder schuiven dan de speling kost
    // gegarandeerd een rij of kolom. We schuiven daarom in DELEN van de speling (-1..1),
    // zodat het raster het bruikbare gebied nooit kan verlaten.
    const speelA=W-(nc*pw+(nc-1)*gap), speelB=H-(nr*ph+(nr-1)*gap);
    r.speelH=speelA/2; r.speelS=speelB/2;
    const oh=Math.max(-1,Math.min(1,fh||0)) * speelA/2;
    const os=Math.max(-1,Math.min(1,fs||0)) * speelB/2;
    r.schuifH=oh; r.schuifS=os;

    const startA=(a0+marge)+speelA/2+oh;
    const startB=(b0+marge)+speelB/2+os;

    for(let ri=0; ri<nr; ri++){
      for(let ci=0; ci<nc; ci++){
        const a=startA+ci*sa, b=startB+ri*sb;
        const q=[{x:a,y:b},{x:a+pw,y:b},{x:a+pw,y:b+ph},{x:a,y:b+ph}];
        const probe=q.concat([{x:a+pw/2, y:b+ph/2}]);

        // Ligt het middelpunt niet eens op dit dakvlak? Dan bestaat deze plek niet.
        // (Het raster spant de hele omhullende rechthoek, dus daar zitten hopen
        //  cellen bij die volledig naast het dak vallen.)
        const mid={x:a+pw/2, y:b+ph/2};
        if(!inPoly(mid, flat)) continue;

        const c3=q.map(p=>[
          h[0]*p.x + s[0]*p.y + fc.n[0]*d,
          h[1]*p.x + s[1]*p.y + fc.n[1]*d,
          h[2]*p.x + s[2]*p.y + fc.n[2]*d
        ]);

        // Vanaf hier keuren we af, maar GOOIEN WE NIET WEG. Een afgekeurde plek
        // blijft bestaan als leeg vakje: de installateur weet zelf het beste of
        // hij daar toch een paneel kwijt kan. 'weg' zegt waarom hij afviel.
        let weg=null;

        if(!fits(flat, probe, marge)){ r.afRand++; weg='rand'; }  // te dicht op de dakrand

        if(!weg && gaten.length){                                   // dakkapel / lichtkoepel
          let inGat=false;
          for(const G of gaten){
            if(inPoly(mid, G)){ inGat=true; break; }                // middelpunt IN het gat
            if(probe.some(p=>inPoly(p,G) || edgeDist(p,G)<marge-1e-9)){ weg='gat'; break; }
            if(G.some(p=>p.x>=a && p.x<=a+pw && p.y>=b && p.y<=b+ph)){ weg='gat'; break; }
          }
          if(inGat) continue;                                       // daar past niets, punt
          if(weg==='gat') r.afGat++;
        }

        // De getekende omtrek bepaalt alleen WELK gebouw(deel), niet de randafstand.
        // De echte dakrand zit al in het 3D BAG-dakvlak; marge daar bovenop zou
        // de randafstand stiekem verdubbelen en kost zomaar een hele kolom.
        if(!weg && clip){
          const mx=(c3[0][0]+c3[2][0])/2, my=(c3[0][1]+c3[2][1])/2;
          if(!inPoly({x:mx,y:my}, clip)){ r.afOmtrek++; weg='omtrek'; }
        }

        if(!weg) r.goed++;                    // hier past hij gewoon
        r.lijst.push({a,b,c3,weg});
      }
    }
    return r;
  }

  // Beste opstelling voor EEN dakvlak in EEN paneelrichting.
  // 1. de app zoekt zelf de stand met de MEESTE panelen  -> dat is de suggestie
  // 2. wil de gebruiker schuiven, dan zo ver mogelijk, maar NOOIT minder panelen
  function besteVlak(fc, pw, ph){
    let top=probeer(fc, pw, ph, 0, 0);
    const stap=[-1,-0.5,0,0.5,1];
    for(const a of stap) for(const c of stap){
      if(a===0 && c===0) continue;
      const r=probeer(fc, pw, ph, a, c);
      if(r.goed > top.goed) top=r;                     // gelijkspel -> netjes gecentreerd
    }

    const wens = Math.abs(off.h||0)>1e-9 || Math.abs(off.s||0)>1e-9;
    if(!wens){ top.auto=true; return top; }

    const fh = top.speelH>1e-6 ? Math.max(-1, Math.min(1, (off.h||0)/top.speelH)) : 0;
    const fs = top.speelS>1e-6 ? Math.max(-1, Math.min(1, (off.s||0)/top.speelS)) : 0;
    for(const t of [1, 0.75, 0.5, 0.25]){
      const r=probeer(fc, pw, ph, fh*t, fs*t);
      if(r.goed >= top.goed) return r;                 // schuiven mag, verliezen niet
    }
    top.auto=true;
    return top;
  }

  /* Een dakkapel is niet alleen een sta-in-de-weg: hij heeft zelf een (plat)
     dakje, en daar leggen installateurs gewoon panelen op. Dus krijgt elke
     dakkapel een eigen dakvlak bovenop, met een kleinere randmarge (10 cm). */
  const roofs = model.roofs.slice();
  (opt.obstakels||[]).forEach(o=>{
    if(o.type!=='dakkapel') return;
    let voet=null;
    for(const fc of model.roofs){
      if(opVlak(fc, o.x, o.y)){
        const z=zOpVlak(fc, o.x, o.y);
        if(z!=null){ voet=z; break; }
      }
    }
    if(voet==null) return;
    const top=voet+(o.hoogte||1.6);
    roofs.push({
      type:'RoofSurface', kapel:true, vanObstakel:o, marge:0.10, basisHoek:(o.hoek||0),
      pts: obstakelHoeken(o).map(([x,y])=>[x,y,top]),
      holes:[], n:[0,0,1], tilt:5, azi:180
    });
  });

  roofs.forEach((fc,fi)=>{
    const zon = (fc.tilt<5) || (fc.azi==null) || (fc.azi>=90 && fc.azi<=270); // O-Z-W of plat
    const F={index:fi, tilt:fc.tilt, azi:fc.azi, zon, count:0, kapel:!!fc.kapel};
    faces.push(F);
    if(opt.zonOnly && !zon) return;
    if(panels.length>=maxN) return;

    // BESTE SUGGESTIE: probeer staand EN liggend op dit dakvlak, hou de beste.
    // Bij gelijkspel wint de maat die de gebruiker zelf koos.
    const A=besteVlak(fc, pw0, ph0);
    const B=(orient==='auto' && Math.abs(pw0-ph0)>1e-6) ? besteVlak(fc, ph0, pw0) : null;
    const best=(B && B.goed>A.goed) ? B : A;
    F.andersOm=B ? B.goed : null;
    F.auto=!!best.auto;

    F.breedte=best.breedte; F.lengte=best.lengte; F.opp=best.opp;
    F.pw=best.pw; F.ph=best.ph; F.liggend=(best.pw>best.ph);
    F.nc=best.nc; F.nr=best.nr;
    F.afRand=best.afRand; F.afGat=best.afGat; F.afOmtrek=best.afOmtrek;
    F.schuifH=best.schuifH; F.schuifS=best.schuifS;
    F.speelH=best.speelH; F.speelS=best.speelS;


    F.vrij=0;
    best.lijst.forEach(p=>{
      if(panels.length>=maxN*3) return;
      const key='f'+fi+'_'+Math.round(p.a*20)+'_'+Math.round(p.b*20);
      // Paste hij gewoon? Dan staat hij aan, tenzij de gebruiker hem wegtikte.
      // Was hij afgekeurd? Dan staat hij uit als leeg vakje, tenzij de gebruiker
      // hem er zelf bij zette.
      const aan = p.weg ? !!live[key] : !dead[key];
      if(!p.weg && F.count>=maxN) return;
      panels.push({
        key, face:fi, weg:p.weg||null, off:!aan,
        c3:p.c3,
        center:[(p.c3[0][0]+p.c3[2][0])/2, (p.c3[0][1]+p.c3[2][1])/2, (p.c3[0][2]+p.c3[2][2])/2],
        n:fc.n, h:best.h, s:best.s, tilt:fc.tilt, azi:fc.azi,
        ll: p.c3.map(c=>toLatLng(c[0],c[1]))
      });
      if(aan) F.count++;
      else if(p.weg) F.vrij++;
    });
  });

  /* Losse panelen: de gebruiker legt ze waar hij wil, draait en maat ze zelf.
     Eén ding dwingen we wél af: het paneel ligt ín het dakvlak onder zijn
     middelpunt. Ligt er een dakkapel, dan wint die (hoogste vlak). Zo kan een
     los paneel nooit zweven of dwars door een nok steken.                   */
  (opt.los||[]).forEach((LP,i)=>{
    let beste=null, besteZ=-1/0, besteIdx=-1;
    roofs.forEach((fc,fi)=>{
      if(!opVlak(fc, LP.x, LP.y)) return;
      const z=zOpVlak(fc, LP.x, LP.y);
      if(z!=null && z>besteZ){ besteZ=z; beste=fc; besteIdx=fi; }
    });
    if(!beste) return;                       // naast het dak bestaat niet
    let {h,s}=basis(beste.n);
    if(beste.basisHoek){
      const ba=beste.basisHoek*Math.PI/180, co=Math.cos(ba), si=Math.sin(ba);
      const h2=[h[0]*co-s[0]*si, h[1]*co-s[1]*si, h[2]*co-s[2]*si];
      const s2=[s[0]*co+h[0]*si, s[1]*co+h[1]*si, s[2]*co+h[2]*si];
      h=h2; s=s2;
    }
    const d=planeD(beste);
    const a0=dt([LP.x, LP.y, besteZ], h), b0=dt([LP.x, LP.y, besteZ], s);
    const pw2=(LP.pw||pw0)/2, ph2=(LP.ph||ph0)/2;
    const rot=((LP.hoek||0)*Math.PI)/180, co=Math.cos(rot), si=Math.sin(rot);
    const c3=[[-pw2,-ph2],[pw2,-ph2],[pw2,ph2],[-pw2,ph2]].map(([dx,dy])=>{
      const a=a0+dx*co-dy*si, b=b0+dx*si+dy*co;
      return [h[0]*a+s[0]*b+beste.n[0]*d,
              h[1]*a+s[1]*b+beste.n[1]*d,
              h[2]*a+s[2]*b+beste.n[2]*d];
    });
    panels.push({key:'los_'+i, face:besteIdx, weg:'los', los:i, off:false,
      c3, center:[(c3[0][0]+c3[2][0])/2, (c3[0][1]+c3[2][1])/2, (c3[0][2]+c3[2][2])/2],
      n:beste.n, tilt:beste.tilt, azi:beste.azi,
      ll: c3.map(c=>toLatLng(c[0],c[1]))});
    const F=faces[besteIdx];
    if(F) F.count++;
  });

  const out={mode:'real', panels, faces, active: panels.filter(p=>!p.off).length};
  try{ window.dispatchEvent(new CustomEvent('roof:report',{detail:out})); }catch(e){}
  return out;
}

/* ---------- vangnet: platte indeling op de getekende omtrek ---------- */
function flatLayout(latlngs, opt){
  opt=opt||{};
  const pw=Math.max(0.2, opt.pw||1.13), ph=Math.max(0.2, opt.ph||1.72);
  const gap=(opt.gap!=null) ? opt.gap : 0.02;
  const margin=Math.max(0, opt.margin||0);
  const off=opt.off||{h:0,s:0};
  const dead=opt.dead||{};
  const maxN=opt.max||800;
  const R=6378137;

  let oLat=0,oLng=0;
  latlngs.forEach(p=>{oLat+=p.lat; oLng+=p.lng;});
  oLat/=latlngs.length; oLng/=latlngs.length;
  const k=Math.cos(oLat*Math.PI/180);
  const loc=latlngs.map(p=>({
    x:(p.lng-oLng)*Math.PI/180*R*k,
    y:(p.lat-oLat)*Math.PI/180*R
  }));
  const back=(x,y)=>({lat: oLat+(y/R)*180/Math.PI, lng: oLng+(x/(R*k))*180/Math.PI});

  let best=0, theta=0;
  for(let i=0;i<loc.length;i++){
    const a=loc[i], b=loc[(i+1)%loc.length];
    const L=Math.hypot(b.x-a.x, b.y-a.y);
    if(L>best){ best=L; theta=Math.atan2(b.y-a.y, b.x-a.x); }
  }
  const c=Math.cos(theta), s=Math.sin(theta);
  const toP=p=>({x:p.x*c+p.y*s, y:-p.x*s+p.y*c});
  const fromP=q=>({x:q.x*c-q.y*s, y:q.x*s+q.y*c});
  const prime=loc.map(toP);

  let a0=1/0,a1=-1/0,b0=1/0,b1=-1/0;
  prime.forEach(p=>{a0=Math.min(a0,p.x);a1=Math.max(a1,p.x);b0=Math.min(b0,p.y);b1=Math.max(b1,p.y);});

  // Obstakels: van RD naar ditzelfde lokale, gedraaide vlak. Zo gelden dezelfde
  // regels op een getekend dak als op een echt dak.
  const obsPoly=(opt.obstakels||[]).map(o=>{
    const T=OBSTAKEL[o.type]||OBSTAKEL.schoorsteen;
    if(o.type==='boom') return null;
    const vrij=T.vrij||0;
    const groter={type:o.type, x:o.x, y:o.y, hoek:o.hoek||0,
                  w:(o.w!=null?o.w:T.w)+2*vrij, d:(o.d!=null?o.d:T.d)+2*vrij};
    return obstakelHoeken(groter).map(([X,Y])=>{
      const ll=toLatLng(X,Y);
      return toP({ x:(ll.lng-oLng)*Math.PI/180*R*k, y:(ll.lat-oLat)*Math.PI/180*R });
    });
  }).filter(Boolean);

  const sa=pw+gap, sb=ph+gap;
  const panels=[];
  const W=(a1-margin)-(a0+margin), H=(b1-margin)-(b0+margin);
  let nc=0, nr=0;
  if(W>=pw-1e-9 && H>=ph-1e-9){
    nc=Math.floor((W+gap)/sa); nr=Math.floor((H+gap)/sb);
    const speelA=W-(nc*pw+(nc-1)*gap), speelB=H-(nr*ph+(nr-1)*gap);
    const oh=Math.max(-speelA/2, Math.min(speelA/2, off.h||0));   // schuiven kost nooit panelen
    const os=Math.max(-speelB/2, Math.min(speelB/2, off.s||0));
    const startA=(a0+margin)+speelA/2+oh;
    const startB=(b0+margin)+speelB/2+os;
    outer:
    for(let ri=0;ri<nr;ri++){
      for(let ci=0;ci<nc;ci++){
        const a=startA+ci*sa, b=startB+ri*sb;
        const q=[{x:a,y:b},{x:a+pw,y:b},{x:a+pw,y:b+ph},{x:a,y:b+ph}];
        const probe=q.concat([{x:a+pw/2,y:b+ph/2}]);
        if(!fits(prime, probe, margin)) continue;
        // raakt dit paneel een obstakel?
        let botst=false;
        for(const G of obsPoly){
          if(probe.some(p=>inPoly(p,G)) ||
             G.some(p=>p.x>=a && p.x<=a+pw && p.y>=b && p.y<=b+ph)){ botst=true; break; }
        }
        if(botst) continue;
        const key='p_'+Math.round(a*20)+'_'+Math.round(b*20);
        panels.push({
          key, off: !!dead[key], px:a, py:b,
          ll: q.map(p=>{ const w=fromP(p); return back(w.x,w.y); })
        });
        if(panels.length>=maxN) break outer;
      }
    }
  }
  // losse panelen op het getekende dak: hoek is hier absoluut (t.o.v. noord)
  (opt.los||[]).forEach((LP,i)=>{
    const g=toLatLng(LP.x, LP.y);
    const c={ x:(g.lng-oLng)*Math.PI/180*R*k, y:(g.lat-oLat)*Math.PI/180*R };
    const pw2=(LP.pw||pw)/2, ph2=(LP.ph||ph)/2;
    const rot=((LP.hoek||0)*Math.PI)/180, co2=Math.cos(rot), si2=Math.sin(rot);
    const hoekLL=[[-pw2,-ph2],[pw2,-ph2],[pw2,ph2],[-pw2,ph2]].map(([dx,dy])=>
      back(c.x + dx*co2 - dy*si2, c.y + dx*si2 + dy*co2));
    panels.push({key:'los_'+i, los:i, weg:'los', off:false, ll:hoekLL});
  });

  const out={mode:'flat', panels, faces:[], active: panels.filter(p=>!p.off).length,
             vlak:{breedte:a1-a0, lengte:b1-b0, nc, nr},
             theta, localPoly:loc, pw, ph, fromP, origin:{lat:oLat,lng:oLng}};
  try{ window.dispatchEvent(new CustomEvent('roof:report',{detail:out})); }catch(e){}
  return out;
}

return {
  toRd, toLatLng, inPoly, edgeDist,
  load, error:()=>lastError,
  layout, flatLayout,
  OBSTAKEL, obstakelHoeken, _opVlak:opVlak, _zOpVlak:zOpVlak,
  _parse:parse, _tri:triangulate2
};
})();
