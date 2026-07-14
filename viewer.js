/* ==================================================================
   OpwekWijzer — viewer.js  (v1.0.0)
   Het echte pand in 3D, met de panelen die we net hebben gelegd.

   Bewust klein gehouden: geen bedieningspaneel, geen instellingen. Dit is
   geen ontwerptool maar een bewijsstuk — "dit is uw huis, en zoveel panelen
   passen erop". Slepen mag, verder draait hij vanzelf.

   De data komt rechtstreeks uit roof.js:
   - model.tris : de echte driehoeken uit 3D BAG, in RD (x=oost, y=noord, z=NAP)
   - panel.c3   : de vier hoekpunten van elk paneel, ook in RD+NAP
   Three.js rekent met y omhoog, dus: X = x-cx, Y = z-minz, Z = -(y-cy).
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
  if(el) return el;
  const na=document.getElementById('dakplan');
  if(!na) return null;
  el=document.createElement('div');
  el.id='vw3d';
  el.style.cssText='position:relative;width:100%;height:260px;border-radius:14px;'
    +'overflow:hidden;margin-bottom:12px;background:#0d2318;cursor:grab;'
    +'box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)';
  el.innerHTML='<div id="vw3dNoot" style="position:absolute;left:10px;bottom:8px;z-index:2;'
    +'font:600 11px/1.3 Inter,sans-serif;color:rgba(255,255,255,.75);'
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

  scene=new T.Scene();
  scene.background=new T.Color(0x0d2318);
  scene.fog=new T.Fog(0x0d2318, 45, 140);

  /* ---- het gebouw: dak, gevel en grond apart ---- */
  function bouw(soort, kleur){
    const pos=[];
    model.tris.forEach(t=>{
      if(t.type!==soort) return;
      [t.a,t.b,t.c].forEach(p=>{ const q=P(p); pos.push(q[0],q[1],q[2]); });
    });
    if(!pos.length) return;
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.computeVertexNormals();
    scene.add(new T.Mesh(g, new T.MeshLambertMaterial({
      color:kleur, side:T.DoubleSide, flatShading:true})));
  }
  bouw('Roof', 0x8d6a52);      // dakpannen
  bouw('Wall', 0xd9d2c5);      // gevel
  bouw('Ground', 0x24402c);

  /* ---- de panelen: exact de vlakken die we hebben gelegd ---- */
  const aan=(panelen||[]).filter(p=>!p.off && p.c3);
  const pos=[], lijn=[];
  aan.forEach(p=>{
    const q=p.c3.map(P);
    // een paar centimeter boven het dak, anders knipperen paneel en pan door
    // elkaar heen (z-fighting)
    const n=p.n ? [p.n[0], p.n[2], -p.n[1]] : [0,1,0];
    const q2=q.map(v=>[v[0]+n[0]*0.06, v[1]+n[1]*0.06, v[2]+n[2]*0.06]);
    [[0,1,2],[0,2,3]].forEach(t=>t.forEach(i=>pos.push(q2[i][0],q2[i][1],q2[i][2])));
    for(let i=0;i<4;i++){
      const a=q2[i], b=q2[(i+1)%4];
      lijn.push(a[0],a[1],a[2], b[0],b[1],b[2]);
    }
  });
  if(pos.length){
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.computeVertexNormals();
    scene.add(new T.Mesh(g, new T.MeshLambertMaterial({
      color:0x101c2b, side:T.DoubleSide, flatShading:true, emissive:0x0a1420})));
    const lg=new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(lijn,3));
    scene.add(new T.LineSegments(lg, new T.LineBasicMaterial({color:0xf0a500})));
  }

  /* ---- licht: laagstaande zon geeft het dak reliëf ---- */
  scene.add(new T.AmbientLight(0xbfd8c8, 0.62));
  const zon=new T.DirectionalLight(0xfff0cf, 1.05);
  zon.position.set(-30, 45, 22);
  scene.add(zon);
  const vul=new T.DirectionalLight(0x88aaff, 0.22);
  vul.position.set(25, 12, -30);
  scene.add(vul);

  /* ---- camera: draait rustig rond, tot de bezoeker zelf pakt ---- */
  const straal=Math.max(model.spanX, model.spanY, model.height)*1.55+9;
  const hoogte=model.height+straal*0.42;
  camera=new T.PerspectiveCamera(42, 1, 0.5, 400);

  renderer=new T.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  doek.appendChild(renderer.domElement);

  let hoek=-0.6, sleep=false, vorigeX=0, draai=true;
  function zet(){
    const b=doek.getBoundingClientRect();
    const w=Math.max(1, b.width), h=Math.max(1, b.height);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
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

  (function teken(){
    stop=requestAnimationFrame(teken);
    if(draai) hoek += 0.0022;
    camera.position.set(Math.sin(hoek)*straal, hoogte, Math.cos(hoek)*straal);
    camera.lookAt(0, model.height*0.45, 0);
    renderer.render(scene, camera);
  })();

  const noot=document.getElementById('vw3dNoot');
  if(noot) noot.textContent = aan.length+' panelen op uw echte dak — sleep om te draaien';
}

return {toon, uit:schoon};
})();
