/* ==================================================================
   OpwekWijzer — viewer.js  (v2.1.0)
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
   v2.1.0: scherper en echter —
     - de luchtfoto (nu PNG, 2048 px, licht verscherpt) ligt alleen nog op
       de grond: op het dak is de 8 cm-bron nooit scherp te krijgen
     - het pand zelf krijgt materialen op ware maat: dakpannen in rijen
       langs de goot, metselwerk in halfsteensverband, bitumen op platte
       dakdelen — schoorstenen kent 3D BAG helaas niet, die generaliseert
       kleine dakopbouwen weg
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

  /* ---- het speelveld in RD: nodig voor de luchtfoto op de grond ---- */
  let bx0=1/0, bx1=-1/0, by0=1/0, by1=-1/0;
  model.tris.forEach(t=>[t.a,t.b,t.c].forEach(p=>{
    if(p[0]<bx0)bx0=p[0]; if(p[0]>bx1)bx1=p[0];
    if(p[1]<by0)by0=p[1]; if(p[1]>by1)by1=p[1];
  }));
  const PAD=9;                                  // meters tuin en straat rondom
  bx0-=PAD; bx1+=PAD; by0-=PAD; by1+=PAD;

  /* ---- de textielkast: dakpannen, metselwerk en bitumen op ware maat ----
     De luchtfoto gaat NIET meer over het pand: op 8 cm bronresolutie is een
     dakpan vier pixels, dat wordt nooit scherp. Het pand krijgt daarom echte
     materialen; alleen de grond eromheen houdt de foto. De uv's rekenen we
     per vlak uit, in meters: één textuurtegel is 8 pannen of 4 stenen breed. */
  const CEL={ panW:2.40, panH:2.76,      // 8×8 pannen van 30 × 34,5 cm
              steenW:0.88, steenH:0.50,  // 4 stenen × 8 lagen (waalformaat)
              platW:2.0,  platH:2.0 };
  const RR=(a,b)=>a+Math.random()*(b-a);
  function maakTex(px, teken){
    const c=document.createElement('canvas'); c.width=px; c.height=px;
    teken(c.getContext('2d'), px);
    const t=new T.CanvasTexture(c);
    t.wrapS=t.wrapT=T.RepeatWrapping;
    t.encoding=T.sRGBEncoding;
    t.anisotropy=renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  // dakpannen: verspringende rijen met welving (licht boven, schaduw onder)
  const panT=maakTex(256, g=>{
    g.fillStyle='#7a5743'; g.fillRect(0,0,256,256);
    for(let r=0;r<8;r++){
      const y=r*32, off=(r%2)*16;
      for(let k=-1;k<9;k++){
        const x=k*32+off;
        g.fillStyle='hsl('+RR(14,24)+','+RR(26,38)+'%,'+RR(28,40)+'%)';
        g.fillRect(x,y,31,31);
        const gr=g.createLinearGradient(0,y,0,y+32);
        gr.addColorStop(0,'rgba(255,235,208,.26)');
        gr.addColorStop(.55,'rgba(0,0,0,0)');
        gr.addColorStop(1,'rgba(18,4,0,.4)');
        g.fillStyle=gr; g.fillRect(x,y,31,31);
      }
    }
  });

  // metselwerk: rijen bakstenen in halfsteensverband, met voeg
  const steenT=maakTex(256, g=>{
    g.fillStyle='#cfc7b8'; g.fillRect(0,0,256,256);
    for(let r=0;r<8;r++){
      const y=r*32, off=(r%2)*32;
      for(let k=-1;k<5;k++){
        const x=k*64+off;
        g.fillStyle='hsl('+RR(10,19)+','+RR(30,44)+'%,'+RR(40,52)+'%)';
        g.fillRect(x+2,y+2,60,28);
        g.fillStyle='rgba(30,10,0,'+RR(0,.1)+')';
        g.fillRect(x+2,y+2,60,28);
      }
    }
  });

  // bitumen voor platte dakdelen: donkergrijs met korrel
  const platT=maakTex(128, g=>{
    g.fillStyle='#43464a'; g.fillRect(0,0,128,128);
    for(let i=0;i<700;i++){
      g.fillStyle='rgba('+(Math.random()<.5?'255,255,255':'0,0,0')+','+RR(.03,.10).toFixed(2)+')';
      g.fillRect(RR(0,127),RR(0,127),RR(1,2),RR(1,2));
    }
  });

  const matDak  =new T.MeshStandardMaterial({map:panT, bumpMap:panT, bumpScale:.03, roughness:.8, side:T.DoubleSide});
  const matPlat =new T.MeshStandardMaterial({map:platT, roughness:.95, side:T.DoubleSide});
  const matGevel=new T.MeshStandardMaterial({map:steenT, roughness:.92, side:T.DoubleSide});
  const matGrond=new T.MeshStandardMaterial({color:0x24402c, roughness:.95});

  /* ---- het gebouw: elk vlak zijn eigen uv-assen, in meters ----
     Voor een hellend dakvlak: u loopt horizontaal langs de goot, v omhoog
     langs de helling — zo liggen de pannenrijen altijd goed. Voor een gevel:
     u langs de muur, v de hoogte — zo stapelen de lagen netjes.            */
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const kruis=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const een=v=>{const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l];};
  const dt=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const COS15=Math.cos(15*Math.PI/180);

  const pand=new T.Group(); scene.add(pand);
  const emmers={pan:{pos:[],uv:[],mat:matDak}, plat:{pos:[],uv:[],mat:matPlat}, gevel:{pos:[],uv:[],mat:matGevel}};

  model.tris.forEach(t=>{
    if(t.type!=='Roof' && t.type!=='Wall') return;   // de BAG-'Ground' vervalt: de fotovloer ligt eronder
    const n=een(kruis(sub(t.b,t.a), sub(t.c,t.a)));
    let emmer, uAs, vAs, celW, celH;
    if(t.type==='Roof' && Math.abs(n[2])>=COS15){
      emmer=emmers.plat; uAs=[1,0,0]; vAs=[0,1,0]; celW=CEL.platW; celH=CEL.platH;
    } else if(t.type==='Roof'){
      emmer=emmers.pan;
      uAs=een(kruis([0,0,1], n));                    // horizontaal, langs de goot
      vAs=een(kruis(n, uAs));                        // omhoog langs de helling
      if(vAs[2]<0){ vAs=[-vAs[0],-vAs[1],-vAs[2]]; uAs=[-uAs[0],-uAs[1],-uAs[2]]; }
      celW=CEL.panW; celH=CEL.panH;
    } else {
      emmer=emmers.gevel;
      const h=kruis([0,0,1], n);
      uAs=(Math.hypot(h[0],h[1],h[2])>1e-6)?een(h):[1,0,0];  // langs de muur
      vAs=[0,0,1];                                            // de lagen stapelen omhoog
      celW=CEL.steenW; celH=CEL.steenH;
    }
    [t.a,t.b,t.c].forEach(p=>{
      const q=P(p); emmer.pos.push(q[0],q[1],q[2]);
      const lok=[p[0]-cx, p[1]-cy, p[2]-z0];
      emmer.uv.push(dt(lok,uAs)/celW, dt(lok,vAs)/celH);
    });
  });
  Object.keys(emmers).forEach(k=>{
    const e=emmers[k];
    if(!e.pos.length) return;
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(e.pos,3));
    g.setAttribute('uv', new T.Float32BufferAttribute(e.uv,2));
    g.computeVertexNormals();
    const m=new T.Mesh(g, e.mat);
    m.castShadow=true; m.receiveShadow=true;
    pand.add(m);
  });

  const vloer=new T.Mesh(new T.PlaneGeometry(bx1-bx0, by1-by0), matGrond);
  vloer.rotation.x=-Math.PI/2;
  vloer.position.set((bx0+bx1)/2-cx, .02, -(((by0+by1)/2)-cy));
  vloer.receiveShadow=true;
  scene.add(vloer);

  /* ---- de luchtfoto: scherp, en alleen op de grond (PDOK, CC-BY) ----
     PNG in plaats van JPEG (geen compressieblokjes), 2048 pixels, en een
     lichte verscherping (unsharp mask) vóór hij de scene in gaat. Scherper
     dan de 8 cm van de bron kan niet — maar dit haalt eruit wat erin zit. */
  (function(){
    const asp=(bx1-bx0)/(by1-by0), L=2048;
    const Wpx=asp>=1?L:Math.round(L*asp);
    const Hpx=asp>=1?Math.round(L/asp):L;
    const url=WMS+'?service=WMS&request=GetMap&version=1.3.0&layers=Actueel_orthoHR'
      +'&styles=&crs=EPSG:28992&format=image/png'
      +'&bbox='+bx0.toFixed(2)+','+by0.toFixed(2)+','+bx1.toFixed(2)+','+by1.toFixed(2)
      +'&width='+Wpx+'&height='+Hpx;
    const img=new Image();
    img.crossOrigin='anonymous';
    img.onload=function(){
      let bron=img;
      try{
        // unsharp mask: origineel + 0,85 × (origineel − vervaagd)
        const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
        const g=c.getContext('2d');
        g.drawImage(img,0,0);
        const orig=g.getImageData(0,0,c.width,c.height);
        g.filter='blur(1.4px)'; g.drawImage(img,0,0); g.filter='none';
        const blur=g.getImageData(0,0,c.width,c.height);
        const o=orig.data, b=blur.data, A=0.85;
        for(let i=0;i<o.length;i+=4){
          o[i]  =Math.min(255,Math.max(0, o[i]  +(o[i]  -b[i]  )*A));
          o[i+1]=Math.min(255,Math.max(0, o[i+1]+(o[i+1]-b[i+1])*A));
          o[i+2]=Math.min(255,Math.max(0, o[i+2]+(o[i+2]-b[i+2])*A));
        }
        g.putImageData(orig,0,0);
        bron=c;
      }catch(e){ /* oud toestel of CORS-hik: dan de foto zoals hij is */ }
      const t=new T.CanvasTexture(bron);
      t.encoding=T.sRGBEncoding;
      t.anisotropy=renderer?renderer.capabilities.getMaxAnisotropy():1;
      matGrond.map=t; matGrond.color.set(0xffffff); matGrond.needsUpdate=true;
      const b2=document.getElementById('vw3dBron'); if(b2) b2.style.opacity='1';
    };
    img.onerror=function(){ /* geen foto? dan blijft het rustige groen staan */ };
    img.src=url;
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
