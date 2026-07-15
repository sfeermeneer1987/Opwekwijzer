/* ==================================================================
   OpwekWijzer — hero3d.js  (v1.0.0)
   Het demopand in de hero: een Nederlands rijtjeshuis waarop de panelen
   zich één voor één leggen, met een meetikkende teller. Geen belofte
   maar een demonstratie — dit is wat de bezoeker zo van zíjn huis ziet.

   Zuinig by design:
   - three.js laadt pas als de browser niets te doen heeft (idle)
   - prefers-reduced-motion of geen WebGL: het stilstaande beeld blijft
   - het canvas vangt geen aanrakingen (pointer-events:none) — scrollen
     op mobiel blijft heilig
   - tekent alleen als de hero in beeld is én het tabblad actief is
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

  /* ---- het huis: parametrisch rijtjeshuis met zadeldak ---- */
  const W=7.2, Dp=9.6, GH=5.3, NH=8.7;     // breedte, diepte, goot- en nokhoogte
  const scene=new T.Scene();               // transparant: de CSS-lucht schijnt erdoor

  function vlak(pos, kleur){
    const g=new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.computeVertexNormals();
    const mesh=new T.Mesh(g, new T.MeshLambertMaterial({color:kleur, side:T.DoubleSide, flatShading:true}));
    scene.add(mesh); return mesh;
  }

  // romp + topgevels
  const romp=new T.Mesh(new T.BoxGeometry(W,GH,Dp),
    new T.MeshLambertMaterial({color:0xd9d2c5, flatShading:true}));
  romp.position.y=GH/2; scene.add(romp);
  [Dp/2,-Dp/2].forEach(z=>{ vlak([-W/2,GH,z,  W/2,GH,z,  0,NH,z], 0xd9d2c5); });

  // dakvlakken (nok over de diepte), klein overstek
  const ov=0.28, zo=Dp/2+0.22, dakY=GH-0.12;
  vlak([0,NH,-zo,  0,NH,zo,  W/2+ov,dakY,zo,   0,NH,-zo,  W/2+ov,dakY,zo,  W/2+ov,dakY,-zo], 0x8d6a52);
  vlak([0,NH,-zo,  -(W/2+ov),dakY,zo,  0,NH,zo,   0,NH,-zo,  -(W/2+ov),dakY,-zo,  -(W/2+ov),dakY,zo], 0x8d6a52);

  // schoorsteen op de noordhelling
  const sch=new T.Mesh(new T.BoxGeometry(0.7,1.3,0.7),
    new T.MeshLambertMaterial({color:0x7c5a48, flatShading:true}));
  sch.position.set(-1.2, NH-0.2, -2.6); scene.add(sch);

  // deur en ramen: donkere platen op de voorgevel — bijna gratis karakter
  function plaat(w,h,x,y,kleur){
    const p=new T.Mesh(new T.PlaneGeometry(w,h), new T.MeshLambertMaterial({color:kleur}));
    p.position.set(x,y,Dp/2+0.015); scene.add(p);
  }
  plaat(0.95,2.1, -2.2, 1.15, 0x233327);
  plaat(1.5,1.4,  0.6, 1.65, 0x9fb4c4);  plaat(1.5,1.4, 2.4, 1.65, 0x9fb4c4);
  plaat(1.5,1.3, -1.4, 4.0,  0x9fb4c4);  plaat(1.5,1.3, 1.2, 4.0,  0x9fb4c4);

  // zachte schaduwvlek als grond
  const grond=new T.Mesh(new T.CircleGeometry(9.5,48),
    new T.MeshBasicMaterial({color:0x07160e, transparent:true, opacity:0.5}));
  grond.rotation.x=-Math.PI/2; grond.position.y=0.01; scene.add(grond);

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
    const pos=[];
    [[0,1,2],[0,2,3]].forEach(t=>t.forEach(i=>pos.push(rel[i].x,rel[i].y,rel[i].z)));
    g.setAttribute('position', new T.Float32BufferAttribute(pos,3));
    g.computeVertexNormals();
    const mat=new T.MeshLambertMaterial({color:0x101c2b, emissive:0x0a1420,
      side:T.DoubleSide, flatShading:true, transparent:true, opacity:0});

    const lp=[];
    for(let i=0;i<4;i++){ const a=rel[i], b=rel[(i+1)%4]; lp.push(a.x,a.y,a.z, b.x,b.y,b.z); }
    const lg=new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(lp,3));
    const lmat=new T.LineBasicMaterial({color:0xf0a500, transparent:true, opacity:0});

    const gr=new T.Group();
    gr.position.copy(ce);
    gr.add(new T.Mesh(g,mat));
    gr.add(new T.LineSegments(lg,lmat));
    gr.userData.nrm=nrm.clone();
    scene.add(gr);
    panelen.push(gr);
  }

  /* ---- licht: warme zon, koele tegenhanger ---- */
  scene.add(new T.AmbientLight(0xcfe0d2, 0.6));
  const zon=new T.DirectionalLight(0xffe2a8, 1.1);  zon.position.set(14,20,9);   scene.add(zon);
  const koel=new T.DirectionalLight(0x8fb0ff, 0.2); koel.position.set(-11,7,-12); scene.add(koel);

  /* ---- renderer + camera ---- */
  const renderer=new T.WebGLRenderer({antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  bak.appendChild(renderer.domElement);

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

  /* ---- de choreografie: leggen → vasthouden → opnieuw ---- */
  const STAP=380, DUUR=300, RUST=3400, WEG=450, oog=24*Math.PI/180;
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
        gr.children.forEach(ch=>{ ch.material.opacity=p; });
        gr.scale.setScalar(Math.max(0.001, 0.55+0.45*e));
        // klein 'landings'-liftje langs de daknormaal
        const lift=0.35*(1-e);
        gr.position.addScaledVector(gr.userData.nrm, lift-(gr.userData.lift||0));
        gr.userData.lift=lift;
        if(p>=1) klaarN++;
        if(p>=0.5) zicht++;
      });
      teller(zicht);
      if(klaarN>=panelen.length){ fase='rust'; t0=nu; }
    } else if(fase==='rust'){
      if(t>RUST){ fase='weg'; t0=nu; }
    } else { // weg
      const p=Math.max(0, Math.min(1, t/WEG));
      panelen.forEach(gr=>{ gr.children.forEach(ch=>{ ch.material.opacity=1-p; }); });
      if(p>=1){
        panelen.forEach(gr=>{ gr.scale.setScalar(0.001); });
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
