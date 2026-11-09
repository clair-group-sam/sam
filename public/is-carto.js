/* Cartographie Part-IS V7.1 (22/07/2026), drawing code kept as written; data from the S.A.M. registers (window.__CARTO). */
(function(){
const C = window.__CARTO; if (!C || !document.getElementById("carto-root")) return;
const E = {AJD:'--ajd', ASJ:'--asj', ASF:'--asf', GRP:'--grp'};
const RISK = {critical:['--st-critical','◆','Critical'], serious:['--st-serious','▲','To address'], warning:['--st-warn','●','To monitor']};

// resp: own = entity's own contract | grp = Clair Group / other entity responsibility | auth = authorities / State
// contract: ok = holder identified | tbc = holder or IS clauses to be confirmed
const DATA = C.DATA;

const EDGES = C.EDGES;

// pseudo-node in the ASJ+ASF nebula: group CAMO reference
const NEB_EXTRA = {ASJASF:[{id:'camoref', short:'Airworthiness — see PRO-IS-01 AJD', name:'Group CAMO (AJD)', dept:'Group CAMO', ent:['AJD','ASJ'], resp:'grp', contract:'tbc', impact:'Y', hosting:'—', provider:'AJD (Astonjet Ltd)', purpose:'AJD’s CAMO also serves as ASJ’s CAMO — systems listed in PRO-IS-01 AJD (TrustFlight, CAMP, OEM portals)', dataT:'Maintenance / airworthiness', status:'confirme', risk:null, notes:['Interface with an organisation SUBJECT to Part-IS (AJD) — category i of AMC1 IS.I.OR.205(b)','CSM decision 22/07/2026: group CAMO'], src:'G. Fournie (CSM)'}]};

const OUTER = {x:16, y:46, w:1248, h:432, title:'CLAIR GROUP — CGSMT / CGPFR · SUPPORT FUNCTIONS', sub:'Sub-departments created by CSM decision 22/07/2026 · entities NOT Part-IS certified → interfaces to be contracted'};
const ZONES = {
  g_compta:{x:28,  y:92,  w:402, h:110, title:'ACCOUNTING', small:true},
  g_hr:    {x:442, y:92,  w:402, h:110, title:'HR', small:true},
  g_it:    {x:856, y:92,  w:396, h:170, title:'IT', small:true},
  g_mkt:   {x:28,  y:214, w:402, h:110, title:'MARKETING', small:true},
  g_own:   {x:442, y:214, w:402, h:110, title:'MARKETING / OWNER', small:true},
  g_gen:   {x:28,  y:336, w:402, h:110, title:'GENERIC', small:true},
  trans:  {x:16,  y:542, w:1248, h:118, title:'TRANSVERSE — CONCERNS EVERYONE', sub:'CSM decision 22/07/2026: Leon, Centrik, Webmanuals, Spendesk — used by all departments'},
  fo:     {x:16,  y:676, w:400,  h:172, title:'FLIGHT OPS', sub:'AJD · ASJ — Leon transverse above'},
  camo:   {x:432, y:676, w:400,  h:172, title:'GROUP CAMO — HELD BY AJD', sub:'The AJD CAMO also serves ASJ · the ASJ annex refers here'},
  go:     {x:864, y:676, w:400,  h:172, title:'GROUND OPS', sub:'AJD · ASJ — dispatch, perf, EFB, crew travel'},
  training:{x:16, y:864, w:400,  h:172, title:'TRAINING', sub:'AJD · ASJ — department created (CSM 22/07)'},
  caa:    {x:432, y:864, w:400,  h:172, title:'CAA / EASA — AUTHORITY & STATE CHANNELS', sub:'Regulatory reporting and State invoicing (CSM 22/07)'},
  asf:    {x:864, y:864, w:400,  h:172, title:'ASF — ASTONFLY (ATO)', sub:'Flight school · DGAC / DSAC · covered by the ASJ MSM'},
  pending:{x:16,  y:1052, w:1248, h:112, title:'AWAITING FEEDBACK', sub:'Departments that have not replied to the 31/03/2026 email — follow-up to come'},
};

const svg = document.getElementById('map');
const nebsvg = document.getElementById('neb');
const NS = 'http://www.w3.org/2000/svg';
let mode=C.mode||'neb', nebEnt=C.neb||'AJD', view=C.view||'all', impactOnly=false, selected=null;
const pos = {};

function el(n,attrs,parent){const e=document.createElementNS(NS,n);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}

/* ===================== NEBULA ===================== */
const SECTORS = {
  own: {a0:-90, a1:90,  lblx:1250, lbly:70,  anchor:'end',   title:'UNDER ENTITY RESPONSIBILITY', sub:'own contracts — IS clauses to be carried (IS.I.OR.235)'},
  grp: {a0:180, a1:270, lblx:30,   lbly:70,  anchor:'start', title:'CLAIR GROUP / OTHER ENTITIES RESPONSIBILITY', sub:'organisation not subject to Part-IS → contractual control'},
  auth:{a0:90,  a1:180, lblx:30,   lbly:830, anchor:'start', title:'AUTHORITIES / STATE', sub:'imposed channels (TM-CAD, DGAC, EU, AIFE)'},
};
function nebSystems(entKey){
  const base = DATA.filter(d=>d.zone!=='pending' && d.resp && (entKey==='AJD' ? d.ent.includes('AJD') : (d.ent.includes('ASJ')||d.ent.includes('ASF'))));
  if(entKey==='AJD') return base;
  return base.map(d=>d.respAsj?Object.assign({},d,{resp:d.respAsj}):d).concat(NEB_EXTRA.ASJASF);
}
function drawNebula(){
  nebsvg.innerHTML='';
  const CX=640, CY=440;
  const LEVEL3 = ['travelperk']; // lower risk — CSM decision 22/07
  const ringOf = d => d.risk==='critical' ? 235 : (LEVEL3.includes(d.id) ? 368 : 305);
  const systems = nebSystems(nebEnt);
  const SFILL = {own:'rgba(42,120,214,0.08)', grp:'rgba(232,123,164,0.10)', auth:'rgba(74,58,167,0.08)'};
  const SLEG  = {own:'rgba(42,120,214,0.45)', grp:'rgba(232,123,164,0.55)', auth:'rgba(74,58,167,0.45)'};
  // 3 sectors, 3 colours, full disc
  for(const k in SECTORS){const S=SECTORS[k];
    const a0=Math.PI*S.a0/180, a1=Math.PI*S.a1/180, ri=76, ro=402;
    const p=`M${CX+ri*Math.cos(a0)},${CY+ri*Math.sin(a0)} L${CX+ro*Math.cos(a0)},${CY+ro*Math.sin(a0)} `+
            `A${ro},${ro} 0 0 1 ${CX+ro*Math.cos(a1)},${CY+ro*Math.sin(a1)} L${CX+ri*Math.cos(a1)},${CY+ri*Math.sin(a1)} `+
            `A${ri},${ri} 0 0 0 ${CX+ri*Math.cos(a0)},${CY+ri*Math.sin(a0)} Z`;
    el('path',{d:p,fill:SFILL[k],stroke:'none'},nebsvg);
  }
  for(const k in SECTORS){const S=SECTORS[k];
    [S.a0,S.a1].forEach(a=>{const r=Math.PI*a/180;
      el('line',{x1:CX+70*Math.cos(r),y1:CY+70*Math.sin(r),x2:CX+402*Math.cos(r),y2:CY+402*Math.sin(r),stroke:'var(--baseline)','stroke-width':1.2},nebsvg);});
    const sw = S.anchor==='start' ? S.lblx : S.lblx-16;
    el('rect',{x:sw,y:S.lbly-11,width:16,height:12,rx:3,fill:SLEG[k],stroke:'var(--ring)'},nebsvg);
    const tx = S.anchor==='start' ? S.lblx+22 : S.lblx-22;
    const t=el('text',{x:tx,y:S.lbly,'text-anchor':S.anchor,class:'sector-lbl'},nebsvg); t.textContent=S.title;
    const s=el('text',{x:tx,y:S.lbly+14,'text-anchor':S.anchor,class:'sector-sub'},nebsvg); s.textContent=S.sub;
  }
  // level circles L1 / L2 / L3, lightly drawn but visible, with labels
  [[235,'L1'],[305,'L2'],[368,'L3']].forEach(([r,lbl])=>{
    el('circle',{cx:CX,cy:CY,r:r,fill:'none',stroke:'var(--baseline)','stroke-width':1,opacity:0.55},nebsvg);
    const t=el('text',{x:CX+10,y:CY+r-8,class:'ring-lbl'},nebsvg); t.textContent=lbl;
  });
  const rl=el('text',{x:CX,y:CY-244,'text-anchor':'middle',class:'sector-sub'},nebsvg);
  rl.textContent='L1 = critical · L2 = standard · L3 = lower risk';
  const byS={};
  systems.forEach(d=>{(byS[d.resp]=byS[d.resp]||[]).push(d);});
  const placed=[];
  for(const k in byS){
    const rings={};
    byS[k].forEach(d=>{const r=ringOf(d);(rings[r]=rings[r]||[]).push(d);});
    // unique vertical slots (spacing >= node height); x follows the level circle
    const list=byS[k].slice().sort((a,b)=>ringOf(a)-ringOf(b));
    const n=list.length; const ys=[];
    if(k==='own'){const span=Math.min(300, 30+n*30);
      for(let i=0;i<n;i++) ys.push(n===1?0:-span+2*span*i/(n-1));}
    else if(k==='grp'){for(let i=0;i<n;i++) ys.push(n===1?-220:-345+250*i/(n-1));}
    else {for(let i=0;i<n;i++) ys.push(n===1?220:95+250*i/(n-1));}
    // compress slots so no node is pushed beyond its own level circle
    const maxAbs=Math.max(...ys.map(Math.abs));
    const maxR=Math.max(...list.map(ringOf))-28;
    if(maxAbs>maxR){const f=maxR/maxAbs; for(let i=0;i<ys.length;i++) ys[i]*=f;}
    ys.sort((a,b)=>Math.abs(a)-Math.abs(b));
    list.forEach((d,i)=>{
      const dy=ys[i], r=ringOf(d);
      const dx=Math.sqrt(Math.max(r*r-dy*dy, 3600));
      placed.push({d, x:(k==='own'?CX+dx:CX-dx), y:CY+dy});
    });
  }
  const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // flow direction: bidirectional by default; 'in' = towards the entity; 'out' = towards the system
  const FLOWDIR = {navdata:'in', oem:'in', eccairs:'out'};
  function particle(x1,y1,x2,y2,col,sz,dur,begin){
    const tip=el('path',{d:`M${-sz},${-sz*0.62} L${sz},0 L${-sz},${sz*0.62} Z`,fill:col,opacity:0.8},nebsvg);
    el('animateMotion',{dur:dur+'s',repeatCount:'indefinite',path:`M${x1},${y1} L${x2},${y2}`,begin:begin+'s',rotate:'auto'},tip);
    el('animate',{attributeName:'opacity',values:'0;0.8;0.8;0',keyTimes:'0;0.12;0.82;1',
      dur:dur+'s',repeatCount:'indefinite',begin:begin+'s'},tip);
  }
  placed.forEach((p,i)=>{
    const col = p.d.risk ? `var(${RISK[p.d.risk][0]})` : 'var(--baseline)';
    el('line',{x1:CX,y1:CY,x2:p.x,y2:p.y,stroke:col,'stroke-width':p.d.risk==='critical'?2:1.4,
      class:'cz-spoke','stroke-dasharray':p.d.contract==='tbc'?'5 4':'none'},nebsvg);
    if(animate){
      const sz=p.d.risk==='critical'?4.6:3.8, dur=3.2+(i%7)*0.55, b=-(i%9)*0.6;
      const dir=FLOWDIR[p.d.id]||'both';
      if(dir==='in'||dir==='both')  particle(p.x,p.y,CX,CY,col,sz,dur,b);
      if(dir==='out'||dir==='both') particle(CX,CY,p.x,p.y,col,sz,dur,b-dur/2);
    }
  });
  const cg=el('g',{style:'cursor:pointer'},nebsvg);
  el('circle',{cx:CX,cy:CY,r:62,fill:'var(--surface-1)',stroke:nebEnt==='AJD'?'var(--ajd)':'var(--asj)','stroke-width':2.5},cg);
  const ct=el('text',{x:CX,y:CY-4,'text-anchor':'middle',style:'font-size:17px;font-weight:700;fill:var(--ink-1)'},cg);
  ct.textContent = nebEnt==='AJD' ? 'AJD' : 'ASJ + ASF';
  const cs=el('text',{x:CX,y:CY+14,'text-anchor':'middle',style:'font-size:8.5px;fill:var(--ink-muted)'},cg);
  cs.textContent='click: department detail';
  cg.addEventListener('click',()=>{setMode('map'); setView(nebEnt);});
  placed.forEach(p=>{
    const d=p.d, W=136, H=36;
    const g=el('g',{class:'neb-node','data-id':d.id,transform:`translate(${p.x-W/2},${p.y-H/2})`,style:'cursor:pointer'},nebsvg);
    const stroke = d.risk?`var(${RISK[d.risk][0]})`:'var(--baseline)';
    el('rect',{width:W,height:H,rx:8,stroke:stroke,'stroke-dasharray':d.status==='confirme'?'none':'4 3'},g);
    const nm=el('text',{x:W/2,y:15,'text-anchor':'middle',class:'cz-nm'},g);
    nm.textContent=(d.risk?RISK[d.risk][1]+' ':'')+d.name;
    const dp=el('text',{x:W/2,y:27,'text-anchor':'middle',class:'cz-dp'},g);
    dp.textContent=d.short;
    if(d.contract){const cc=el('text',{x:W-6,y:13,'text-anchor':'end',style:'font-size:9.5px;font-weight:700;fill:'+(d.contract==='ok'?'var(--st-good)':(d.contract==='none'?'var(--st-critical)':'var(--ink-muted)'))},g);cc.textContent=d.contract==='ok'?'✓':(d.contract==='none'?'✕':'?');}
    g.addEventListener('click',ev=>{ev.stopPropagation();showPanel(d);});
    const tt=el('title',{},g); tt.textContent=`${d.name} — ${d.purpose}`;
  });
  renderTiles();
}

/* ===================== DEPARTMENT MAP ===================== */
function layout(){
  svg.innerHTML='';
  el('rect',{x:OUTER.x,y:OUTER.y,width:OUTER.w,height:OUTER.h,rx:10,class:'cz-zone outer'},svg);
  const ot=el('text',{x:OUTER.x+12,y:OUTER.y+20,class:'zone-title'},svg); ot.textContent=OUTER.title;
  const os=el('text',{x:OUTER.x+12,y:OUTER.y+34,class:'zone-sub'},svg); os.textContent=OUTER.sub;
  for(const z in ZONES){const Z=ZONES[z];
    el('rect',{x:Z.x,y:Z.y,width:Z.w,height:Z.h,rx:8,class:'cz-zone'},svg);
    const t=el('text',{x:Z.x+12,y:Z.y+18,class:'zone-title'+(Z.small?' sm':'')},svg); t.textContent=Z.title;
    if(Z.sub){const s=el('text',{x:Z.x+12,y:Z.y+32,class:'zone-sub'},svg); s.textContent=Z.sub;}
  }
  el('line',{x1:16,y1:510,x2:1264,y2:510,stroke:'var(--st-critical)','stroke-width':1.6,'stroke-dasharray':'7 5'},svg);
  const fl=el('text',{x:640,y:502,'text-anchor':'middle',style:'font-size:10.5px;font-weight:600;fill:var(--st-critical)'},svg);
  fl.textContent='PART-IS BOUNDARY — interfaces with organisations not subject to Part-IS: contractual control required (IS.I.OR.235 · 215(c) · AMC1 205(b))';
  const byZone={};
  DATA.forEach(d=>{(byZone[d.zone]=byZone[d.zone]||[]).push(d);});
  const NW=142, NH=46, GX=12, GY=14;
  for(const z in byZone){const Z=ZONES[z];
    const top=Z.sub?46:28;
    const cols=Math.max(1,Math.floor((Z.w-24+GX)/(NW+GX)));
    byZone[z].forEach((d,i)=>{
      const c=i%cols, r=Math.floor(i/cols);
      pos[d.id]=[Z.x+14+c*(NW+GX), Z.y+top+r*(NH+GY)];
    });
  }
  const defs=el('defs',{},svg);
  const mk=el('marker',{id:'arr',viewBox:'0 0 8 8',refX:7,refY:4,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},defs);
  el('path',{d:'M0,0 L8,4 L0,8 z',fill:'var(--ink-muted)'},mk);
  const eg=el('g',{},svg);
  function anchorNode(id,other){const [x,y]=pos[id];const cy=(other[1]>y)?y+46:y;return [x+71,cy];}
  function zoneAnchor(z){const Z=ZONES[z];return [Z.x+Z.w/2,Z.y];}
  function curve(a,b){const dy=Math.max(40,Math.abs(b[1]-a[1])/2);return `M${a[0]},${a[1]} C ${a[0]},${a[1]+(b[1]>a[1]?dy:-dy)} ${b[0]},${b[1]-(b[1]>a[1]?dy:-dy)} ${b[0]},${b[1]}`;}
  EDGES.forEach(e=>{
    const s=pos[e.from]; if(!s) return;
    let a,b;
    if(e.to && pos[e.to]){const t=pos[e.to]; a=anchorNode(e.from,t); b=anchorNode(e.to,s);}
    else if(e.toZone && ZONES[e.toZone]){b=zoneAnchor(e.toZone); a=anchorNode(e.from,b);}
    else return;
    const p=el('path',{d:curve(a,b),class:'cz-edge '+e.kind,'data-n':e.from,'data-t':e.to||('z_'+e.toZone)},eg);
    if(e.kind==='data') p.setAttribute('marker-end','url(#arr)');
  });
  DATA.forEach(d=>{
    const [x,y]=pos[d.id];
    const g=el('g',{class:'cz-node','data-id':d.id,transform:`translate(${x},${y})`},svg);
    const stroke = d.risk?`var(${RISK[d.risk][0]})`:'var(--baseline)';
    const dash = (d.status==='confirme')?'none':'4 3';
    const r=el('rect',{width:NW,height:NH,rx:7,stroke:stroke,'stroke-dasharray':dash},g);
    if(d.risk) r.setAttribute('stroke-width','1.8');
    if(d.status==='attente'){g.setAttribute('opacity','0.62');}
    const nm=el('text',{x:9,y:17,class:'cz-nm'},g);
    nm.textContent=(d.risk?RISK[d.risk][1]+' ':'')+d.name;
    const dp=el('text',{x:9,y:29,class:'cz-dp'},g); dp.textContent=d.short||d.dept;
    d.ent.forEach((en,i)=>{ el('circle',{cx:12+i*11,cy:38,r:3.4,fill:`var(${E[en]})`},g); });
    if(d.impact==='Y'){const im=el('text',{x:NW-9,y:40,'text-anchor':'end',style:'font-size:8.5px;fill:var(--ink-muted)'},g); im.textContent='OPS';}
    if(d.contract){const cc=el('text',{x:NW-7,y:15,'text-anchor':'end',style:'font-size:9.5px;font-weight:700;fill:'+(d.contract==='ok'?'var(--st-good)':(d.contract==='none'?'var(--st-critical)':'var(--ink-muted)'))},g);cc.textContent=d.contract==='ok'?'✓':(d.contract==='none'?'✕':'?');}
    g.addEventListener('click',ev=>{ev.stopPropagation();select(d.id);});
    g.addEventListener('mouseenter',()=>{svg.querySelectorAll(`.cz-edge[data-n="${d.id}"],.edge[data-t="${d.id}"]`).forEach(p=>p.classList.add('hi'));});
    g.addEventListener('mouseleave',()=>{svg.querySelectorAll('.cz-edge.hi').forEach(p=>p.classList.remove('hi'));});
    const tt=el('title',{},g); tt.textContent=`${d.name} — ${d.purpose}`;
  });
  applyFilters();
}

function matches(d){
  if(view==='AJD' && !d.ent.includes('AJD')) return false;
  if(view==='ASJASF' && !d.ent.includes('ASJ') && !d.ent.includes('ASF')) return false;
  if(impactOnly && d.impact!=='Y') return false;
  return true;
}
function applyFilters(){
  DATA.forEach(d=>{
    const g=svg.querySelector(`.cz-node[data-id="${d.id}"]`);
    if(!g) return;
    g.classList.toggle('dim',!matches(d));
    g.classList.toggle('sel',selected===d.id);
  });
  svg.querySelectorAll('.cz-edge').forEach(p=>{
    const s=DATA.find(x=>x.id===p.dataset.n);
    const t=p.dataset.t&&!p.dataset.t.startsWith('z_')?DATA.find(x=>x.id===p.dataset.t):null;
    p.classList.toggle('dimmed', (s&&!matches(s)) || (t&&!matches(t)));
  });
  renderTable(); renderTiles();
}

/* ===================== PANEL ===================== */
function showPanel(d){
  const panel=document.getElementById('panel');
  const stMap={confirme:'Confirmed',a_confirmer:'To be confirmed',scope:'Scope TBD',attente:'Awaiting reply'};
  const respMap={own:'Entity (own contract)',grp:'Clair Group / other entity',auth:'Authority / State'};
  panel.innerHTML=`<button class="cz-close" aria-label="Close">✕</button>
    <h3>${d.risk?RISK[d.risk][1]+' ':''}${d.name}</h3>
    <div>${d.ent.map(en=>`<span class="cz-chip"><span class="cz-dot" style="background:var(${E[en]});margin-right:4px"></span>${en}</span>`).join('')}
    <span class="cz-chip">${stMap[d.status]}</span>${d.impact==='Y'?'<span class="cz-chip">Operational impact</span>':''}</div>
    <dl>
      <dt>Purpose</dt><dd>${d.purpose}</dd>
      <dt>Department</dt><dd>${d.dept}</dd>
      ${d.resp?`<dt>Responsibility / contract</dt><dd>${respMap[d.resp]}${d.contract==='tbc'?' — <strong>holder / IS clauses to be confirmed</strong>':''}</dd>`:''}
      <dt>Data</dt><dd>${d.dataT}</dd>
      <dt>Hosting · Provider</dt><dd>${d.hosting} · ${d.provider}</dd>
      ${d.risk?`<dt>Attention level</dt><dd style="color:var(${RISK[d.risk][0]});font-weight:600">${RISK[d.risk][2]}</dd>`:''}
      ${d.notes.length?`<dt>Observations</dt><dd>${d.notes.map(n=>`<div class="cz-risk-line"><span class="cz-risk-ic">–</span><span>${n}</span></div>`).join('')}</dd>`:''}
      <dt>Source</dt><dd>${d.src}</dd>
    </dl>${d.link?`<p style="margin-top:12px"><a href="${d.link}" style="color:var(--ajd);text-decoration:underline">Open in the systems register</a></p>`:''}`;
  panel.classList.add('open');
  panel.querySelector('.close').addEventListener('click',()=>{panel.classList.remove('open');selected=null;applyFilters();});
}
function select(id){
  selected=(selected===id)?null:id;
  const panel=document.getElementById('panel');
  if(!selected){panel.classList.remove('open');applyFilters();return;}
  showPanel(DATA.find(x=>x.id===id));
  applyFilters();
}
svg.addEventListener('click',()=>{if(selected)select(selected);});
nebsvg.addEventListener('click',()=>{document.getElementById('panel').classList.remove('open');});

/* ===================== TILES & TABLE ===================== */
function renderTiles(){
  let t;
  if(mode==='neb'){
    const sys=nebSystems(nebEnt);
    t=[
      [sys.length,'systems — '+(nebEnt==='AJD'?'PRO-IS-01 AJD':'PRO-IS-01 ASJ+ASF')],
      [sys.filter(d=>d.risk==='critical').length,'critical'],
      [sys.filter(d=>d.resp==='grp').length,'under Group / other responsibility'],
      [sys.filter(d=>d.contract==='tbc').length,'contracts / holders to be confirmed'],
    ];
  } else {
    const inView=DATA.filter(d=>d.zone!=='pending'&&matches(d));
    t=[
      [inView.length,'systems listed'+(view==='AJD'?' — PRO-IS-01 AJD':(view==='ASJASF'?' — PRO-IS-01 ASJ+ASF':''))],
      [inView.filter(d=>d.risk==='critical').length,'critical systems'],
      [inView.filter(d=>d.status!=='confirme').length,'status or scope undetermined'],
      [DATA.filter(d=>d.zone==='pending').length,'departments without reply (follow-up needed)'],
    ];
  }
  document.getElementById('tiles').innerHTML=t.map(([v,l])=>`<div class="cz-tile"><div class="cz-v">${v}</div><div class="cz-l">${l}</div></div>`).join('');
}

function renderTable(){
  const stMap={confirme:'Confirmed',a_confirmer:'To be confirmed',scope:'Scope TBD',attente:'Awaiting reply'};
  const zMap={g_compta:'Group · Accounting',g_hr:'Group · HR',g_it:'Group · IT',g_mkt:'Group · Marketing',g_own:'Group · Mkt/Owner',g_gen:'Group · Generic',trans:'Transverse',fo:'Flight Ops',camo:'Group CAMO (AJD)',go:'Ground Ops',training:'Training',caa:'CAA/EASA',asf:'ASF (ATO)',pending:'Awaiting reply'};
  const respMap={own:'Entity',grp:'Group/other',auth:'Authority/State'};
  const rows=DATA.map(d=>`<tr class="${matches(d)?'':'dimrow'}">
    <td><strong>${d.risk?RISK[d.risk][1]+' ':''}${d.name}</strong><div class="cz-sub2">${d.provider}</div></td>
    <td>${zMap[d.zone]}</td>
    <td>${d.ent.map(en=>`<span class="cz-dot" style="background:var(${E[en]});margin-right:3px" title="${en}"></span>`).join('')}<span class="cz-sub2">${d.ent.join(', ')}</span></td>
    <td>${d.purpose}<div class="cz-sub2">${d.dataT}</div></td>
    <td>${d.impact}</td>
    <td>${d.resp?respMap[d.resp]+(d.contract==='tbc'?' <span class="cz-sub2">(TBC)</span>':''):'—'}</td>
    <td>${stMap[d.status]}</td>
    <td>${d.risk?`<span style="color:var(${RISK[d.risk][0]});font-weight:600">${RISK[d.risk][2]}</span>`:'—'}${d.notes.length?`<div class="cz-sub2">${d.notes[0]}</div>`:''}</td>
    <td class="cz-sub2">${d.src}</td></tr>`).join('');
  document.getElementById('tbl').innerHTML=`<thead><tr><th>System</th><th>Zone / department</th><th>Entities</th>
    <th>Purpose · data</th><th>Ops</th><th>Responsibility</th><th>Status</th><th>Attention</th><th>Source</th></tr></thead><tbody>${rows}</tbody>`;
}

/* ===================== NAVIGATION ===================== */
function setMode(m){
  mode=m;
  const r=document.getElementById('carto-root');
  r.classList.remove('m-neb','m-map','m-tbl');
  r.classList.add('m-'+m);
  document.querySelectorAll('button.flt[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));
  document.getElementById('panel').classList.remove('open'); selected=null;
  if(m==='neb') drawNebula(); else applyFilters();
}
function setView(v){
  view=v;
  document.querySelectorAll('button.flt[data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  applyFilters();
}
document.querySelectorAll('button.flt[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
document.querySelectorAll('button.flt[data-neb]').forEach(b=>b.addEventListener('click',()=>{
  nebEnt=b.dataset.neb;
  document.querySelectorAll('button.flt[data-neb]').forEach(x=>x.classList.toggle('on',x===b));
  drawNebula();
}));
document.querySelectorAll('button.flt[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
document.getElementById('impactBtn').addEventListener('click',e=>{impactOnly=!impactOnly;e.target.classList.toggle('on',impactOnly);applyFilters();});

layout();
document.querySelectorAll('button.flt[data-neb]').forEach(x=>x.classList.toggle('on',x.dataset.neb===nebEnt));
document.querySelectorAll('button.flt[data-view]').forEach(x=>x.classList.toggle('on',x.dataset.view===view));
setMode(mode);

})();
