/* Family Board family board. Static front end; data lives in a Google Sheet via Apps Script, or in this device's storage in demo mode. */
(function(){
"use strict";
const CFG = window.FAMILY_BOARD_CONFIG || {};
const TYPES = ["events","shopping","todos","meals","trips","notes"];
const CATS = ["Meat & fish","Fruit & veg","Dairy & eggs","Bakery","Store cupboard","Herbs & spices","Frozen","Drinks","Household","Toiletries","Other"];
const CAT_WORDS = {
  "Meat & fish":["chicken","beef","lamb","pork","mince","steak","bacon","sausage","fish","salmon","cod","prawn","ham","turkey"],
  "Fruit & veg":["potato","onion","garlic","ginger","tomato","cucumber","spinach","cauliflower","chilli","coriander","mint","lettuce","carrot","apple","banana","lemon","lime","pepper","broccoli","mushroom","fruit","veg","berries","grape","orange","avocado","pomegranate"],
  "Dairy & eggs":["milk","yoghurt","yogurt","cheese","butter","cream","egg","ghee","paneer"],
  "Bakery":["bread","naan","roll","wrap","bagel","croissant","cake"],
  "Herbs & spices":["cumin","turmeric","garam","masala","paprika","cardamom","clove","cinnamon","spice","fenugreek","methi","mustard seed","salt","pepper corn","star anise","asafoetida","hing"],
  "Store cupboard":["rice","pasta","flour","oil","sugar","tin","beans","lentil","stock","sauce","vinegar","purée","puree","cereal","tea","coffee","honey","jam"],
  "Frozen":["frozen","ice cream","peas"],
  "Drinks":["juice","squash","beer","wine","water","cola","lemonade"],
  "Household":["washing","bin bag","foil","cling","kitchen roll","cleaner","bleach","sponge","dishwasher","detergent","battery","bulb"],
  "Toiletries":["shampoo","toothpaste","soap","deodorant","tissues","toilet roll","razor","conditioner"]
};
const $ = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const pad = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayStr = () => ymd(new Date());
/* repeating chores */
const DAYS = ["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"];
const REPEATS = ["","Every day","Weekdays","Weekends",...DAYS.slice(1),DAYS[0]];
function repeatsOn(rep, d){ const w=d.getDay(); if(rep==="Every day") return true; if(rep==="Weekdays") return w>0&&w<6; if(rep==="Weekends") return w===0||w===6; return DAYS.indexOf(rep)===w; }
function nextRepeat(rep){ const d=new Date(); for(let i=0;i<8;i++){ if(repeatsOn(rep,d)) return d; d.setDate(d.getDate()+1); } return null; }
function todoDone(x){ return x.repeat ? String(x.doneOn||"")===todayStr() : !!x.done; }
function todoHistory(x){ return String(x.history||"").split(",").filter(Boolean); }
// Days in the last 14 (not today) when a repeating chore was due but not ticked. Counts from the day after it was created.
function missedDates(x){
  if(!x.repeat) return [];
  const hist=new Set(todoHistory(x)); const out=[]; const t=todayStr();
  const start=new Date(); start.setDate(start.getDate()-14);
  if(x.createdAt){ const c=new Date(x.createdAt); c.setDate(c.getDate()+1); c.setHours(0,0,0,0); if(c>start) start.setTime(c.getTime()); }
  const d=new Date(start); d.setHours(12,0,0,0);
  while(ymd(d)<t){ if(repeatsOn(x.repeat,d) && !hist.has(ymd(d))) out.push(ymd(d)); d.setDate(d.getDate()+1); }
  return out;
}
function todoDueToday(x){ return !x.repeat || repeatsOn(x.repeat, new Date()); }
const parseYmd = s => { const [y,m,d]=String(s).split("-").map(Number); return new Date(y,(m||1)-1,d||1); };
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const fmtTime = t => { if(!t) return ""; const [h,m]=t.split(":").map(Number); const ap=h>=12?"pm":"am"; const hh=((h+11)%12)+1; return hh+(m?":"+pad(m):"")+ap; };
const fmtDate = s => { if(!s) return ""; const d=parseYmd(s); return DOW[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?" "+d.getFullYear():""); };

/* ---------- device prefs ---------- */
const PREF_KEY="sl_prefs", DATA_KEY="sl_demo_data", CACHE_KEY="sl_cache";
let prefs = Object.assign({apiUrl:"", pin:"", me:"", kiosk:false, todoFilter:"All"}, JSON.parse(localStorage.getItem(PREF_KEY)||"{}"));
const savePrefs = ()=>localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
const qs = new URLSearchParams(location.search);
if(qs.has("kiosk")) { prefs.kiosk = qs.get("kiosk")!=="0"; savePrefs(); }
const apiUrl = () => (prefs.apiUrl || CFG.apiUrl || "").trim();
const live = () => !!apiUrl();

/* ---------- state ---------- */
let data = {settings:{}, events:[], shopping:[], todos:[], meals:[], trips:[], notes:[]};
let calCursor = new Date(); calCursor.setDate(1);
let selDay = todayStr();
let lastSync = null, busy = false;

function realMembers(){
  let m=(data.settings&&data.settings.members)||[];
  if(!(Array.isArray(m)&&m.length)){ try{ const c=JSON.parse(localStorage.getItem(CACHE_KEY)||"null"); m=normalise(c||{}).settings.members||[]; }catch(e){ m=[]; } }
  return Array.isArray(m)?m:[];
}
function members(){ const m=realMembers(); return m.length?m:(live()?[]:["Person 1","Person 2","Person 3"]); }
function memberColour(name){ const i=members().indexOf(name); return ["var(--p1)","var(--p2)","var(--p3)"][i] || "var(--p0)"; }
function chip(name){ return name?`<span class="chip" style="background:${memberColour(name)}">${esc(name)}</span>`:""; }

/* ---------- storage backends ---------- */
function normalise(d){
  const out = {settings:Object.assign({}, d.settings||{})};
  TYPES.forEach(t=>{ out[t] = Array.isArray(d[t])? d[t].map(x=>Object.assign({},x)) : []; });
  out.meals.forEach(m=>{ if(typeof m.recipes==="string"){ try{ m.recipes=JSON.parse(m.recipes||"[]"); }catch(e){ m.recipes=[]; } } if(!Array.isArray(m.recipes)) m.recipes=[]; });
  ["shopping","todos"].forEach(t=>out[t].forEach(x=>x.done = x.done===true||x.done==="TRUE"||x.done==="true"));
  out.notes.forEach(x=>x.pinned = x.pinned===true||x.pinned==="TRUE"||x.pinned==="true");
  if(typeof out.settings.members==="string"){ out.settings.members = out.settings.members.split(",").map(s=>s.trim()).filter(Boolean); }
  return out;
}
const Local = {
  load(){ const raw=localStorage.getItem(DATA_KEY); data = normalise(raw?JSON.parse(raw):window.FAMILY_BOARD_DEMO()); this.save(); },
  save(){ localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
};
async function api(action, payload){
  const url = apiUrl();
  if(action==="all"){
    const r = await fetch(url+(url.includes("?")?"&":"?")+"action=all&pin="+encodeURIComponent(prefs.pin)+"&t="+Date.now(), {method:"GET", redirect:"follow"});
    return r.json();
  }
  const r = await fetch(url, {method:"POST", redirect:"follow", headers:{"Content-Type":"text/plain;charset=utf-8"},
    body: JSON.stringify(Object.assign({action, pin:prefs.pin, by:prefs.me}, payload||{}))});
  return r.json();
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function paintCache(){
  if(lastSync) return;
  try{ const c=localStorage.getItem(CACHE_KEY); if(c){ data=normalise(JSON.parse(c)); render(); } }catch(e){}
}
let loadQueued=false;
async function load(){
  if(!live()){ Local.load(); setBanner("Demo mode: changes are saved on this device only. Open ⚙︎ Settings to connect the family Google Sheet."); render(); return; }
  if(!prefs.pin){ showPin(); return; }
  if(busy){ loadQueued=true; return; }
  busy=true; loadQueued=false;
  paintCache();
  const waits=[1000,3000,6000];
  let err=null, ok=false;
  try{
    for(let i=0; i<=waits.length && !ok; i++){
      if(i) await sleep(waits[i-1]);
      try{
        const res = await api("all");
        if(!res.ok){ if(res.error==="bad_pin"||res.error==="locked"){ prefs.pin=""; savePrefs(); showPin(res.error==="locked"?"Too many wrong tries. Wait 10 minutes and try again.":"That PIN didn't work."); return; } throw new Error(res.error||"Error"); }
        data = normalise(res.data); lastSync = new Date();
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        setBanner(res.warning?("Note: "+res.warning):"");
        ok=true; err=null;
      }catch(e){ err=e; }
    }
    if(!ok){
      try{ const c=localStorage.getItem(CACHE_KEY); if(c && !lastSync) data=normalise(JSON.parse(c)); }catch(e){}
      setBanner("Can't reach the family sheet just now, so this is the last saved copy. It should catch up on its own, or you can tap refresh.", true);
    }
  }finally{
    busy=false;
    render();
    if(live() && lastSync && !prefs.me && realMembers().length && !modalKind) askWho();
    if(loadQueued && prefs.pin){ loadQueued=false; load(); }
  }
}
function askWho(){
  showModal(`<h2>Who's using this device?</h2><div class="who" id="askWho">${realMembers().map(n=>`<button class="btn" data-who="${esc(n)}" style="margin:4px">${esc(n)}</button>`).join("")}</div>
  <div class="sub">You can change this later in ⚙︎ Settings.</div>`, "who");
  $$("#askWho button").forEach(b=>b.onclick=()=>{ prefs.me=b.dataset.who; savePrefs(); hideModal(); render(); toast("Hi "+prefs.me); });
}

async function op(action, type, item, id, extra){
  // optimistic local change
  const list = data[type];
  if(action==="add"){ item.id = item.id||uid(); item.by = item.by||prefs.me||""; item.createdAt=new Date().toISOString(); list.push(item); }
  else { const i=list.findIndex(x=>String(x.id)===String(id)); if(i<0) return;
    if(action==="delete"){
      if(type==="events" && extra && extra.scope==="all" && list[i].recurring){ const base=seriesKey(list[i].id); for(let k=list.length-1;k>=0;k--) if(seriesKey(list[k].id)===base) list.splice(k,1); }
      else list.splice(i,1);
    }
    else if(action==="toggle"){
      if(type==="todos" && list[i].repeat){ const was=todoDone(list[i]), t=todayStr(); const h=todoHistory(list[i]).filter(x=>x!==t); if(!was) h.push(t);
        list[i].history=h.sort().join(","); list[i].doneOn = was ? "" : t; list[i].done = todoDone(list[i]); }
      else { const k = type==="notes"?"pinned":"done"; list[i][k]=!list[i][k]; }
    }
    else if(action==="update") Object.assign(list[i], item);
  }
  render();
  if(!live()){ Local.save(); return; }
  try{
    const res = await api(action, Object.assign({type, item, id}, extra||{}));
    if(!res.ok) throw new Error(res.error||"Save failed");
    if(res.warning){ toast(res.warning, 6000); load(); return; }
    if(action==="add" && res.item){ const k=list.findIndex(x=>x.id===item.id); if(k>=0) list[k]=normalise({[type]:[res.item]})[type][0]; }
    toast("Saved");
  }catch(e){ toast("Couldn't save: "+e.message); }
  load();
}

/* ---------- render ---------- */
function setBanner(msg, err){ const b=$("#banner"); if(!msg){ b.classList.add("hidden"); return; } b.innerHTML=msg; b.classList.toggle("err",!!err); b.classList.remove("hidden"); }
function toast(msg, ms){ const t=document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(), ms||2200); }
const seriesKey = id => String(id).replace(/[#@]\d{10,}$/,"");
/* Touch-friendly choice sheet. Resolves with the chosen value, or null if cancelled. */
function ask(title, text, choices){
  return new Promise(resolve=>{
    showModal(`<h2>${esc(title)}</h2>${text?`<p class="sub" style="font-size:.95rem">${esc(text)}</p>`:""}<div class="choices">${choices.map((c,i)=>`<button class="btn ${c.ghost?"ghost":""} ${c.danger?"danger":""}" data-choice="${i}">${esc(c.label)}</button>`).join("")}<button class="btn ghost" data-choice="-1">Cancel</button></div>`);
    $$("#sheet [data-choice]").forEach(b=>b.onclick=ev=>{ ev.stopPropagation(); const i=Number(b.dataset.choice); hideModal(); resolve(i<0?null:choices[i].value); });
  });
}
async function deleteEvent(id, noConfirm){
  const e = data.events.find(x=>String(x.id)===String(id)); if(!e) return;
  let scope = "this";
  if(e.recurring){
    scope = await ask("Delete repeating event", "“"+e.title+"” repeats. Delete just this one, or every repeat?", [{label:"Just this one", value:"this", danger:true},{label:"All repeats", value:"all", danger:true}]);
    if(!scope){ backToDay(); return; }
  } else if(!noConfirm){
    const ok = await ask("Delete event?", "“"+e.title+"” on "+fmtDate(e.date)+(live()?" will be removed from the shared Google calendar for everyone.":"."), [{label:"Delete", value:"yes", danger:true}]);
    if(!ok){ backToDay(); return; }
  }
  op("delete","events",null,id,{scope});
}

function render(){
  const title = (data.settings&&data.settings.title)||"Family Board";
  $("#title").textContent = "🏡 "+title; document.title = title;
  document.body.classList.toggle("kiosk", !!prefs.kiosk);
  openRow = null;
  renderAgenda(); renderCalendar(); renderShopping(); renderTodos(); renderMeals(); renderTrips(); renderNotes();
  if(modalDay && (modalKind==="day" || modalKind==="")) renderDaySheet();
  $("#foot").textContent = (live()? "Connected to the family sheet" + (lastSync?" · updated "+lastSync.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"") : "Demo mode") + (prefs.me?" · you are "+prefs.me:"");
}

function eventsSorted(){ return data.events.slice().sort((a,b)=>(a.date+(a.time||"00:00")).localeCompare(b.date+(b.time||"00:00"))); }
function eventLine(e){
  const when = e.time ? fmtTime(e.time)+(e.end?"–"+fmtTime(e.end):"") : (e.endDate&&e.endDate!==e.date?"Until "+fmtDate(e.endDate):"All day");
  return `<div class="grow"><div><b>${esc(e.title)}</b>${e.recurring?` <span class="sub" title="Repeats">🔁</span>`:""}</div><div class="sub">${esc(when)}${e.location?" · "+esc(e.location):""}</div>${e.notes?`<div class="sub">${esc(e.notes)}</div>`:""}</div>`;
}
/* A swipeable row: swipe right (touch or mouse drag) to reveal a red Delete button. */
const swRow = (type, id, inner, cls, editable) => `<li class="sw ${cls||""}" data-sw-type="${type}" data-sw-id="${esc(id)}"><button class="swdel" data-swdel="${type}" data-id="${esc(id)}" tabindex="-1">Delete</button><div class="swc"${editable===false?"":` data-edit="${type}" data-id="${esc(id)}"`}>${inner}</div></li>`;
function eventsOn(k){
  return data.events.filter(e=>e.date<=k && (e.endDate||e.date)>=k).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
}
function renderAgenda(){
  const t = todayStr();
  const up = eventsSorted().filter(e=>(e.endDate||e.date)>=t).slice(0,12);
  const trips = data.trips.filter(x=>x.status!=="Done");
  let h = up.map(e=>{ const d=parseYmd(e.date);
    return swRow("events", e.id, `<div class="datebox"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b><small>${MON[d.getMonth()]}</small></div>${eventLine(e)}`, e.date===t?"today":""); }).join("");
  h += trips.map(x=>swRow("trips", x.id, `<div class="datebox"><small>Trip</small><b>✈️</b><small>&nbsp;</small></div><div class="grow"><b>${esc(x.name)}</b><div class="sub">${esc(x.when)}${x.details?" · "+esc(x.details):""}</div></div>`)).join("");
  $("#agenda").innerHTML = h || `<li class="empty">Nothing coming up.</li>`;
  $("#cnt-agenda").textContent = up.length||"";
}
function renderCalendar(){
  const y=calCursor.getFullYear(), m=calCursor.getMonth();
  $("#calTitle").textContent = MONTHS[m]+" "+y;
  const first = new Date(y,m,1); const offset=(first.getDay()+6)%7; // Monday first
  const start = new Date(y,m,1-offset);
  const byDay = {};
  data.events.forEach(e=>{ let d=parseYmd(e.date); const end=parseYmd(e.endDate||e.date); let n=0; while(d<=end && n<62){ (byDay[ymd(d)]=byDay[ymd(d)]||[]).push(e); d.setDate(d.getDate()+1); n++; } });
  let h = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="dow">${d}</div>`).join("");
  const t=todayStr();
  for(let i=0;i<42;i++){ const d=new Date(start); d.setDate(start.getDate()+i); const k=ymd(d); const ev=byDay[k]||[];
    if(i>=35 && d.getMonth()!==m) break;
    h += `<div class="day ${d.getMonth()!==m?"other":""} ${k===t?"is-today":""} ${k===selDay?"sel":""}" data-day="${k}" role="button" aria-label="${esc(fmtDate(k))}"><div class="n">${d.getDate()}</div><div class="dots">${ev.slice(0,4).map(()=>"<i></i>").join("")}</div>${ev.slice(0,3).map(e=>`<div class="lbl">${e.time?fmtTime(e.time)+" ":""}${esc(e.title)}</div>`).join("")}${ev.length>3?`<div class="lbl">+${ev.length-3} more</div>`:""}</div>`;
  }
  $("#calGrid").innerHTML = h;
  const sel = eventsOn(selDay);
  $("#dayEvents").innerHTML = `<div class="cat">${esc(fmtDate(selDay))}</div><ul class="list">${sel.map(e=>swRow("events", e.id, eventLine(e))).join("")||'<li class="empty">Nothing on this day.</li>'}</ul><div class="row" style="margin-top:6px"><button class="btn ghost small" data-addday="${selDay}">+ Add event on this day</button></div>`;
}
function renderShopping(){
  const groups = {};
  data.shopping.forEach(s=>{ const c=CATS.includes(s.category)?s.category:"Other"; (groups[c]=groups[c]||[]).push(s); });
  let h="";
  CATS.forEach(c=>{ const g=groups[c]; if(!g) return; g.sort((a,b)=>(a.done-b.done)||String(a.item).localeCompare(String(b.item)));
    h+=`<div class="cat">${esc(c)}</div><ul class="list">`+g.map(s=>swRow("shopping", s.id, `<button class="tick ${s.done?"on":""}" data-toggle="shopping" data-id="${esc(s.id)}" aria-label="Tick">${s.done?"✓":""}</button><div class="grow" data-edit="shopping" data-id="${esc(s.id)}">${esc(s.item)}${s.qty?` <span class="sub">· ${esc(s.qty)}</span>`:""}${s.note?`<div class="sub">${esc(s.note)}</div>`:""}</div>${s.by?chip(s.by):""}`, s.done?"done":"", false)).join("")+`</ul>`; });
  $("#shopping").innerHTML = h || `<div class="empty">The list is empty.</div>`;
  $("#cnt-shopping").textContent = data.shopping.filter(s=>!s.done).length||"";
}
function renderTodos(){
  const f = prefs.todoFilter||"All";
  data.todos.forEach(x=>x.done=todoDone(x));
  const missedN = data.todos.filter(x=>missedDates(x).length).length;
  $("#todoFilters").innerHTML = ["All",...members(),"Done","Missed"].map(x=>`<button class="${x===f?"on":""}${x==="Missed"&&missedN?" warn":""}" data-filter="${esc(x)}">${esc(x)}${x==="Missed"&&missedN?" ("+missedN+")":""}</button>`).join("");
  if(f==="Missed"){
    const ml=data.todos.map(x=>({x,m:missedDates(x)})).filter(o=>o.m.length);
    $("#todos").innerHTML = ml.map(({x,m})=>swRow("todos", x.id, `<button class="tick" data-caughtup="${esc(x.id)}" aria-label="Mark as caught up" title="Mark as caught up"></button><div class="grow" data-edit="todos" data-id="${esc(x.id)}">${esc(x.task)}<div class="sub missed">⚠️ Missed ${m.map(d=>esc(fmtDate(d))).join(", ")}</div></div>${chip(x.assignee)}`, "", false)).join("") || `<li class="empty">Nothing missed. 🎉</li>`;
    $("#cnt-todos").textContent = data.todos.filter(x=>!x.done&&todoDueToday(x)).length||"";
    return;
  }
  let list = data.todos.slice();
  if(f==="Done") list=list.filter(x=>x.done); else { list=list.filter(x=>!x.done); if(f!=="All") list=list.filter(x=>x.assignee===f||x.assignee==="Everyone"); }
  const key=x=> (todoDueToday(x)?"0":"1") + (x.repeat? (x.repeat==="Every day"||!x.due?"0000":"") : (x.due||"9999"));
  list.sort((a,b)=>key(a).localeCompare(key(b)));
  const t=todayStr();
  const sub=x=>{
    if(x.repeat){ const today=todoDueToday(x); const n=today?null:nextRepeat(x.repeat);
      return "🔁 "+esc(x.repeat)+(x.done?" · done today":today?" · today":n?" · next "+esc(fmtDate(ymd(n))):""); }
    return x.due?(x.due<t&&!x.done?"⚠️ Overdue · ":"")+"Due "+esc(fmtDate(x.due)):"No due date";
  };
  $("#todos").innerHTML = list.map(x=>swRow("todos", x.id, `<button class="tick ${x.done?"on":""}" data-toggle="todos" data-id="${esc(x.id)}">${x.done?"✓":""}</button><div class="grow" data-edit="todos" data-id="${esc(x.id)}">${esc(x.task)}<div class="sub">${sub(x)}</div></div>${chip(x.assignee)}`, (x.done?"done":"")+(!x.done&&!todoDueToday(x)?" later":""), false)).join("") || `<li class="empty">${f==="Done"?"Nothing done yet.":"All clear!"}</li>`;
  $("#cnt-todos").textContent = data.todos.filter(x=>!x.done&&todoDueToday(x)).length||"";
}
function renderMeals(){
  const t=todayStr();
  const list = data.meals.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const upcoming = list.filter(m=>!m.date||m.date>=t), past=list.filter(m=>m.date&&m.date<t).reverse().slice(0,3);
  const one = m => `<div class="meal"><div class="row"><h3 class="grow" data-edit="meals" data-id="${esc(m.id)}">${esc(m.title)}</h3><button class="x" data-del="meals" data-id="${esc(m.id)}">×</button></div>
    <div class="sub">${m.date?esc(fmtDate(m.date)):"Any day"}${m.serves?" · serves "+esc(m.serves):""}</div>${m.notes?`<div style="margin:4px 0">${esc(m.notes)}</div>`:""}
    ${m.recipes.map(r=>`<details class="recipe"><summary>${esc(r.name)}</summary>${r.by?`<div class="sub">${esc(r.by)}${r.serves?" · recipe serves "+esc(r.serves):""}</div>`:""}${r.ingredients&&r.ingredients.length?`<ul>${r.ingredients.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>`:""}${r.note?`<div class="sub">${esc(r.note)}</div>`:""}${r.url?`<p><a href="${esc(r.url)}" target="_blank" rel="noopener">Open the full recipe ↗</a></p>`:""}</details>`).join("")}
    ${m.recipes.some(r=>r.ingredients&&r.ingredients.length)?`<button class="btn ghost small" data-mealshop="${esc(m.id)}">🛒 Add ingredients to shopping</button>`:""}</div>`;
  $("#meals").innerHTML = (upcoming.map(one).join("") || `<div class="empty">No meals planned.</div>`) + (past.length?`<div class="cat">Recent</div>`+past.map(one).join(""):"");
  $("#cnt-meals").textContent = upcoming.length||"";
}
function renderTrips(){
  $("#trips").innerHTML = data.trips.map(x=>swRow("trips", x.id, `<div class="grow"><b>${esc(x.name)}</b> <span class="sub">${esc(x.status||"")}</span><div class="sub">${esc(x.when)}</div>${x.details?`<div>${esc(x.details)}</div>`:""}</div>`)).join("") || `<li class="empty">No trips yet.</li>`;
  $("#cnt-trips").textContent = data.trips.length||"";
}
function renderNotes(){
  const list = data.notes.slice().sort((a,b)=>(b.pinned-a.pinned)||String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  $("#notes").innerHTML = list.length ? `<ul class="list notes">`+list.map(n=>swRow("notes", n.id, `<div class="grow" data-edit="notes" data-id="${esc(n.id)}">${esc(n.text)}<div class="meta">${n.by?esc(n.by)+" · ":""}${n.createdAt?new Date(n.createdAt).toLocaleString("en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</div></div><button class="x" data-toggle="notes" data-id="${esc(n.id)}" title="Pin">${n.pinned?"📌":"📍"}</button>`, "note"+(n.pinned?" pinned":""), false)).join("")+`</ul>` : `<div class="empty">No messages.</div>`;
  $("#cnt-notes").textContent = data.notes.length||"";
}

/* ---------- day sheet (tap a date on the calendar) ---------- */
let modalDay = null;
function openDaySheet(k){ selDay=k; modalDay=k; renderCalendar(); renderDaySheet(); }
function renderDaySheet(){
  const k = modalDay; if(!k) return;
  const d = parseYmd(k);
  const list = eventsOn(k);
  showModal(`<h2>${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}</h2>
    <button class="btn big" data-addday="${k}">＋ Add event</button>
    <ul class="list dayList" style="margin-top:10px">${list.map(e=>swRow("events", e.id, eventLine(e))).join("") || '<li class="empty">Nothing on this day yet.</li>'}</ul>
    ${list.length?'<div class="hint">Tap an event to change it. Swipe right to delete it.</div>':""}
    <div class="actions"><button class="btn ghost" id="dayClose">Close</button></div>`, "day");
  $("#dayClose").onclick = ()=>hideModal(true);
}
function backToDay(){ if(modalDay) renderDaySheet(); }

/* ---------- swipe right to delete ---------- */
const SW_W = 96;
let sw = null, openRow = null, suppressClick = false;
function closeOpenRow(){ if(openRow){ openRow.classList.remove("open"); openRow = null; } }
function swipeDelete(type, id){
  closeOpenRow();
  if(type==="events"){ deleteEvent(id, true); return; } // repeating events still ask "Just this one" / "All repeats"
  op("delete", type, null, id);
}
function bindSwipe(){
  document.addEventListener("pointerdown", e=>{
    suppressClick = false;
    if(e.button > 0) return;
    if(e.target.closest(".swdel")) return;
    if(openRow){ closeOpenRow(); suppressClick = true; return; } // a tap elsewhere just hides the Delete button
    const row = e.target.closest(".sw"); if(!row) return;
    if(e.target.closest("input,select,textarea,a")) return;
    sw = { row, x:e.clientX, y:e.clientY, id:e.pointerId, mode:null, dx:0 };
  });
  document.addEventListener("pointermove", e=>{
    if(!sw || e.pointerId!==sw.id) return;
    const dx = e.clientX-sw.x, dy = e.clientY-sw.y;
    if(!sw.mode){
      if(Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)*1.3){ sw.mode="h"; sw.row.classList.add("dragging"); try{ sw.row.setPointerCapture(e.pointerId); }catch(_){} }
      else if(Math.abs(dy) > 10 || dx < -10){ sw = null; return; }
      else return;
    }
    sw.dx = dx;
    sw.row.querySelector(".swc").style.transform = `translateX(${Math.max(0, Math.min(SW_W*1.3, dx))}px)`;
    e.preventDefault();
  }, {passive:false});
  const end = e=>{
    if(!sw || e.pointerId!==sw.id) return;
    const s = sw; sw = null;
    if(s.mode!=="h") return;
    suppressClick = true;
    s.row.classList.remove("dragging");
    s.row.querySelector(".swc").style.transform = "";
    if(s.dx > SW_W/2 && e.type!=="pointercancel"){ s.row.classList.add("open"); openRow = s.row; }
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  document.addEventListener("click", e=>{ if(suppressClick){ suppressClick=false; e.stopPropagation(); e.preventDefault(); } }, true);
}

/* ---------- forms ---------- */
const FORMS = {
  events: { title:"Event", fields:[["title","What","text"],["date","Date","date"],["time","Start time (blank = all day)","time"],["end","End time","time"],["location","Where","text"],["notes","Notes","textarea"]] },
  shopping: { title:"Shopping item", fields:[["item","Item","text"],["qty","Quantity","text"],["category","Aisle","select",CATS],["note","Note","text"]] },
  todos: { title:"To-do", fields:[["task","Task","text"],["assignee","Who","select",()=>["",...members(),"Everyone"]],["due","Due","date"],["repeat","Repeats","select",REPEATS]] },
  meals: { title:"Meal", fields:[["title","Meal","text"],["date","Date","date"],["serves","Serves","text"],["notes","Notes","textarea"],["recipesText","Recipes (one per line: name | link)","textarea"]] },
  trips: { title:"Trip", fields:[["name","Trip","text"],["when","When","text"],["status","Status","select",["Idea","Planning","Booked","Done"]],["details","Details","textarea"]] },
  notes: { title:"Message", fields:[["text","Message","textarea"]] }
};
function openForm(type, id, preset){
  const def = FORMS[type]; const item = id ? data[type].find(x=>String(x.id)===String(id)) : Object.assign({}, preset||{});
  if(!item) return;
  const v = Object.assign({}, item);
  if(type==="meals") v.recipesText = (item.recipes||[]).map(r=>r.name+(r.url?" | "+r.url:"")).join("\n");
  let h = `<h2>${id?"Edit":"Add"} ${def.title.toLowerCase()}</h2>`;
  if(type==="events" && live()) h += `<div class="sub">Saved straight to the shared Google calendar.${item.recurring?" 🔁 This event repeats; you'll be asked whether to change just this one or all repeats.":""}</div>`;
  def.fields.forEach(([k,label,kind,opts])=>{ const val=v[k]==null?"":v[k];
    h += `<label for="f_${k}">${esc(label)}</label>`;
    if(kind==="textarea") h+=`<textarea id="f_${k}">${esc(val)}</textarea>`;
    else if(kind==="select"){ const o=typeof opts==="function"?opts():opts; h+=`<select id="f_${k}">${o.map(x=>`<option ${x===val?"selected":""}>${esc(x)}</option>`).join("")}</select>`; }
    else h+=`<input id="f_${k}" type="${kind}" value="${esc(val)}">`;
  });
  h += `<div class="actions">${id?`<button class="btn ghost" id="fDel" style="margin-right:auto">Delete</button>`:""}<button class="btn ghost" id="fCancel">Cancel</button><button class="btn" id="fSave">Save</button></div>`;
  showModal(h);
  const first=$("#sheet input,#sheet textarea"); if(first && !id) first.focus();
  $("#fCancel").onclick = ()=>{ hideModal(); backToDay(); };
  if(id) $("#fDel").onclick = ()=>{ if(type==="events"){ hideModal(); deleteEvent(id); return; } if(confirm("Delete this?")){ hideModal(); op("delete",type,null,id); } };
  $("#fSave").onclick = ()=>{
    const out = {};
    def.fields.forEach(([k])=>{ out[k] = $("#f_"+k).value.trim(); });
    const main = def.fields[0][0]; if(!out[main]){ $("#f_"+main).focus(); return; }
    if(type==="events" && !out.date){ $("#f_date").focus(); return; }
    if(type==="shopping" && !id && out.category==="Other") out.category = guessCat(out.item);
    if(type==="meals"){ const old=item.recipes||[]; out.recipes = out.recipesText.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{ const [n,u]=l.split("|").map(s=>s.trim()); const prev=old.find(r=>r.name===n)||{}; return Object.assign({}, prev, {name:n, url:u||prev.url||""}); }); delete out.recipesText; }
    hideModal();
    if(id && type==="events" && item.recurring){
      ask("Change repeating event", "Change just this one, or every repeat? (For every repeat, the title, place and notes change; times for all repeats are changed in Google Calendar.)", [{label:"Just this one", value:"this"},{label:"All repeats", value:"all"}])
        .then(scope=>{ if(scope) op("update",type,out,id,{scope}); else backToDay(); });
      return;
    }
    if(id) op("update",type,out,id); else op("add",type,out);
  };
}
function guessCat(name){ const n=String(name).toLowerCase(); for(const c of Object.keys(CAT_WORDS)){ if(CAT_WORDS[c].some(w=>n.includes(w))) return c; } return "Other"; }
let modalKind = "";
function showModal(h, kind){ $("#sheet").innerHTML=h; $("#modal").classList.remove("hidden"); modalKind = kind||"other"; }
function hideModal(closeDay){ $("#modal").classList.add("hidden"); modalKind=""; if(closeDay) modalDay=null; }

/* ---------- settings ---------- */
function openSettings(){
  const h = `<h2>Settings</h2>
  <label>Who's using this device?</label><select id="sMe">${["",...members()].map(m=>`<option ${m===prefs.me?"selected":""}>${esc(m)}</option>`).join("")}</select>
  <label>Family sheet web app URL (from Apps Script)</label><input id="sUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(prefs.apiUrl)}">
  <div class="sub">${CFG.apiUrl?"A default URL is built in; leave blank to use it.":"Leave blank to stay in demo mode."}</div>
  <label>Family PIN</label><input id="sPin" type="password" inputmode="numeric" value="${esc(prefs.pin)}">
  <label><input type="checkbox" id="sKiosk" style="width:auto" ${prefs.kiosk?"checked":""}> Kitchen screen mode (bigger text, keeps the screen awake)</label>
  <label>Import data (JSON)</label><textarea id="sImport" placeholder='{"events":[…],"shopping":[…]}'></textarea>
  <div class="row" style="margin-top:6px"><input type="file" id="sFile" accept=".json,application/json" style="flex:1"><button class="btn ghost small" id="sDoImport">Import</button><button class="btn ghost small" id="sExport">Export</button></div>
  <div class="sub">${live()?"Import adds the items to the family sheet (events go into the Google calendar, skipping any already there).":"In demo mode, import replaces the sample data on this device."}</div>
  ${!live()?`<div class="row" style="margin-top:6px"><button class="btn ghost small" id="sReset">Reset demo data</button></div>`:""}
  <div class="actions"><button class="btn ghost" id="sCancel">Close</button><button class="btn" id="sSave">Save</button></div>`;
  showModal(h);
  $("#sCancel").onclick=hideModal;
  $("#sSave").onclick=()=>{ prefs.me=$("#sMe").value; prefs.apiUrl=$("#sUrl").value.trim(); prefs.pin=$("#sPin").value.trim(); prefs.kiosk=$("#sKiosk").checked; savePrefs(); hideModal(); lastSync=null; load(); setupKiosk(); };
  $("#sFile").onchange=async e=>{ const f=e.target.files[0]; if(f) $("#sImport").value = await f.text(); };
  $("#sExport").onclick=()=>{ const b=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="family-board-export.json"; a.click(); };
  if($("#sReset")) $("#sReset").onclick=()=>{ if(confirm("Reset to the sample data?")){ localStorage.removeItem(DATA_KEY); hideModal(); load(); } };
  $("#sDoImport").onclick=async ()=>{
    let obj; try{ obj=JSON.parse($("#sImport").value); }catch(e){ toast("That isn't valid JSON"); return; }
    if(!live()){ data = normalise(Object.assign({settings:data.settings}, obj)); Local.save(); hideModal(); render(); toast("Imported"); return; }
    try{ toast("Importing…"); const res=await api("import",{data:obj}); if(!res.ok) throw new Error(res.error); hideModal(); toast("Imported: "+JSON.stringify(res.counts)); load(); }catch(e){ toast("Import failed: "+e.message); }
  };
}

/* ---------- PIN ---------- */
function showPin(err){
  const s=$("#pinScreen"); s.classList.remove("hidden");
  const names = live()?realMembers():members();
  $("#pinWhoLabel").classList.toggle("hidden", !names.length); $("#pinWho").classList.toggle("hidden", !names.length);
  $("#pinWho").innerHTML = names.map(n=>`<button class="${n===prefs.me?"on":""}" data-who="${esc(n)}">${esc(n)}</button>`).join("");
  $$("#pinWho button").forEach(b=>b.onclick=()=>{ prefs.me=b.dataset.who; savePrefs(); $$("#pinWho button").forEach(x=>x.classList.toggle("on",x===b)); });
  const e=$("#pinErr"); if(err){ e.textContent=err; e.classList.remove("hidden"); } else e.classList.add("hidden");
  $("#pinInput").value=""; $("#pinInput").focus();
}
function submitPin(){ const p=$("#pinInput").value.trim(); if(!p) return; prefs.pin=p; savePrefs(); $("#pinScreen").classList.add("hidden"); load(); }

/* ---------- events ---------- */
function bind(){
  document.addEventListener("click", e=>{
    const cu = e.target.closest("[data-caughtup]");
    if(cu){ const x=data.todos.find(y=>String(y.id)===cu.dataset.caughtup); if(x && confirm("Mark the missed days for \""+x.task+"\" as caught up?")){ const h=new Set(todoHistory(x)); missedDates(x).forEach(d=>h.add(d)); op("update","todos",{history:[...h].sort().slice(-60).join(",")},x.id); } return; }
    const t = e.target.closest("[data-swdel],[data-toggle],[data-del],[data-edit],[data-quick],[data-day],[data-addday],[data-filter],[data-mealshop]");
    if(!t) { if(e.target.id==="modal") hideModal(true); return; }
    if(t.dataset.swdel){ swipeDelete(t.dataset.swdel, t.dataset.id); return; }
    if(t.dataset.toggle){ op("toggle", t.dataset.toggle, null, t.dataset.id); }
    else if(t.dataset.del){ if(t.dataset.del==="events") deleteEvent(t.dataset.id); else if(confirm("Remove this?")) op("delete", t.dataset.del, null, t.dataset.id); }
    else if(t.dataset.edit){ openForm(t.dataset.edit, t.dataset.id); }
    else if(t.dataset.quick){ const q=t.dataset.quick; const map={event:"events",shopping:"shopping",todo:"todos",meal:"meals",note:"notes",trip:"trips"};
      const preset = q==="event"?{date:selDay}: q==="todo"?{assignee:prefs.me||""}: q==="shopping"?{category:"Other"}:{};
      openForm(map[q], null, preset); }
    else if(t.dataset.day){ openDaySheet(t.dataset.day); }
    else if(t.dataset.addday){ openForm("events", null, {date:t.dataset.addday}); }
    else if(t.dataset.filter){ prefs.todoFilter=t.dataset.filter; savePrefs(); renderTodos(); }
    else if(t.dataset.mealshop){ const m=data.meals.find(x=>String(x.id)===t.dataset.mealshop); if(!m) return;
      if(!confirm("Add every ingredient from these recipes to the shopping list? You can untick or remove what you already have.")) return;
      m.recipes.forEach(r=>(r.ingredients||[]).forEach(i=>op("add","shopping",{item:i, qty:"", category:guessCat(i), note:"For "+m.title+": "+r.name, done:false}))); }
  });
  const quick = (inp, btn, fn) => { const go=()=>{ const v=$(inp).value.trim(); if(!v) return; fn(v); $(inp).value=""; }; $(btn).onclick=go; $(inp).addEventListener("keydown",e=>{ if(e.key==="Enter") go(); }); };
  quick("#shopQuick","#shopAdd", v=>op("add","shopping",{item:v, qty:"", category:guessCat(v), done:false}));
  quick("#todoQuick","#todoAdd", v=>op("add","todos",{task:v, assignee:(prefs.todoFilter&&members().includes(prefs.todoFilter))?prefs.todoFilter:"", due:"", done:false}));
  quick("#noteQuick","#noteAdd", v=>op("add","notes",{text:v, pinned:false}));
  $("#shopClear").onclick=()=>{ const done=data.shopping.filter(s=>s.done); if(!done.length) return; if(confirm("Remove "+done.length+" ticked item(s)?")) done.forEach(s=>op("delete","shopping",null,s.id)); };
  $("#calPrev").onclick=()=>{ calCursor.setMonth(calCursor.getMonth()-1); renderCalendar(); };
  $("#calNext").onclick=()=>{ calCursor.setMonth(calCursor.getMonth()+1); renderCalendar(); };
  $("#calToday").onclick=()=>{ calCursor=new Date(); calCursor.setDate(1); selDay=todayStr(); renderCalendar(); };
  $("#settingsBtn").onclick=openSettings;
  $("#refreshBtn").onclick=()=>{ lastSync=null; load(); toast("Refreshing…"); };
  $("#pinGo").onclick=submitPin; $("#pinInput").addEventListener("keydown",e=>{ if(e.key==="Enter") submitPin(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") hideModal(true); });
  const onResume=()=>{ if(!document.hidden && live()) load(); };
  document.addEventListener("visibilitychange", onResume);
  window.addEventListener("pageshow", onResume);
  window.addEventListener("online", onResume);
}
function tick(){ const n=new Date(); $("#clock").innerHTML = n.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})+"<br>"+n.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}); }
let wakeLock=null;
async function setupKiosk(){
  if(prefs.kiosk){ try{ if("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); }catch(e){} }
}
let lastDay = todayStr();
function start(){
  bind(); bindSwipe(); tick(); setInterval(tick, 15000);
  load(); setupKiosk();
  setInterval(()=>{
    if(!$("#modal").classList.contains("hidden")) return;
    if(todayStr()!==lastDay){ lastDay=todayStr(); selDay=lastDay; calCursor=new Date(); calCursor.setDate(1); }
    if(live()) load(); else render();
  }, Math.max(20, CFG.refreshSeconds||60)*1000);
  if("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(()=>{});
}
start();
})();
