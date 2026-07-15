/* ==================================================================
   OpwekWijzer — hero3d.js  (v2.1.0)
   Het demopand in de hero: een Nederlands rijtjeshuis waarop de panelen
   zich één voor één leggen, met een meetikkende teller.

   v2.0.0 — het huis wordt echt:
   - échte slagschaduwen (huis, schoorsteen en panelen werpen schaduw)
   - PBR-materialen met procedurele texturen: metselwerk, dakpannen,
     gras, stoeptegels en paneelcellen — alles uit eigen canvas,
     geen downloads, geen licenties
   - kozijnen met diepte, spiegelend glas, dakgoot, nokvorst, tuintje
   - ACES-tonemapping + omgevingsreflectie voor filmisch licht

   v2.1.0 — het slotstuk:
   - na het laatste paneel verschijnt de thuisbatterij aan de gevel,
     met een amberkleurig lampje en het label "+ thuisbatterij"
   - bij de reset van de loop verdwijnt hij netjes mee

   Zuinig by design (ongewijzigd):
   - three.js laadt pas als de browser niets te doen heeft (idle)
   - prefers-reduced-motion of geen WebGL: het stilstaande beeld blijft
   - canvas vangt geen aanrakingen; tekent alleen in beeld + tab actief
================================================================== */
(function(){
"use strict";

const CDN='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const bak=document.getElementById('h3d');
if(!bak) return;
const num=document.getElementById('h3dNum');

// liever een rustig stilstaand beeld dan beweging die iemand niet wil
if(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

let begonnen=false;
function laat(){
  if(begonnen) return; begonnen=true;
  const s=document.createElement('script');
  s.src=CDN; s.async=true;
  s.onload=function(){ try{ bouw(); }catch(e){ /* fallback blijft staan */ } };
  document.head.appendChild(s);
}
if('requestIdleCallback' in window) requestIdleCallback(laat,{timeout:2600});
else setTimeout(laat, 1400);

function bouw(){
  const T=window.THREE;

  /* ---- renderer eerst: texturen en reflecties hebben hem nodig ---- */
  const renderer=new T.WebGLRenderer({antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.outputEncoding=T.sRGBEncoding;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  bak.appendChild(renderer.domElement);

  const scene=new T.Scene();   // transparant: de CSS-lucht schijnt erdoor

  /* ---- de textielkast: elk materiaal komt uit een eigen canvasje ---- */
  const R=(a,b)=>a+Math.random()*(b-a);
  function tex(w,h,teken){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    teken(c.getContext('2d'), w, h);
    const t=new T.CanvasTexture(c);
    t.wrapS=t.wrapT=T.RepeatWrapping;
    t.encoding=T.sRGBEncoding;
    t.anisotropy=renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  // metselwerk: rijen bakstenen in halfsteensverband, met voeg
  function steentjes(){
    return tex(256,256,g=>{
      g.fillStyle='#cfc7b8'; g.fillRect(0,0,256,256);
      for(let r=0;r<8;r++){
        const y=r*32, off=(r%2)*32;
        for(let k=-1;k<5;k++){
          const x=k*64+off;
          g.fillStyle='hsl('+R(10,19)+','+R(30,44)+'%,'+R(40,52)+'%)';
          g.fillRect(x+2,y+2,60,28);
          g.fillStyle='rgba(30,10,0,'+R(0,.1)+')';
          g.fillRect(x+2,y+2,60,28);
        }
      }
    });
  }
  const steenTex=steentjes();  steenTex.repeat.set(2.6,1.9);   // romp (uv 0..1 per zijde)
  const steenVlakTex=steentjes();                              // topgevels (uv al geschaald)

  // dakpannen: verspringende rijen met welving (licht boven, schaduw onder)
  const panTex=tex(256,256,g=>{
    g.fillStyle='#7a5743'; g.fillRect(0,0,256,256);
    for(let r=0;r<8;r++){
      const y=r*32, off=(r%2)*16;
      for(let k=-1;k<9;k++){
        const x=k*32+off;
        g.fillStyle='hsl('+R(14,24)+','+R(26,38)+'%,'+R(28,40)+'%)';
        g.fillRect(x,y,31,31);
        const gr=g.createLinearGradient(0,y,0,y+32);
        gr.addColorStop(0,'rgba(255,235,208,.26)');
        gr.addColorStop(.55,'rgba(0,0,0,0)');
        gr.addColorStop(1,'rgba(18,4,0,.4)');
        g.fillStyle=gr; g.fillRect(x,y,31,31);
      }
    }
  });

  const grasTex=tex(128,128,g=>{
    g.fillStyle='#4c7a4e'; g.fillRect(0,0,128,128);
    for(let i=0;i<900;i++){
      g.fillStyle='hsl('+R(95,135)+','+R(24,42)+'%,'+R(20,40)+'%)';
      g.fillRect(R(0,127),R(0,127),R(1,2.4),R(1,2.4));
    }
  });
  grasTex.repeat.set(7,7);

  const tegelTex=tex(64,64,g=>{
    g.fillStyle='#b9b6ac'; g.fillRect(0,0,64,64);
    g.strokeStyle='#8f8d84'; g.lineWidth=2; g.strokeRect(1,1,62,62);
  });
  tegelTex.repeat.set(2,5);

  // zonnepaneelcellen: donkerblauw glas met celranden en busbars
  const celTex=tex(128,128,g=>{
    g.fillStyle='#0d1a2a'; g.fillRect(0,0,128,128);
    g.strokeStyle='#25405c'; g.lineWidth=2;
    for(let i=0;i<=4;i++){
      g.beginPath(); g.moveTo(i*32,0); g.lineTo(i*32,128); g.stroke();
      g.beginPath(); g.moveTo(0,i*32); g.lineTo(128,i*32); g.stroke();
    }
    g.strokeStyle='#16283d'; g.lineWidth=1;
    for(let i=0;i<8;i++){ g.beginPath(); g.moveTo(i*16+8,0); g.lineTo(i*16+8,128); g.stroke(); }
  });

  /* ---- de materialen ---- */
  const M={
    steen:  new T.MeshStandardMaterial({map:steenTex, roughness:.92}),
    gevelV: new T.MeshStandardMaterial({map:steenVlakTex, roughness:.92, side:T.DoubleSide}),
    pan:    new T.MeshStandardMaterial({map:panTex, bumpMap:panTex, bumpScale:.03, roughness:.8, side:T.DoubleSide}),
    kozijn: new T.MeshStandardMaterial({color:0xefe9dc, roughness:.6}),
    glas:   new T.MeshStandardMaterial({color:0x9cb8cc, metalness:.7, roughness:.06, envMapIntensity:1.35}),
    deur:   new T.MeshStandardMaterial({color:0x2c4534, roughness:.5}),
    goot:   new T.MeshStandardMaterial({color:0x9aa0a4, metalness:.65, roughness:.3}),
    nok:    new T.MeshStandardMaterial({color:0x63463a, roughness:.85}),
    schoor: new T.MeshStandardMaterial({color:0x99604c, roughness:.9}),
    gras:   new T.MeshStandardMaterial({map:grasTex, roughness:.96}),
    tegel:  new T.MeshStandardMaterial({map:tegelTex, roughness:.85}),
    heg:    new T.MeshStandardMaterial({color:0x2f5a38, roughness:.95})
  };
  const paneelBasis=new T.MeshStandardMaterial({map:celTex, metalness:.5, roughness:.25,
    envMapIntensity:1.25, side:T.DoubleSide, transparent:true, opacity:0});

  function metSchaduw(m){ m.castShadow=true; m.receiveShadow=true; return m; }

  /* ---- het huis: parametrisch rijtjeshuis met zadeldak ---- */
  const W=7.2, Dp=9.6, GH=5.3, NH=8.7;     // breedte, diepte, goot- en nokhoogte
  const huis=new T.Group(); scene.add(huis);

  const romp=metSchaduw(new T.Mesh(new T.BoxGeometry(W,GH,Dp), M.steen));
  romp.position.y=GH/2; huis.add(romp);

  // los vlak met eigen uv's (topgevels en dakvlakken)
  function vlak(pos, uv, mat){
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv,2));
    g.computeVertexNormals();
    return metSchaduw(new T.Mesh(g, mat));
  }

  // topgevels: metselwerk loopt door in maat van de romp
  [Dp/2,-Dp/2].forEach(z=>{
    const P=[-W/2,GH,z,  W/2,GH,z,  0,NH,z];
    const U=[];
    for(let i=0;i<P.length;i+=3) U.push((P[i]/W+.5)*2.6, P[i+1]/GH*1.9);
    huis.add(vlak(P,U,M.gevelV));
  });

  // dakvlakken met pannen: uv langs diepte en langs de helling, in meters
  const ov=.28, zo=Dp/2+.22, dakY=GH-.12;
  const hell=Math.hypot(W/2+ov, NH-dakY);        // schuine lengte van nok tot goot
  function dakVlak(sx){
    const x=sx*(W/2+ov);
    const P=[0,NH,-zo,  0,NH,zo,  x,dakY,zo,   0,NH,-zo,  x,dakY,zo,  x,dakY,-zo];
    const U=[];
    for(let i=0;i<P.length;i+=3){
      U.push((P[i+2]+zo)/1.6, (Math.abs(P[i])/(W/2+ov))*hell/1.6);
    }
    huis.add(vlak(P,U,M.pan));
  }
  dakVlak(1); dakVlak(-1);

  // nokvorst en dakgoten
  const nokv=metSchaduw(new T.Mesh(new T.BoxGeometry(.22,.14,Dp+.5), M.nok));
  nokv.position.y=NH+.05; huis.add(nokv);
  [1,-1].forEach(s=>{
    const g=metSchaduw(new T.Mesh(new T.BoxGeometry(.16,.15,Dp+.5), M.goot));
    g.position.set(s*(W/2+ov+.03), dakY-.03, 0); huis.add(g);
  });

  // schoorsteen op de noordhelling, met kraag
  const sch=metSchaduw(new T.Mesh(new T.BoxGeometry(.7,1.3,.7), M.schoor));
  sch.position.set(-1.2, NH-.2, -2.6); huis.add(sch);
  const kraag=metSchaduw(new T.Mesh(new T.BoxGeometry(.84,.1,.84), M.nok));
  kraag.position.set(-1.2, NH+.42, -2.6); huis.add(kraag);

  // ramen: kozijn met diepte, spiegelend glas, vensterbank
  function raam(w,h,x,y){
    const fr=metSchaduw(new T.Mesh(new T.BoxGeometry(w+.16,h+.16,.1), M.kozijn));
    fr.position.set(x,y,Dp/2+.04); huis.add(fr);
    const gl=new T.Mesh(new T.PlaneGeometry(w,h), M.glas);
    gl.position.set(x,y,Dp/2+.095); huis.add(gl);
    const vb=metSchaduw(new T.Mesh(new T.BoxGeometry(w+.26,.08,.16), M.kozijn));
    vb.position.set(x,y-h/2-.08,Dp/2+.07); huis.add(vb);
  }
  raam(1.5,1.4,  .6,1.65); raam(1.5,1.4, 2.4,1.65);
  raam(1.5,1.3,-1.4,4.0);  raam(1.5,1.3, 1.2,4.0);

  // voordeur met stoepje
  const dfr=metSchaduw(new T.Mesh(new T.BoxGeometry(1.1,2.24,.1), M.kozijn));
  dfr.position.set(-2.2,1.17,Dp/2+.04); huis.add(dfr);
  const dbl=new T.Mesh(new T.PlaneGeometry(.94,2.08), M.deur);
  dbl.position.set(-2.2,1.14,Dp/2+.095); dbl.receiveShadow=true; huis.add(dbl);
  const stoep=metSchaduw(new T.Mesh(new T.BoxGeometry(1.35,.1,.6), M.tegel));
  stoep.position.set(-2.2,.05,Dp/2+.32); huis.add(stoep);

  /* ---- de tuin: gras vangt de schaduw van het huis ---- */
  const gras=new T.Mesh(new T.CircleGeometry(12,48), M.gras);
  gras.rotation.x=-Math.PI/2; gras.receiveShadow=true; scene.add(gras);
  const pad=new T.Mesh(new T.BoxGeometry(1.4,.05,3.4), M.tegel);
  pad.position.set(-2.2,.028,Dp/2+2.35); pad.receiveShadow=true; scene.add(pad);
  const heg1=metSchaduw(new T.Mesh(new T.BoxGeometry(3.4,.8,.7), M.heg));
  heg1.position.set(1.6,.4,Dp/2+.75); scene.add(heg1);
  const heg2=metSchaduw(new T.Mesh(new T.BoxGeometry(1.2,.7,.7), M.heg));
  heg2.position.set(-3.4,.35,Dp/2+.75); scene.add(heg2);

  /* ---- de panelen op de zuidhelling: 2 rijen × 7 = 14 ---- */
  const eave=new T.Vector3(W/2, dakY, 0), nok=new T.Vector3(0, NH, 0);
  const uHelling=new T.Vector3().subVectors(nok,eave).normalize();
  const uDiep=new T.Vector3(0,0,1);
  const nrm=new T.Vector3().crossVectors(uDiep,uHelling).normalize();
  const PW=1.13, PH=1.72, GAP=0.05, RAND=0.4, RIJEN=2, KOL=7;

  const start=new T.Vector3().copy(eave)
    .addScaledVector(uHelling, RAND)
    .addScaledVector(uDiep, -((KOL*PW+(KOL-1)*GAP)/2))
    .addScaledVector(nrm, 0.09);

  const panelen=[];
  for(let r=0;r<RIJEN;r++) for(let c=0;c<KOL;c++){
    const o=new T.Vector3().copy(start)
      .addScaledVector(uHelling, r*(PH+GAP))
      .addScaledVector(uDiep, c*(PW+GAP));
    const p1=o.clone(),
          p2=o.clone().addScaledVector(uDiep,PW),
          p3=o.clone().addScaledVector(uDiep,PW).addScaledVector(uHelling,PH),
          p4=o.clone().addScaledVector(uHelling,PH);
    const ce=new T.Vector3().addVectors(p1,p3).multiplyScalar(0.5);
    const rel=[p1,p2,p3,p4].map(v=>v.clone().sub(ce));

    const g=new T.BufferGeometry();
    const pos=[], uv=[];
    const uvHoek=[[0,0],[1,0],[1,1],[0,1]];
    [[0,1,2],[0,2,3]].forEach(t=>t.forEach(i=>{
      pos.push(rel[i].x,rel[i].y,rel[i].z);
      uv.push(uvHoek[i][0],uvHoek[i][1]);
    }));
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv,2));
    g.computeVertexNormals();
    const mesh=new T.Mesh(g, paneelBasis.clone());
    mesh.receiveShadow=true;                   // castShadow gaat aan zodra het paneel ligt

    const lp=[];
    for(let i=0;i<4;i++){ const a=rel[i], b=rel[(i+1)%4]; lp.push(a.x,a.y,a.z, b.x,b.y,b.z); }
    const lg=new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(lp,3));
    const lmat=new T.LineBasicMaterial({color:0xf0a500, transparent:true, opacity:0});

    const gr=new T.Group();
    gr.position.copy(ce);
    gr.add(mesh);
    gr.add(new T.LineSegments(lg,lmat));
    gr.userData.nrm=nrm.clone();
    scene.add(gr);
    panelen.push(gr);
  }

  /* ---- de thuisbatterij: het slotstuk van de choreografie ----
     Een wandkast aan de voorgevel, links van de deur, met een amberkleurig
     lampje. Hij verschijnt pas als het laatste paneel ligt: eerst het dak,
     dan de accu — precies de volgorde die we mensen ook adviseren.        */
  const accu=new T.Group();
  const accuMats=[];
  function accuDeel(geo, mat, x, y, z){
    mat.transparent=true; mat.opacity=0; accuMats.push(mat);
    const m=new T.Mesh(geo, mat);
    m.position.set(x,y,z);
    m.castShadow=true; m.receiveShadow=true;
    accu.add(m);
    return m;
  }
  accuDeel(new T.BoxGeometry(.62,.92,.17),
    new T.MeshStandardMaterial({color:0x1b2126, metalness:.35, roughness:.4}), 0,0,0);
  accuDeel(new T.BoxGeometry(.54,.84,.02),
    new T.MeshStandardMaterial({color:0x232b31, metalness:.3, roughness:.28, envMapIntensity:1.1}), 0,0,.09);
  const accuLed=accuDeel(new T.BoxGeometry(.05,.5,.012),
    new T.MeshStandardMaterial({color:0x2a1c00, emissive:0xf0a500, emissiveIntensity:0, roughness:.4}), -.17,.06,.10);
  accu.position.set(-3.15, 1.12, Dp/2+.10);
  accu.scale.setScalar(0.001);
  scene.add(accu);

  // het label "+ thuisbatterij" hoort bij de accu, dus hero3d maakt het zelf
  const badge=document.createElement('div');
  badge.textContent='+ thuisbatterij';
  badge.style.cssText='position:absolute;left:12px;top:64px;z-index:2;opacity:0;'
    +'font:700 11.5px/1.2 \'Instrument Sans\',Inter,sans-serif;color:#3a2a00;'
    +'background:linear-gradient(180deg,#ffc93d,#f0a500);padding:6px 10px;border-radius:9px;'
    +'box-shadow:0 4px 12px rgba(240,165,0,.35)';
  bak.appendChild(badge);

  /* ---- licht: warme zon mét schaduw, koele tegenhanger, zachte hemel ---- */
  scene.add(new T.AmbientLight(0xbcd2c0, .32));
  scene.add(new T.HemisphereLight(0xd6ecf6, 0x30503a, .5));
  const zon=new T.DirectionalLight(0xffe0a6, 1.55);
  zon.position.set(14,20,9);
  zon.castShadow=true;
  zon.shadow.mapSize.set(1024,1024);
  const sc=zon.shadow.camera;
  sc.left=-14; sc.right=14; sc.top=16; sc.bottom=-10; sc.near=5; sc.far=55;
  zon.shadow.bias=-0.0004; zon.shadow.normalBias=.04;
  scene.add(zon);
  const koel=new T.DirectionalLight(0x8fb0ff, .18);
  koel.position.set(-11,7,-12); scene.add(koel);

  // omgevingsreflectie: piepkleine geschilderde lucht -> PBR-glans op glas en panelen
  (function(){
    const c=document.createElement('canvas'); c.width=64; c.height=32;
    const g=c.getContext('2d');
    const gr=g.createLinearGradient(0,0,0,32);
    gr.addColorStop(0,'#cfe6f4'); gr.addColorStop(.55,'#e9f2e6');
    gr.addColorStop(.62,'#4d7350'); gr.addColorStop(1,'#2b4a33');
    g.fillStyle=gr; g.fillRect(0,0,64,32);
    g.fillStyle='rgba(255,232,170,.95)';
    g.beginPath(); g.arc(47,7,4,0,7); g.fill();
    const t=new T.CanvasTexture(c); t.mapping=T.EquirectangularReflectionMapping;
    const pm=new T.PMREMGenerator(renderer);
    scene.environment=pm.fromEquirectangular(t).texture;
    pm.dispose(); t.dispose();
  })();

  /* ---- camera ---- */
  const camera=new T.PerspectiveCamera(40, 1, 0.5, 300);
  const mid=new T.Vector3(0, NH*0.46, 0);
  const bol=Math.max(W,Dp,NH)*0.72+2;
  let afstand=bol*2.6;
  function zet(){
    const b=bak.getBoundingClientRect();
    const w=Math.max(1,Math.round(b.width)), h=Math.max(1,Math.round(b.height));
    renderer.setSize(w,h,false);
    renderer.domElement.style.width='100%'; renderer.domElement.style.height='100%';
    camera.aspect=w/h;
    const vF=40*Math.PI/180, hF=2*Math.atan(Math.tan(vF/2)*camera.aspect);
    afstand=Math.max(bol/Math.sin(vF/2), bol/Math.sin(hF/2))*1.1;
    camera.updateProjectionMatrix();
  }
  zet(); addEventListener('resize', zet);

  /* ---- de choreografie: leggen → accu → vasthouden → opnieuw ---- */
  const STAP=380, DUUR=300, ACCU_D=650, RUST=3400, WEG=450, oog=24*Math.PI/180;
  const ease=p=>1-Math.pow(1-p,3);
  let fase='leg', t0=performance.now()+700, hoek=0.9;
  let zichtbaar=true, actief=true, getoond=false;

  new IntersectionObserver(es=>{ zichtbaar=es[0].isIntersecting; },{threshold:.05}).observe(bak);
  document.addEventListener('visibilitychange', ()=>{ actief=!document.hidden; });

  function teller(n){ if(num) num.textContent=String(n); }

  (function teken(nu){
    requestAnimationFrame(teken);
    if(!zichtbaar || !actief) return;
    nu=nu||performance.now();
    const t=nu-t0;

    if(fase==='leg'){
      let klaarN=0, zicht=0;
      panelen.forEach((gr,i)=>{
        const p=Math.max(0, Math.min(1, (t-i*STAP)/DUUR));
        const e=ease(p);
        gr.children.forEach(ch=>{
          ch.material.opacity=p;
          if(ch.isMesh) ch.castShadow = p>0.5;   // schaduw pas als het paneel er ligt
        });
        gr.scale.setScalar(Math.max(0.001, 0.55+0.45*e));
        // klein 'landings'-liftje langs de daknormaal
        const lift=0.35*(1-e);
        gr.position.addScaledVector(gr.userData.nrm, lift-(gr.userData.lift||0));
        gr.userData.lift=lift;
        if(p>=1) klaarN++;
        if(p>=0.5) zicht++;
      });
      teller(zicht);
      if(klaarN>=panelen.length){ fase='accu'; t0=nu; }
    } else if(fase==='accu'){
      // het slotakkoord: de thuisbatterij verschijnt aan de gevel
      const p=Math.max(0, Math.min(1, t/ACCU_D));
      const e=ease(p);
      accu.scale.setScalar(Math.max(0.001, 0.55+0.45*e));
      accuMats.forEach(m=>{ m.opacity=p; });
      accuLed.material.emissiveIntensity=1.6*e;
      badge.style.opacity=String(p);
      if(p>=1){ fase='rust'; t0=nu; }
    } else if(fase==='rust'){
      if(t>RUST){ fase='weg'; t0=nu; }
    } else { // weg
      const p=Math.max(0, Math.min(1, t/WEG));
      panelen.forEach(gr=>{ gr.children.forEach(ch=>{
        ch.material.opacity=1-p;
        if(ch.isMesh) ch.castShadow = p<0.5;
      }); });
      accuMats.forEach(m=>{ m.opacity=1-p; });
      accuLed.material.emissiveIntensity=1.6*(1-p);
      badge.style.opacity=String(1-p);
      if(p>=1){
        panelen.forEach(gr=>{ gr.scale.setScalar(0.001); });
        accu.scale.setScalar(0.001);
        accuLed.material.emissiveIntensity=0;
        badge.style.opacity='0';
        teller(0);
        fase='leg'; t0=nu+500;
      }
    }

    hoek += 0.0028;
    const straal=Math.cos(oog)*afstand;
    camera.position.set(mid.x+Math.sin(hoek)*straal, mid.y+Math.sin(oog)*afstand, mid.z+Math.cos(hoek)*straal);
    camera.lookAt(mid);
    renderer.render(scene, camera);

    if(!getoond){ getoond=true; teller(0); bak.classList.add('aan'); }
  })();
}
})();
