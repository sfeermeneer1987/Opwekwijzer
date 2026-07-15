/* ==================================================================
   OpwekWijzer — viewer.js  (v1.1.0)
   Het echte pand in 3D, met de panelen die we net hebben gelegd.

   Bewust klein gehouden: geen bedieningspaneel, geen instellingen. Dit is
   geen ontwerptool maar een bewijsstuk — "dit is uw huis, en zoveel panelen
   passen erop". Slepen mag, verder draait hij vanzelf.

   De data komt rechtstreeks uit roof.js:
   - model.tris : de echte driehoeken uit 3D BAG, in RD (x=oost, y=noord, z=NAP)
   - panel.c3   : de vier hoekpunten van elk paneel, ook in RD+NAP
   Three.js rekent met y omhoog, dus: X = x-cx, Y = z-minz, Z = -(y-cy).

   v1.0.1: camera-afstand uit de omhullende bol i.p.v. een vuistregel.
   v1.0.2: canvas vult de bak (setSize mocht de CSS-maat niet zetten).
   v1.1.0: de panelen leggen zich één voor één, met meetellende tekst —
           dezelfde choreografie als het demopand in de hero. Bij
           prefers-reduced-motion verschijnt alles direct.
================================================================== */
window.Viewer3D = (function(){
"use strict";

const CDN='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
let klaar=null, renderer=null, scene=null, camera=null, doek=null, stop=null;

function laadThree(){
  if(window.THREE) return Promise.resolve();
  if(klaar) return klaar;
  klaar=new Promise((ok,mis)=>{
    const s=document.createElement('script');
    s.src=CDN; s.async=true;
    s.onload=()=>ok();
    s.onerror=()=>mis(new Error('3D-bibliotheek laadt niet'));
    document.head.appendChild(s);
  });
  return klaar;
}

// Het canvas hangt boven het legplan in de teaser. We maken het zelf aan, zodat
// de landingspagina hier niets van hoeft te weten.
function bak(){
  let el=document.getElementById('vw3d');
  if(el){ el.style.display='block'; return el; }
  const na=document.getElementById('dakplan');
  if(!na) return null;
  el=document.createElement('div');
  el.id='vw3d';
  el.style.cssText='position:relative;width:100%;height:280px;border-radius:14px;'
    +'overflow:hidden;margin-bottom:12px;background:#0d2318;cursor:grab;'
    +'box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)';
  el.innerHTML='<div id="vw3dNoot" style="position:absolute;left:10px;bottom:8px;z-index:2;'
    +'font:600 11px/1.3 \'Instrument Sans\',Inter,sans-serif;color:rgba(255,255,255,.75);'
    +'background:rgba(0,0,0,.30);padding:4px 8px;border-radius:7px">'
    +'Uw pand uit de 3D-gebouwenkaart van het Kadaster</div>';
  na.parentNode.insertBefore(el, na);
  return el;
}

function schoon(){
  if(stop){ cancelAnimationFrame(stop); stop=null; }
  if(renderer){
    renderer.dispose();
    if(renderer.domElement && renderer.domElement.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    renderer=null;
  }
  scene=null; camera=null;
}

async function toon(model, panelen){
  if(!model || !model.tris || !model.tris.length) return;
  doek=bak();
  if(!doek) return;
  try{ await laadThree(); }catch(e){ doek.style.display='none'; return; }
  schoon();

  const T=window.THREE;
  const cx=model.cx, cy=model.cy, z0=model.minz;
  const P=p=>[p[0]-cx, p[2]-z0, -(p[1]-cy)];     // RD+NAP -> three
  const rustig = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  scene=new T.Scene();
  scene.background=new T.Color(0x0d2318);

  /* ---- het gebouw: dak, gevel en grond apart ---- */
  function bouw(soort, kleur){
    const punten=[];
    model.tris.forEach(t=>{
      if(t.type!==soort) return;
      [t.a,t.b,t.c].forEach(p=>{ const q=P(p); punten.push(q[0],q[1],q[2]); });
    });
    if(!punten.length) return;
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(punten,3));
    g.computeVertexNormals();
    scene.add(new T.Mesh(g, new T.MeshLambertMaterial({
      color:kleur, side:T.DoubleSide, flatShading:true})));
  }
  bouw('Roof', 0x8d6a52);      // dakpannen
  bouw('Wall', 0xd9d2c5);      // gevel
  bouw('Ground', 0x24402c);

  /* ---- de panelen: elk zijn eigen groepje, zodat ze zich kunnen leggen ---- */
  const aan=(panelen||[]).filter(p=>!p.off && p.c3);
  const groepen=[];
  aan.forEach(p=>{
    const q=p.c3.map(P);
    // een paar centimeter boven het dak, anders knipperen paneel en pan door
    // elkaar heen (z-fighting)
    const n=p.n ? [p.n[0], p.n[2], -p.n[1]] : [0,1,0];
    const q2=q.map(v=>[v[0]+n[0]*0.06, v[1]+n[1]*0.06, v[2]+n[2]*0.06]);
    const ce=[(q2[0][0]+q2[2][0])/2, (q2[0][1]+q2[2][1])/2, (q2[0][2]+q2[2][2])/2];
    const rel=q2.map(v=>[v[0]-ce[0], v[1]-ce[1], v[2]-ce[2]]);

    const pos=[];
    [[0,1,2],[0,2,3]].forEach(t=>t.forEach(i=>pos.push(rel[i][0],rel[i][1],rel[i][2])));
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.computeVertexNormals();
    const mat=new T.MeshLambertMaterial({color:0x101c2b, emissive:0x0a1420,
      side:T.DoubleSide, flatShading:true, transparent:true, opacity:rustig?1:0});

    const lp=[];
    for(let i=0;i<4;i++){
      const a=rel[i], b=rel[(i+1)%4];
      lp.push(a[0],a[1],a[2], b[0],b[1],b[2]);
    }
    const lg=new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(lp,3));
    const lmat=new T.LineBasicMaterial({color:0xf0a500, transparent:true, opacity:rustig?1:0});

    const gr=new T.Group();
    gr.position.set(ce[0],ce[1],ce[2]);
    gr.add(new T.Mesh(g,mat));
    gr.add(new T.LineSegments(lg,lmat));
    if(!rustig) gr.scale.setScalar(0.001);
    scene.add(gr);
    groepen.push(gr);
  });

  /* ---- licht: laagstaande zon geeft het dak reliëf ---- */
  scene.add(new T.AmbientLight(0xbfd8c8, 0.62));
  const zon=new T.DirectionalLight(0xfff0cf, 1.05);
  zon.position.set(-30, 45, 22);
  scene.add(zon);
  const vul=new T.DirectionalLight(0x88aaff, 0.22);
  vul.position.set(25, 12, -30);
  scene.add(vul);

  /* ---- camera: het pand past, wat voor pand het ook is ---- */
  const box=new T.Box3().setFromObject(scene);
  const mid=box.getCenter(new T.Vector3());
  const bol=box.getBoundingSphere(new T.Sphere()).radius || 12;

  const FOV=42;
  camera=new T.PerspectiveCamera(FOV, 1, 0.5, 2000);

  renderer=new T.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  // het canvas vult de bak — zonder deze regels bepaalt de pixelratio de
  // zichtbare maat, en zie je op een telefoon een uitsnede
  renderer.domElement.style.cssText='display:block;width:100%;height:100%';
  doek.appendChild(renderer.domElement);

  let afstand=bol*2.4;
  const ooghoek=28*Math.PI/180;
  let hoek=-0.6, sleep=false, vorigeX=0, draai=true;

  function zet(){
    const b=doek.getBoundingClientRect();
    const w=Math.max(1, Math.round(b.width)), h=Math.max(1, Math.round(b.height));
    renderer.setSize(w, h);                  // three mag de CSS-maat wel zetten
    renderer.domElement.style.width='100%';
    renderer.domElement.style.height='100%';
    camera.aspect=w/h;

    const vFov=FOV*Math.PI/180;
    const hFov=2*Math.atan(Math.tan(vFov/2)*camera.aspect);
    const nodig=Math.max(bol/Math.sin(vFov/2), bol/Math.sin(hFov/2));
    afstand=nodig*1.12;                      // beetje lucht rondom
    camera.far=afstand*4+bol*4;
    camera.updateProjectionMatrix();
    scene.fog=new T.Fog(0x0d2318, afstand*0.9, afstand*2.6);
  }
  zet();
  window.addEventListener('resize', zet);

  const pak=e=>{ sleep=true; draai=false; doek.style.cursor='grabbing';
                 vorigeX=(e.touches?e.touches[0].clientX:e.clientX); };
  const trek=e=>{
    if(!sleep) return;
    const x=(e.touches?e.touches[0].clientX:e.clientX);
    hoek += (x-vorigeX)*0.008;
    vorigeX=x;
    if(e.cancelable) e.preventDefault();
  };
  const los=()=>{ sleep=false; doek.style.cursor='grab'; };
  doek.addEventListener('mousedown', pak);
  doek.addEventListener('touchstart', pak, {passive:true});
  window.addEventListener('mousemove', trek);
  doek.addEventListener('touchmove', trek, {passive:false});
  window.addEventListener('mouseup', los);
  doek.addEventListener('touchend', los);

  /* ---- de choreografie: panelen leggen zich, de tekst telt mee ---- */
  const noot=document.getElementById('vw3dNoot');
  const eindTekst=aan.length+' panelen op uw echte dak — sleep om te draaien';
  const startT=performance.now()+400;
  const stag=Math.max(45, Math.min(200, 1700/Math.max(1,groepen.length)));
  const DUUR=240;
  const ease=p=>1-Math.pow(1-p,3);
  let leggen = !rustig && groepen.length>0;
  if(!leggen && noot) noot.textContent=eindTekst;

  (function teken(nu){
    stop=requestAnimationFrame(teken);
    nu=nu||performance.now();

    if(leggen){
      let af=0, zicht=0;
      groepen.forEach((gr,i)=>{
        const p=Math.max(0, Math.min(1, (nu-startT-i*stag)/DUUR));
        gr.children.forEach(ch=>{ ch.material.opacity=p; });
        gr.scale.setScalar(Math.max(0.001, 0.55+0.45*ease(p)));
        if(p>=1) af++;
        if(p>=0.5) zicht++;
      });
      if(noot) noot.textContent = af<groepen.length
        ? (zicht+' van '+groepen.length+' panelen gelegd…')
        : eindTekst;
      if(af>=groepen.length) leggen=false;
    }

    if(draai) hoek += 0.0022;
    const straal=Math.cos(ooghoek)*afstand;
    camera.position.set(
      mid.x + Math.sin(hoek)*straal,
      mid.y + Math.sin(ooghoek)*afstand,
      mid.z + Math.cos(hoek)*straal
    );
    camera.lookAt(mid);
    renderer.render(scene, camera);
  })();
}

return {toon, uit:schoon};
})();
