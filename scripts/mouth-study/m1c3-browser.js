import { mouthAperture } from '/js/facewarp.js';

const channels = ['w','h','round','close','cup','square','tuck','oval'];
const shape = values => Object.fromEntries(channels.map((key,i) => [key,values[i]]));
const shortlist = {
  b: shape([1.02,1.3,0,0,0,0,0,.3]),
  c: shape([.98,1.5,0,0,0,0,0,.3]),
  OU: shape([.62,.28,1,0,1,0,0,1]),
  CH: shape([.92,.60,.2,0,.5,.3,0,0]),
  RR: shape([.99,.42,1,0,.6,0,0,.4]),
};

export async function installMouthQA(q) {
  for (let n=0; !q.mouthLab && n<200; n++) await new Promise(r=>setTimeout(r,25));
  if (!q.mouthLab) throw Error('Mouth preview unavailable');
  document.title = 'Seni · your choices in motion';
  const style = document.createElement('style');
  style.textContent = `
    .hud,.bottom,.tuning {display:none!important}
    #audition {position:fixed;z-index:1000;left:28px;top:28px;width:274px;padding:24px;
      box-sizing:border-box;border:1px solid #ffffff21;border-radius:20px;background:#0c1425e8;
      color:#e7edf5;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;backdrop-filter:blur(12px)}
    #audition *{box-sizing:border-box} #audition h1{font-size:24px;line-height:1.2;margin:5px 0 15px;font-weight:550;letter-spacing:-.4px}
    #audition .eyebrow{color:#91b8b5;font-size:10px;letter-spacing:1.7px;text-transform:uppercase}
    #audition p{margin:10px 0;color:#a8b4c8;font-size:12px}
    #audition label{display:block;margin:17px 0 6px;color:#c7d1e0;font-size:12px}
    #audition .row{display:flex;gap:8px} #audition button,#audition select{font:inherit;border:1px solid #ffffff2c;
      background:#1a263a;color:#e7edf5;border-radius:9px;padding:9px 12px;cursor:pointer}
    #audition .row button{flex:1} #audition button[aria-pressed=true]{background:#bad6cb;color:#0e2522;border-color:#bad6cb}
    #audition button:disabled{opacity:.45;cursor:default}
    #audition select{width:100%} #audition #play{margin-top:20px;width:100%;background:#bad6cb;color:#0e2522;font-weight:600}
    #audition output{display:block;margin-top:12px;color:#d3e3dc;font-size:12px;min-height:18px}
    #audition .fixed{border-top:1px solid #ffffff18;border-bottom:1px solid #ffffff18;padding:11px 0;margin:16px 0}
    #audition footer{font-size:11px;color:#8291a8;margin-top:15px}
    #audition a{color:#bfd7d0} #audition details{margin-top:14px;font-size:11px;color:#8e9db4}
    #audition details button{font-size:11px;margin-top:7px;width:100%}
    @media(max-width:700px){#audition{left:12px;top:12px;width:230px;padding:16px}}
  `;
  document.head.append(style);
  const panel = document.createElement('aside'); panel.id='audition';
  panel.innerHTML = `
    <span class="eyebrow">Seni / motion audition</span>
    <h1>Your choices,<br>in motion.</h1>
    <p>Watch the whole face first. Do the shapes flow and still feel like Seni?</p>
    <div class="fixed">OO · d &nbsp; CH · c &nbsp; R · d</div>
    <label id="uh-label">Which UH feels better?</label>
    <div class="row"><button id="uh-b" aria-pressed="true">UH · B</button><button id="uh-c" aria-pressed="false">UH · C</button></div>
    <label for="word">Movement</label>
    <select id="word"><option value="touch">Touch · UH → CH</option><option value="room">Room · R → OO → closed</option></select>
    <label for="pace">Pace</label>
    <select id="pace"><option value="1">Normal timing</option><option value="0.25">Long holds · inspect the shapes</option></select>
    <button id="play">Play movement</button>
    <output id="status" aria-live="polite">Ready · UH B</output>
    <p id="pace-note">Opening 0.6 · existing word timing</p>
    <footer>Silent preview. These shapes are not connected to live speech yet. Changes stay in this preview.</footer>
    <p><a href="http://127.0.0.1:4204/m1c2-viewer.html">Back to still comparisons</a></p>
    <details><summary>Preview checks</summary><button id="check">Check selected preview</button></details>
  `;
  document.body.append(panel);
  const el=id=>panel.querySelector('#'+id);
  let variant='b', playing=false, generation=0, check=null;
  const pristine=structuredClone(q.tuning.visemes);
  const snapshot=kind=>({kind,variant,word:el('word').value,speed:Number(el('pace').value),opening:.6,
    shapeTargets:Object.fromEntries(['UH','OU','CH','RR'].map(k=>[k,{...q.tuning.visemes[k]}])),
    sequence:q.sequenceDefinitions[el('word').value],errors:[...q.errors],
    viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},browser:navigator.userAgent,clock:q.state.clock,playing});
  const save=async data=>{
    const response=await fetch('/m1c3-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    if(!response.ok) throw Error('Preview check could not be saved');
  };
  function renderState(text){
    const room=el('word').value==='room';
    el('uh-b').disabled=room;el('uh-c').disabled=room;
    el('uh-label').textContent=room?'UH choice · used in Touch':'Which UH feels better?';
    el('uh-b').setAttribute('aria-pressed',String(variant==='b'));
    el('uh-c').setAttribute('aria-pressed',String(variant==='c'));
    el('play').textContent=playing?'Stop movement':'Play movement';
    const selected=room?'R D · OO D':`UH ${variant.toUpperCase()}`;
    el('status').textContent=text || (playing?`Playing ${el('word').value} · ${selected}`:`Ready · ${selected}`);
    el('pace-note').textContent=el('pace').value==='1'?'Opening 0.6 · existing word timing':'Longer holds; transitions keep their original response speed.';
  }
  function apply(){
    q.tuning.visemes={...structuredClone(pristine),UH:{...shortlist[variant]},OU:{...shortlist.OU},CH:{...shortlist.CH},RR:{...shortlist.RR}};
    q.mouthLab.setOpening(.6);q.mouthLab.setSpeed(Number(el('pace').value));
  }
  async function restart(){
    const token=++generation;check=null;apply();q.mouthLab.select('REST');renderState();
    await new Promise(r=>setTimeout(r,250));
    if(token!==generation)return null;
    if(playing)q.mouthLab.sequence(el('word').value);
    await save(snapshot('selection'));
    return token;
  }
  el('uh-b').onclick=()=>{variant='b';restart();};
  el('uh-c').onclick=()=>{variant='c';restart();};
  el('word').onchange=restart;el('pace').onchange=restart;
  el('play').onclick=()=>{playing=!playing;restart();};
  document.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if(e.key==='b'||e.key==='B')el('uh-b').click();if(e.key==='c'||e.key==='C')el('uh-c').click();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){playing=false;restart();}});
  q.onRender=()=>{
    if(!check)return;
    const mouth=q.face.diagnostics.mouth;
    const current=mouth.shape;
    if(!current){check.finite=false;return;}
    check.frames++;
    check.finite&&=channels.every(k=>Number.isFinite(current[k]??0))&&Number.isFinite(mouth.envelope);
    check.seen.add(q.mouthLab.state.currentViseme);
    check.minimumAperture=Math.min(check.minimumAperture,mouthAperture(mouth.envelope,current,q.tuning.mouthWarpStrength));
    check.maximumClosure=Math.max(check.maximumClosure,current.close||0);
  };
  el('check').onclick=async()=>{
    if(el('check').disabled)return;
    el('check').disabled=true;
    try {
      playing=true;const token=await restart();
      if(token===null||token!==generation||!playing)return;
      const activeCheck={frames:0,finite:true,seen:new Set(),minimumAperture:Infinity,maximumClosure:0};
      check=activeCheck;renderState('Checking one short playback…');
      await new Promise(r=>setTimeout(r,1600/Number(el('pace').value)));
      if(token!==generation||check!==activeCheck)return;
      const result={...snapshot('playback-check'),...check,seen:[...check.seen]};check=null;
      await save(result);renderState(result.finite&&result.frames>0?'Preview check saved':'Preview check needs attention');
    } finally {el('check').disabled=false;}
  };
  q.stopAll();q.frozen=false;q.state.mode='face';apply();q.mouthLab.select('REST');renderState();
  await save(snapshot('ready'));
}
