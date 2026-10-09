// Temporary Safari QA. Private capture text/audio are consumed in memory only.
const prefix=location.pathname.startsWith('/baseline/')?'/baseline/':'/';
const THREE=await import(prefix+'js/vendor/three.module.js');
const {createMappedFace,mouthAperture}=await import(prefix+'js/facewarp.js');
const {createMouthLabController}=await import(prefix+'js/tuning.js');
const {sampleScalar}=await import(prefix+'js/facesample.js');
const channels=['w','h','round','close','cup','square','tuck','oval'];
const specifications={
 UH:[[1.02,1,0,0,0,0,0,.3],[1.02,1.3,0,0,0,0,0,.3],[.98,1.5,0,0,0,0,0,.3],[1.02,1.3,0,0,0,0,0,.5]],
 OU:[[.70,.14,1,0,1,0,0,1],[.70,.28,1,0,1,0,0,1],[.70,.40,1,0,1,0,0,1],[.62,.28,1,0,1,0,0,1]],
 CH:[[.92,.35,.2,0,.2,.3,0,0],[.92,.60,.2,0,.2,.3,0,0],[.92,.60,.2,0,.5,.3,0,0],[.92,.50,.2,0,.3,.7,0,0]],
 RR:[[.80,.28,.8,0,.6,0,0,.4],[.99,.28,1,0,.6,0,0,.4],[.80,.42,.8,0,.6,0,0,.4],[.99,.42,1,0,.6,0,0,.4]]
};
const candidates=Object.entries(specifications).flatMap(([group,rows])=>rows.map((values,i)=>({name:group+'-'+String.fromCharCode(97+i),group,letter:String.fromCharCode(97+i),shape:Object.fromEntries(channels.map((k,j)=>[k,values[j]]))})));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const save=async obj=>{const r=await fetch('/m1c2-write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});if(!r.ok)throw Error('QA save failed');};
const until=async test=>{for(let n=0;n<5000;n++){if(test())return;await sleep(30);}throw Error('QA timeout');};
const cloneCanvas=c=>{const out=document.createElement('canvas');out.width=c.width;out.height=c.height;out.getContext('2d').drawImage(c,0,0);return out;};
const maximumDifference=(a,b)=>{let max=0,count=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){count++;max=Math.max(max,Math.abs(a[i]-b[i]));}return{max,count,values:a.length};};

export async function installMouthQA(q){
 const panel=document.createElement('div');Object.assign(panel.style,{position:'fixed',top:'8px',left:'8px',zIndex:100000,background:'#151722',color:'white',padding:'8px',font:'12px monospace',maxWidth:'94vw'});document.body.append(panel);
 const info=document.createElement('output');info.textContent='M1c2 '+q.version+' ready';panel.append(info,document.createElement('br'));
 const buttons=[];const add=(label,fn,persistent=false)=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;panel.append(b);if(!persistent)buttons.push(b);return b;};
 q.neutral={smile:0,eye:1,upperLid:0,lowerLid:0,slant:0,eyeAsym:0,browL:0,browR:0,browKnit:0,browAngle:0,tilt:0,mouthOpen:0};
 let busy=false,mode='',progress='Ready',report=null,active=null,shotResolve=null,privateReplay=null,privateReplayMeta=null,cancelRequested=false;
 const fail=code=>{const error=new Error('QA operation failed');error.code=code;throw error;};
 const safeDiagnostics=()=>{const cues=q.voice.currentCues(),last=q.voice.lastReplyEnd();return{frame:q.frame,clock:q.state.clock,frozen:Boolean(q.frozen),mode:q.state.mode,audio:q.voice.qaAudioState?.()||{state:'unavailable',currentTime:null},streamActive:q.voice.stream.isActive(),streamAudible:q.voice.stream.isAudible(),envelope:q.voice.currentEnvelope(),speechState:cues?{state:cues.state,position:cues.position}:null,lastEnd:last?{reason:last.reason,position:last.position}:null,faceEnvelope:q.face.diagnostics?.mouth?.envelope??null,visibility:document.visibilityState,consoleErrorCount:q.errors.length};};
 async function bounded(promise,ms){let timer;try{return await Promise.race([promise.then(value=>({timedOut:false,value})),new Promise(resolve=>{timer=setTimeout(()=>resolve({timedOut:true}),ms);})]);}finally{clearTimeout(timer);}}
 const metadata=()=>({baseline:'98bc3ee',version:q.version,sourceHashes:q.sourceHashes,browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},renderSize:{width:q.renderer.domElement.width,height:q.renderer.domElement.height,pixelRatio:q.renderer.getPixelRatio()},initialSeed:q.initialSeed,errors:[...q.errors],warnings:[...q.warnings]});
 const frameAfter=n=>{const start=q.frame;return until(()=>q.frame>=start+n);};
 const snapshot=()=>new Promise(resolve=>{shotResolve=resolve;});
 const lips=[];for(let i=0;i<q.shapes.I.face[1];i++)if(Math.abs(q.shapes.UV[i*2]-.5)<.14&&Math.abs(q.shapes.UV[i*2+1]-q.shapes.MAPS.landmarks.mouthCentre[1])<.10)lips.push(i);
 q.onRender=frame=>{
  if(shotResolve){const resolve=shotResolve;shotResolve=null;resolve(cloneCanvas(frame.canvas));}
  if(!active)return;
  active.frames++;active.durationMs+=frame.frameMs;active.cpuMs+=frame.cpu;active.framesOver20ms+=Number(frame.frameMs>20);active.slowestFrameMs=Math.max(active.slowestFrameMs,frame.frameMs);active.warpMs+=frame.warpMs;
  active.invisibleFrames+=Number(document.visibilityState!=='visible');
 };
 async function status(){await fetch('/m1c2-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:q.version,ready:true,busy,mode,progress,complete:Boolean(report?.complete),failure:report?.failure||null,failureCode:report?.failureCode||null,frame:q.frame,diagnostics:safeDiagnostics(),errors:q.errors.length,warnings:q.warnings.length,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})});}
 async function announce(text){progress=text;info.textContent='M1c2 '+q.version+' · '+text;await status();}
 function mapped(){if(!q.heldMapper){q.heldMapper=createMappedFace(q.shapes,false);q.heldMapper.applyTuning(q.tuning);}return q.heldMapper;}
 function projectedVector(v){v.applyMatrix4(q.points.matrixWorld).project(q.camera);return[(v.x*.5+.5)*q.renderer.domElement.width,(.5-v.y*.5)*q.renderer.domElement.height];}
 function projected(i){return projectedVector(new THREE.Vector3(q.display[i*3],q.display[i*3+1],q.display[i*3+2]));}
 function bounds(indices,pad=0){let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const i of indices){const p=projected(i);x=Math.min(x,p[0]);right=Math.max(right,p[0]);y=Math.min(y,p[1]);bottom=Math.max(bottom,p[1]);}return{x:Math.floor(x-pad),y:Math.floor(y-pad),width:Math.ceil(right-x+2*pad),height:Math.ceil(bottom-y+2*pad)};}
 function mouthCentre(){const [u,v]=q.shapes.MAPS.landmarks.mouthCentre,scale=q.shapes.MAP_SCALE,p=projectedVector(new THREE.Vector3((u-.5)*scale,(.5-v)*scale,(sampleScalar(q.shapes.MAPS.depth,u,v)-.5)*q.tuning.depthAmount));return{x:p[0],y:p[1],method:'Projected photographed mouth-centre landmark at fixed neutral geometry and fixed camera.'};}
 function rendererSupport(map){return{columns:['x','y','lipFocus','cavity','red','green','blue'],particles:lips.map(i=>{const p=projected(i),f=i*5,j=i*3;return[p[0],p[1],map.featureLight[f+2],map.featureLight[f+4],q.shapes.FACE_COL[j],q.shapes.FACE_COL[j+1],q.shapes.FACE_COL[j+2]];})};}
 function mouthMetrics(map){const cavity=[],lip=[],mouth=[];for(const i of lips){const f=i*5;if(map.featureLight[f+4]>.45)cavity.push(i);if(map.featureLight[f+2]>.25)lip.push(i);if(map.featureLight[f+2]>.10)mouth.push(i);}const opening=cavity.length?bounds(cavity):{width:0,height:0},lipBounds=lip.length?bounds(lip):{width:0,height:0},mouthBounds=mouth.length?bounds(mouth):{width:0,height:0};let brightness=0;for(const i of lip)brightness+=q.shapes.FACE_COL[i*3]*.2126+q.shapes.FACE_COL[i*3+1]*.7152+q.shapes.FACE_COL[i*3+2]*.0722;return{method:'Projected rendered particle support: cavity > .45, lipFocus > .25; mouth width lipFocus > .10; linear particle colour luminance. Descriptive, not anatomical targets.',openingWidth:opening.width,openingHeight:opening.height,ratio:opening.height?opening.width/opening.height:null,lipBandThickness:(lipBounds.height-opening.height)/2,mouthWidth:mouthBounds.width,meanLipBrightness:brightness/Math.max(1,lip.length),openingParticleCount:cavity.length,lipParticleCount:lip.length,openingBounds:opening,lipBounds,mouthBounds,openingWidthPercentMouth:mouthBounds.width?100*opening.width/mouthBounds.width:null};}
 let eyeReference=null;
 function clearance(map){
  const eye=[],mouth=[],cavity=[],ribbons={'.012':[],'.020':[],'.030':[]},width=q.renderer.domElement.width,height=q.renderer.domElement.height;
  for(let i=0;i<q.shapes.I.face[1];i++){
   const u=q.shapes.UV[i*2],v=q.shapes.UV[i*2+1];
   if([q.shapes.MAPS.landmarks.eyeL,q.shapes.MAPS.landmarks.eyeR].some(([x,y])=>Math.abs(u-x)<.045&&Math.abs(v-y)<.035))eye.push(i);
   if(map.featureLight[i*5+2]>.25)mouth.push(i);if(map.featureLight[i*5+4]>.45)cavity.push(i);
   const su=map.samplePositions[i*2],sv=map.samplePositions[i*2+1],landmarks=q.shapes.MAPS.landmarks;
   if(su>=landmarks.mouthLeft[0]&&su<=landmarks.mouthRight[0]){const index=Math.max(0,Math.min(127.9999,(su-map.seamStart)/(map.seamEnd-map.seamStart)*128)),n=index|0,centre=map.seam[n]+(map.seam[n+1]-map.seam[n])*(index-n),distance=Math.abs(sv-centre);if(distance>=.003)for(const [halfWidth,indices]of Object.entries(ribbons))if(distance<=Number(halfWidth))indices.push(i);}
  }
  const sample=indices=>{let min=1,sum=0,outside=0,maxRadius=0;for(const i of indices){const p=projected(i),sx=p[0]/width,sy=1-p[1]/height;let protection=0,radius=Infinity;for(const f of q.featureClearance){const r2=((sx-f.x)/Math.max(f.z,.0001))**2+((sy-f.y)/Math.max(f.w,.0001))**2,t=Math.max(0,Math.min(1,(r2-.5625)/(2.25-.5625)));protection=Math.max(protection,1-t*t*(3-2*t));radius=Math.min(radius,Math.sqrt(r2));}min=Math.min(min,protection);sum+=protection;outside+=protection===0;maxRadius=Math.max(maxRadius,radius);}return{particles:indices.length,minimumExclusionMask:min,meanExclusionMask:sum/Math.max(1,indices.length),outsideFeather:outside,maximumNormalizedRadius:maxRadius};};
  const data=eye.flatMap(i=>[q.display[i*3],q.display[i*3+1],q.display[i*3+2],q.shapes.FACE_COL[i*3],q.shapes.FACE_COL[i*3+1],q.shapes.FACE_COL[i*3+2]]);eyeReference??=data;return{method:'Actual projected featureClearance vectors; gas smoothstep(.5625,2.25,r²) mask evaluated at displayed particles, not isolated gas raster.',vectors:q.featureClearance.map(f=>[f.x,f.y,f.z,f.w]),eye:sample(eye),lip:sample(mouth),cavity:sample(cavity),sourceSeamRibbons:Object.fromEntries(Object.entries(ribbons).map(([k,indices])=>[k,sample(indices)])),eyePositionColourDifferenceFromRest:maximumDifference(data,eyeReference)};
 }
 async function hold(name,shape,opening=.6){
  q.stopAll();q.shadowEnabled=false;q.comparePixels=false;q.frozen=true;q.state.clock=20;q.state.mode='face';q.state.modeT=0;mapped();
  const local={...q.tuning,visemes:{...q.tuning.visemes,QA:{...shape}}},lab=createMouthLabController(local);
  lab.sample(0,0,q.tuning.visemes.REST);lab.setOpening(opening);lab.select('QA');let samples=0;
  q.hold={name,opening:0,shape:{...q.tuning.visemes.REST}};
  q.heldStep=dt=>{const out=lab.sample(dt,0,q.tuning.visemes.REST);q.hold={name,opening:out.envelope,shape:{...out.shape}};samples++;};
  await frameAfter(150);const canvas=await snapshot();q.heldStep=null;
  const delta=Math.max(...channels.map(k=>Math.abs((q.hold.shape[k]??0)-(shape[k]??0))));
  return{canvas,smoothing:{controller:'production createMouthLabController',samples,dt:1/60,maximumChannelError:delta,settled:delta===0,renderedShape:{...q.hold.shape}}};
 }
 async function captureCandidates(){
  if(q.version!=='current')throw Error('Candidates require current version');
  const tests=[{name:'REST',shape:q.tuning.visemes.REST},...candidates,{name:'PP',shape:q.tuning.visemes.PP}],rows=[];
  let faceROI=null,mouthROI=null,restWidth=null;
  for(const test of tests){await announce('Capturing '+test.name);const shot=await hold(test.name,test.shape);const map=q.heldMapper.qa,metrics=mouthMetrics(map),centre=mouthCentre();
   faceROI??=bounds(Array.from({length:q.shapes.I.face[1]},(_,i)=>i),18);
   if(!mouthROI){const region=bounds(lips,8);mouthROI={x:Math.round(centre.x-region.width/2),y:Math.round(centre.y-region.height/2),width:region.width,height:region.height};}
   if(test.name==='REST')restWidth=metrics.mouthWidth;
   metrics.mouthWidthPercentRest=restWidth?100*metrics.mouthWidth/restWidth:null;
   const record={...metadata(),viseme:test.name,group:test.group||test.name,letter:test.letter||null,opening:.6,shape:{...test.shape},channelOrder:channels,smoothing:shot.smoothing,camera:q.camera.position.toArray(),headPose:[0,0,0],neutralExpression:q.neutral,clock:20,faceROI,mouthROI,mouthCentre:centre,metrics,rendererSupport:rendererSupport(map),clearance:clearance(map)};
   await save({name:'m1c2-'+test.name,image:shot.canvas.toDataURL('image/png'),...record});rows.push({name:test.name,shape:record.shape,smoothing:record.smoothing,metrics});
  }
  report.captures=rows;report.candidateCount=candidates.length;report.allSettled=rows.every(r=>r.smoothing.settled);report.faceROI=faceROI;report.mouthROI=mouthROI;
 }
 async function integrity(){
  if(q.version!=='current')throw Error('Integrity requires current version');
  q.stopAll();q.heldStep=null;q.shadowEnabled=false;q.comparePixels=false;
  const base=q.shapes,mouth=base.MAPS.landmarks.mouthCentre,nx=121,ny=101,x0=mouth[0]-.24,y0=mouth[1]-.19,dx=.48/(nx-1),dy=.38/(ny-1),epsilon=.000001,n=nx*ny*3;
  const grid={...base,N:n,I:{face:[0,n]},UV:new Float32Array(n*2),FACE:new Float32Array(n*3),FACE_COL:new Float32Array(n*3),MAP_DEPTH:new Float32Array(n).fill(.5),DENSITY_RANDOM:new Float32Array(n).fill(.5),SPARK_RANDOM:new Float32Array(n).fill(.5),P1:new Float32Array(n),STAR_TINT:new Float32Array(n*3).fill(1),STAR_SIZE:new Float32Array(n).fill(1),FIELD:new Float32Array(n),PROTECT:new Float32Array(n)};
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const i=(y*nx+x)*3;for(let k=0;k<3;k++){grid.UV[(i+k)*2]=x0+x*dx+(k===1?epsilon:0);grid.UV[(i+k)*2+1]=y0+y*dy+(k===2?epsilon:0);}}
  const mapper=createMappedFace(grid,false);mapper.applyTuning(q.tuning);const rows=[];
  for(const test of candidates)for(const opening of [.6,1]){await announce('Sampling '+test.name+' at '+opening);mapper.update(20,q.neutral,{x:0,y:0},1,opening,test.shape);const uv=mapper.qa.samplePositions;let min=Infinity,max=0,minAt=null,maxAt=null,cheekBackground=0,minimumCheekCoverage=1,cheekSamples=0,nonfinite=0;
   for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const i=(y*nx+x)*3,l=i*2,r=(i+1)*2,t=i*2,b=(i+2)*2,a=(uv[r]-uv[l])/(grid.UV[r]-grid.UV[l]),c=(uv[r+1]-uv[l+1])/(grid.UV[r]-grid.UV[l]),bb=(uv[b]-uv[t])/(grid.UV[b+1]-grid.UV[t+1]),d=(uv[b+1]-uv[t+1])/(grid.UV[b+1]-grid.UV[t+1]),jac=a*d-bb*c,trace=a*a+bb*bb+c*c+d*d,stretch=Math.sqrt((trace+Math.sqrt(Math.max(0,trace*trace-4*jac*jac)))/2);if(!Number.isFinite(jac)||!Number.isFinite(stretch))nonfinite++;if(jac<min){min=jac;minAt=[grid.UV[i*2],grid.UV[i*2+1]];}if(stretch>max){max=stretch;maxAt=[grid.UV[i*2],grid.UV[i*2+1]];}}
   for(let i=0;i<n;i+=3){const u=grid.UV[i*2],v=grid.UV[i*2+1],offset=Math.abs(u-mouth[0]);if(offset>mapper.qa.mouthHalf&&offset<mapper.qa.mouthHalf+.09&&Math.abs(v-mouth[1])<.12&&sampleScalar(base.MAPS.mask,u,v)>.9){const coverage=sampleScalar(base.MAPS.mask,uv[i*2],uv[i*2+1]);minimumCheekCoverage=Math.min(minimumCheekCoverage,coverage);cheekBackground+=coverage<.1;cheekSamples++;}}
   rows.push({name:test.name,shape:test.shape,opening,minimumJacobian:min,minimumAt:minAt,maximumLocalStretch:max,maximumAt:maxAt,cheekBackgroundSamples:cheekBackground,minimumCheekCoverage,cheekSamples,nonfinite});await sleep(0);
  }
  const transitions=[];
  for(const test of candidates)for(const opening of [.6,1]){
   const tuning={...q.tuning,visemes:{...q.tuning.visemes,QA:{...test.shape}}},lab=createMouthLabController(tuning);lab.sample(0,0,tuning.visemes.REST);lab.setOpening(opening);lab.select('QA');let sample;
   for(let frame=0;frame<150;frame++)sample=lab.sample(1/60,0,tuning.visemes.REST);
   const startShape={...sample.shape},startAperture=mouthAperture(sample.envelope,sample.shape,tuning.mouthWarpStrength),startError=Math.max(...channels.map(k=>Math.abs((startShape[k]??0)-(test.shape[k]??0))));lab.select('PP');
   let frames=0,zeroAt=null;while(frames<60){sample=lab.sample(1/60,0,tuning.visemes.REST);frames++;const aperture=mouthAperture(sample.envelope,sample.shape,tuning.mouthWarpStrength);if(aperture===0&&zeroAt===null)zeroAt=frames;if(sample.shape.close===1)break;}
   transitions.push({from:test.name,opening,startShape,startAperture,startMaximumChannelError:startError,frames,closure:sample.shape.close,aperture:mouthAperture(sample.envelope,sample.shape,tuning.mouthWarpStrength),zeroAtFrame:zeroAt,renderEnvelope:sample.envelope});
  }
  report.sampling={grid:{nx,ny,x0,y0,dx,dy,epsilon},method:'Existing m1c forward finite differences (epsilon 1e-6) of production sampled image coordinates; 121×101 home-UV locations, each sampled with two perturbations. Largest singular value of Jacobian; neutral, blink 1. Finite sampling does not prove global invertibility.',rows,caseCount:rows.length,minimumJacobian:Math.min(...rows.map(r=>r.minimumJacobian)),maximumLocalStretch:Math.max(...rows.map(r=>r.maximumLocalStretch)),cheekBackgroundSamples:rows.reduce((sum,r)=>sum+r.cheekBackgroundSamples,0),passed:rows.every(r=>r.minimumJacobian>0&&r.nonfinite===0&&r.cheekBackgroundSamples===0)};
  report.closures={method:'Production lab controller with candidate in an isolated preview tuning copy, 150 fixed 1/60 s samples to candidate, select PP, sample to exact closure (up to 60 frames). Production mouthAperture uses actual controller envelope and shape.',transitions,caseCount:transitions.length,passed:transitions.every(r=>r.startMaximumChannelError===0&&r.closure===1&&r.aperture===0)};
  await save({name:'m1c2-integrity',...metadata(),...report.sampling,closures:report.closures});
 }
 function startStats(){return{frames:0,durationMs:0,cpuMs:0,framesOver20ms:0,slowestFrameMs:0,warpMs:0,invisibleFrames:0,manualInterventions:0,wallStart:performance.now(),visibilityStart:document.visibilityState,visibilityChangesStart:q.visibilityChanges,errorStart:q.errors.length,warningsStart:q.warnings.length,clockStart:q.state.clock,seedStart:q.seed,diagnosticsStart:safeDiagnostics()};}
 function finishStats(s){const result={...s,wallElapsedMs:performance.now()-s.wallStart,visibilityEnd:document.visibilityState,visibilityChanges:q.visibilityChanges-s.visibilityChangesStart,consoleErrors:q.errors.slice(s.errorStart),warnings:q.warnings.slice(s.warningsStart),fps:s.frames*1000/s.durationMs,meanCpuMs:s.cpuMs/s.frames,meanMouthWarpMs:s.warpMs/s.frames,diagnosticsEnd:safeDiagnostics()};delete result.wallStart;return result;}
 async function restoreLive(){q.stopAll();q.heldStep=null;q.frozen=false;q.hold=null;q.shadowEnabled=false;q.comparePixels=false;q.state.mode='face';q.state.modeT=0;q.state.clock=20;q.face.setPose?.('neutral');q.mouthLab.off();await frameAfter(120);}
 async function loadReplay(){if(!privateReplay){const r=await fetch('/refs/live/nova-captures-2026-10-08T21-18-43-294Z.json');if(!r.ok)throw Error('Replay unavailable');const capture=await r.json();privateReplay=capture.replies?.[2];if(!privateReplay)throw Error('Replay missing');privateReplayMeta={sampleRate:capture.sampleRate,eventCount:privateReplay.events.length,lastEventTimeMs:privateReplay.events.at(-1)?.t,lastEventType:privateReplay.events.at(-1)?.type,interrupted:Boolean(privateReplay.interrupted)};}return privateReplay;}
 const median=values=>{const v=[...values].sort((a,b)=>a-b);return v[Math.floor(v.length/2)];};
 async function performanceRuns(){
  await loadReplay();const runs=[];report.performance={complete:false,runs};
  for(const kind of ['Rome','replay'])for(let run=1;run<=3;run++){
   if(cancelRequested)fail('operator-cancelled');
   await announce(kind+' '+run+'/3 · preparing');await restoreLive();
   let result;
   if(kind==='Rome'){q.mouthLab.setOpening(1);q.mouthLab.setSpeed(1);q.mouthLab.sequence('Rome');await sleep(1500);await announce('Timing Rome '+run+'/3');active=startStats();await sleep(12000);const row=finishStats(active);active=null;q.mouthLab.off();result={case:kind,run,opening:1,sequence:q.sequenceDefinitions.Rome,...row};}
   else {
    const resume=await bounded(q.voice.qaResumeAudio(),5000);
    if(resume.timedOut||q.voice.qaAudioState().state!=='running'){report.performance.preflightFailure=safeDiagnostics();fail('audio-context-not-running');}
    await announce('Timing replay '+run+'/3');active=startStats();
    const outcome=await bounded(q.replayCapture(privateReplay),60000),row=finishStats(active);active=null;
    result={case:kind,run,capture:{set:'evening',date:'2026-10-08',index:2,uiReply:3,...privateReplayMeta},timeoutMs:60000,timedOut:outcome.timedOut,interrupted:Boolean(outcome.value?.interrupted),...row};
    if(outcome.timedOut)q.stopAll();
   }
   result.valid=!cancelRequested&&!result.timedOut&&!result.interrupted&&result.frames>0&&result.invisibleFrames===0&&result.visibilityChanges===0&&result.manualInterventions===0&&result.consoleErrors.length===0;
   runs.push(result);
   await save({name:'m1c2-'+q.version+'-perf-'+kind.toLowerCase()+'-'+run,...metadata(),...result});
   await save({name:'m1c2-'+q.version+'-perf-progress',...metadata(),complete:false,runs});
   if(!result.valid)fail(result.timedOut?'replay-timeout':cancelRequested?'operator-cancelled':'invalid-performance-run');
   await announce(kind+' '+run+'/3 complete');await sleep(700);
  }
  privateReplay=null;q.stopAll();const summary={};
  for(const kind of ['Rome','replay']){const selected=runs.filter(r=>r.case===kind);summary[kind]={runs:selected.length,medianFps:median(selected.map(r=>r.fps)),medianFramesOver20ms:median(selected.map(r=>r.framesOver20ms)),medianSlowestFrameMs:median(selected.map(r=>r.slowestFrameMs)),worstFrameMs:Math.max(...selected.map(r=>r.slowestFrameMs)),medianMeanMouthWarpMs:median(selected.map(r=>r.meanMouthWarpMs)),medianElapsedMs:median(selected.map(r=>r.wallElapsedMs)),allVisible:selected.every(r=>r.invisibleFrames===0&&r.visibilityStart==='visible'&&r.visibilityEnd==='visible'&&r.visibilityChanges===0),consoleErrorCount:selected.reduce((s,r)=>s+r.consoleErrors.length,0)};}
  report.performance={complete:true,method:'Actual version modules and defaults; no shadow, screenshots, readbacks, support geometry or integrity work during timing. 120 frame warm-up before each run; Rome further warms 1.5s and runs 12s, Opening 1, speed 1. Audio state must be running before replay; each replay bounded to60s; safe diagnostics only at timed endpoints. Each run saved after timing. Replay source remains memory-only. Rome is a configuration comparison because presets and sequence differ. FPS is measured outcome, not a60fps pass.',runs,summary};
  await save({name:'m1c2-'+q.version+'-perf',...metadata(),...report.performance});
 }
 async function run(nextMode){if(busy)return;const gestureResume=nextMode==='perf'?q.voice.qaResumeAudio():null;busy=true;cancelRequested=false;mode=nextMode;report={mode,complete:false};buttons.forEach(b=>b.disabled=true);await announce('Starting '+mode);
  try{if(gestureResume){const resume=await bounded(gestureResume,5000);if(resume.timedOut||q.voice.qaAudioState().state!=='running')fail('audio-gesture-resume-failed');}if(mode==='candidates')await captureCandidates();else if(mode==='integrity')await integrity();else if(mode==='perf')await performanceRuns();else throw Error('Unknown QA mode');report.complete=true;}
  catch(error){report.failure='M1c2 '+mode+' failed; safe diagnostics retained';report.failureCode=error.code||'qa-operation-failed';report.diagnostics=safeDiagnostics();q.stopAll();}
  finally{active=null;shotResolve=null;q.heldStep=null;await save({name:'m1c2-'+q.version+'-'+mode+'-summary',...metadata(),...report});busy=false;buttons.forEach(b=>b.disabled=false);await announce(mode+(report.complete?' complete':' FAILED'));}
 }
 if(q.version==='current'){add('Capture 16 candidates',()=>run('candidates'));add('Closure + sampling',()=>run('integrity'));}
 add('Performance (3× Rome + replay)',()=>run('perf'));
 add('Resume audio',async()=>{if(active)active.manualInterventions++;const result=await bounded(q.voice.qaResumeAudio(),5000);await announce(result.timedOut?'Audio resume timed out':'Audio '+q.voice.qaAudioState().state);},true);
 add('Inspect audio state',async()=>{if(active)active.manualInterventions++;await status();},true);
 add('Stop playback',()=>{cancelRequested=true;if(active)active.manualInterventions++;q.stopAll();},true);
 q.runM1c2=run;await status();
}
