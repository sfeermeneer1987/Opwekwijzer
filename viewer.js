/* ==================================================================
   OpwekWijzer — viewer.js  (v2.0.0)
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
   v1.1.0: de panelen leggen zich één voor één, met meetellende tekst.
   v2.0.0: het pand wordt echt —
     - de officiële PDOK-luchtfoto (Actueel_orthoHR, 8 cm, CC-BY) wordt
       van bovenaf over het dak én de omgeving gedrapeerd: de bezoeker
       ziet zijn eigen dakpannen, tuin en straat onder de panelen
     - échte slagschaduwen (pand op de grond, panelen op het dak)
     - PBR-materialen, paneelcellen, ACES-tonemapping, omgevingsreflectie
     - laadt de foto de mist in? Dan blijven de rustige vlakkleuren staan.
================================================================== */
window.Viewer3D = (function(){
"use strict";

const CDN='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const WMS='https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0';
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
    +'Uw pand uit de 3D-gebouwenkaart van het Kadaster</div>'
    +'<div id="vw3dBron" style="position:absolute;right:10px;bottom:8px;z-index:2;opacity:0;'
    +'transition:opacity .6s;font:600 9.5px/1.2 \'Instrument Sans\',Inter,sans-serif;'
    +'color:rgba(255,255,255,.55);background:rgba(0,0,0,.28);padding:3px 7px;border-radius:6px">'
    +'Luchtfoto: PDOK \u00b7 CC-BY</div>';
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

  /* ---- renderer eerst: texturen en reflecties hebben hem nodig ---- */
  renderer=new T.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  // het canvas vult de bak — zonder deze regels bepaalt de pixelratio de
  // zichtbare maat, en zie je op een telefoon een uitsnede
  renderer.domElement.style.cssText='display:block;width:100%;height:100%';
  doek.appendChild(renderer.domElement);

  scene=new T.Scene();
  scene.background=new T.Color(0x0d2318);

  /* ---- het speelveld in RD: nodig voor de luchtfoto en de uv's ---- */
  let bx0=1/0, bx1=-1/0, by0=1/0, by1=-1/0;
  model.tris.forEach(t=>[t.a,t.b,t.c].forEach(p=>{
    if(p[0]<bx0)bx0=p[0]; if(p[0]>bx1)bx1=p[0];
    if(p[1]<by0)by0=p[1]; if(p[1]>by1)by1=p[1];
  }));
  const PAD=9;                                  // meters tuin en straat rondom
  bx0-=PAD; bx1+=PAD; by0-=PAD; by1+=PAD;
  const uvVan=p=>[(p[0]-bx0)/(bx1-bx0), (p[1]-by0)/(by1-by0)];

  /* ---- het gebouw: dak en gevel apart, dak krijgt foto-uv's ---- */
  const matDak  =new T.MeshStandardMaterial({color:0x8d6a52, roughness:.85, side:T.DoubleSide});
  const matGevel=new T.MeshStandardMaterial({color:0xd9d2c5, roughness:.9,  side:T.DoubleSide});
  const matGrond=new T.MeshStandardMaterial({color:0x24402c, roughness:.95});

  const pand=new T.Group(); scene.add(pand);
  function deel(soort, mat, metUv){
    const pos=[], uv=[];
    model.tris.forEach(t=>{
      if(t.type!==soort) return;
      [t.a,t.b,t.c].forEach(p=>{
        const q=P(p); pos.push(q[0],q[1],q[2]);
        if(metUv){ const u=uvVan(p); uv.push(u[0],u[1]); }
      });
    });
    if(!pos.length) return;
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    if(metUv) g.setAttribute('uv', new T.Float32BufferAttribute(uv,2));
    g.computeVertexNormals();
    const m=new T.Mesh(g, mat);
    m.castShadow=true; m.receiveShadow=true;
    pand.add(m);
  }
  deel('Roof', matDak, true);
  deel('Wall', matGevel, false);
  // de BAG-'Ground' (alleen de voetafdruk) vervalt: de fotovloer hieronder
  // beslaat het hele speelveld en vangt de schaduw van het pand

  const vloer=new T.Mesh(new T.PlaneGeometry(bx1-bx0, by1-by0), matGrond);
  vloer.rotation.x=-Math.PI/2;
  vloer.position.set((bx0+bx1)/2-cx, .02, -(((by0+by1)/2)-cy));
  vloer.receiveShadow=true;
  scene.add(vloer);

  /* ---- de luchtfoto: van bovenaf op vloer én dak (PDOK, CC-BY) ---- */
  (function(){
    const asp=(bx1-bx0)/(by1-by0);
    const Wpx=asp>=1?1000:Math.round(1000*asp);
    const Hpx=asp>=1?Math.round(1000/asp):1000;
    const url=WMS+'?service=WMS&request=GetMap&version=1.3.0&layers=Actueel_orthoHR'
      +'&styles=&crs=EPSG:28992&format=image/jpeg'
      +'&bbox='+bx0.toFixed(2)+','+by0.toFixed(2)+','+bx1.toFixed(2)+','+by1.toFixed(2)
      +'&width='+Wpx+'&height='+Hpx;
    const l=new T.TextureLoader(); l.setCrossOrigin('anonymous');
    l.load(url, t=>{
      t.encoding=T.sRGBEncoding;
      t.anisotropy=renderer?renderer.capabilities.getMaxAnisotropy():1;
      matGrond.map=t; matGrond.color.set(0xffffff); matGrond.needsUpdate=true;
      matDak.map=t;   matDak.color.set(0xffffff);   matDak.needsUpdate=true;
      const b=document.getElementById('vw3dBron'); if(b) b.style.opacity='1';
    });   // mislukt de foto? dan blijven de vlakkleuren gewoon staan
  })();

  /* ---- de panelen: elk zijn eigen groepje, zodat ze zich kunnen leggen ---- */
  const celTex=(function(){
    const c=document.createElement('canvas'); c.width=128; c.height=128;
    const g=c.getContext('2d');
    g.fillStyle='#0d1a2a'; g.fillRect(0,0,128,128);
    g.strokeStyle='#25405c'; g.lineWidth=2;
    for(let i=0;i<=4;i++){
      g.beginPath(); g.moveTo(i*32,0); g.lineTo(i*32,128); g.stroke();
      g.beginPath(); g.moveTo(0,i*32); g.lineTo(128,i*32); g.stroke();
    }
    g.strokeStyle='#16283d'; g.lineWidth=1;
    for(let i=0;i<8;i++){ g.beginPath(); g.moveTo(i*16+8,0); g.lineTo(i*16+8,128); g.stroke(); }
    const t=new T.CanvasTexture(c);
    t.encoding=T.sRGBEncoding;
    return t;
  })();
  const paneelBasis=new T.MeshStandardMaterial({map:celTex, metalness:.5, roughness:.25,
    envMapIntensity:1.25, side:T.DoubleSide, transparent:true, opacity:rustig?1:0});

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

    const pos=[], uv=[];
    const uvHoek=[[0,0],[1,0],[1,1],[0,1]];
    [[0,1,2],[0,2,3]].forEach(t=>t.forEach(i=>{
      pos.push(rel[i][0],rel[i][1],rel[i][2]);
      uv.push(uvHoek[i][0],uvHoek[i][1]);
    }));
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv,2));
    g.computeVertexNormals();
    const mesh=new T.Mesh(g, paneelBasis.clone());
    mesh.receiveShadow=true;
    mesh.castShadow=rustig;                    // anders pas zodra het paneel ligt

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
    gr.add(mesh);
    gr.add(new T.LineSegments(lg,lmat));
    if(!rustig) gr.scale.setScalar(0.001);
    scene.add(gr);
    groepen.push(gr);
  });

  /* ---- licht: laagstaande zon mét schaduw geeft het pand gewicht ---- */
  scene.add(new T.AmbientLight(0xbfd8c8, .35));
  scene.add(new T.HemisphereLight(0xd0e8f2, 0x24402c, .45));
  const zon=new T.DirectionalLight(0xfff0cf, 1.5);
  zon.position.set(-30, 45, 22);
  zon.castShadow=true;
  zon.shadow.mapSize.set(1024,1024);
  scene.add(zon);
  const vul=new T.DirectionalLight(0x88aaff, .2);
  vul.position.set(25, 12, -30);
  scene.add(vul);

  // omgevingsreflectie: piepklein geschilderd luchtje -> glans op de panelen
  (function(){
    const c=document.createElement('canvas'); c.width=64; c.height=32;
    const g=c.getContext('2d');
    const gr=g.createLinearGradient(0,0,0,32);
    gr.addColorStop(0,'#bcd9ea'); gr.addColorStop(.55,'#dcebdd');
    gr.addColorStop(.62,'#3c5c44'); gr.addColorStop(1,'#152a1c');
    g.fillStyle=gr; g.fillRect(0,0,64,32);
    g.fillStyle='rgba(255,236,190,.9)';
    g.beginPath(); g.arc(14,7,4,0,7); g.fill();
    const t=new T.CanvasTexture(c); t.mapping=T.EquirectangularReflectionMapping;
    const pm=new T.PMREMGenerator(renderer);
    scene.environment=pm.fromEquirectangular(t).texture;
    pm.dispose(); t.dispose();
  })();

  /* ---- camera: het pand past, wat voor pand het ook is ---- */
  // de fit rekent op het pand zelf, niet op de grote fotovloer eromheen
  const box=new T.Box3().setFromObject(pand);
  const mid=box.getCenter(new T.Vector3());
  const bol=box.getBoundingSphere(new T.Sphere()).radius || 12;

  const sc=zon.shadow.camera, sr=bol*2.2;
  sc.left=-sr; sc.right=sr; sc.top=sr; sc.bottom=-sr; sc.near=5; sc.far=160;
  zon.shadow.bias=-0.0005; zon.shadow.normalBias=.06;
  zon.target.position.copy(mid); scene.add(zon.target);

  const FOV=42;
  camera=new T.PerspectiveCamera(FOV, 1, 0.5, 2000);

  let afstand=bol*2.4;
  const ooghoek=28*Math.PI/180;
  let hoek=-0.6, sleep=false, vorigeX=0, draai=true;

  function zet(){
    const b=doek.getBoundingClientRect();
    const w=Math.max(1, Math.round(b.width)), h=Math.max(1, Math.round(b.height));
    renderer.setSize(w, h);
    renderer.domElement.style.width='100%';
    renderer.domElement.style.height='100%';
    camera.aspect=w/h;

    const vFov=FOV*Math.PI/180;
    const hFov=2*Math.atan(Math.tan(vFov/2)*camera.aspect);
    const nodig=Math.max(bol/Math.sin(vFov/2), bol/Math.sin(hFov/2));
    afstand=nodig*1.12;                      // beetje lucht rondom
    camera.far=afstand*4+bol*4;
    camera.updateProjectionMatrix();
    scene.fog=new T.Fog(0x0d2318, afstand*0.95, afstand*2.7);
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
        gr.children.forEach(ch=>{
          ch.material.opacity=p;
          if(ch.isMesh) ch.castShadow = p>0.5;
        });
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
