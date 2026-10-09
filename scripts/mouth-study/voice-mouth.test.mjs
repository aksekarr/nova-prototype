import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const helper = `data:text/javascript;base64,${Buffer.from(await readFile(new URL('../../js/speech-mouth.js',import.meta.url),'utf8')).toString('base64')}`;
let source=await readFile(new URL('../../js/voice.js',import.meta.url),'utf8');
source=source.replace("import { createVoiceEffect, stopReferenceClip } from './flanger.js';",'const createVoiceEffect=()=>({input:{},ready:Promise.resolve(),reset(){}}); const stopReferenceClip=()=>{};');
source=source.replace("'./speech-mouth.js'",JSON.stringify(helper));
const {createVoice}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const element=()=>({textContent:'',className:'',classList:{add(){},toggle(){}},appendChild(){}});
globalThis.document={addEventListener(){},createElement:element,createTextNode:text=>({textContent:text})};
let context;
class FakeAudioContext {
  constructor(){context=this;this.currentTime=0;this.state='running';this.sampleRate=44100;this.sources=[];}
  createGain(){return {gain:{value:1,setValueAtTime(){}},connect(){}};}
  createBuffer(channels,length,rate){const data=new Float32Array(length);return {duration:length/rate,getChannelData:()=>data};}
  createBufferSource(){const node={connect(){},disconnect(){},start(time){this.startedAt=time;},stop(){}};this.sources.push(node);return node;}
  resume(){this.state='running';return Promise.resolve();}
}
globalThis.window={AudioContext:FakeAudioContext};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function audio(seconds=1){const samples=Buffer.alloc(Math.round(seconds*44100)*2);for(let i=0;i<samples.length;i+=2)samples.writeInt16LE(6000,i);return samples.toString('base64');}
function align(text,step=50){return {chars:[...text],char_start_times_ms:[...text].map((_,i)=>i*step),char_durations_ms:[...text].map(()=>step)};}
function advance(voice,seconds){const end=context.currentTime+seconds;while(context.currentTime<end){context.currentTime+=1/120;voice.update(1/120);}}

test('actual voice stream uses the new channels and returns to the original neutral input',async()=>{
  const voice=createVoice({caption:element(),readout:element()});
  const handle=voice.stream.begin();handle.setText('touch moon');handle.addAlignment(align('touch moon',60));handle.addAudio(audio());await tick();
  advance(voice,.32);
  let shape=voice.currentShape();assert.equal(shape.round,0);assert.equal(shape.cup,0);assert.ok(shape.h>.2);
  assert.equal(Object.keys(shape).length,8);
  advance(voice,.26);
  shape=voice.currentShape();assert.ok(shape.round>.5);assert.ok(shape.cup>.5);assert.ok(shape.oval>.5);
  handle.interrupt();advance(voice,2);
  assert.equal(voice.currentEnvelope(),0);
  assert.deepEqual(voice.currentShape(),{w:1,h:1,round:0,close:0,cup:0,square:0,tuck:0,oval:0});
  assert.equal(voice.lastReplyEnd().reason,'interrupted');
});

test('replacement reply clears old rounded targets and still reaches bilabial closure',async()=>{
  const voice=createVoice({caption:element(),readout:element()});
  let handle=voice.stream.begin();handle.setText('moon');handle.addAlignment(align('moon',150));handle.addAudio(audio());await tick();advance(voice,.45);
  assert.ok(voice.currentShape().cup>.5);
  handle=voice.stream.begin();handle.setText('mmm');handle.addAlignment(align('mmm',180));handle.addAudio(audio());await tick();advance(voice,.45);
  assert.equal(voice.currentShape().close,1);assert.ok(voice.currentShape().cup<.001);
  assert.ok(voice.currentShape().round<.001);
  handle.interrupt();advance(voice,2);assert.equal(voice.currentShape().h,1);
});

test('stream gaps release every extra channel and FF uses lower-lip tuck',async()=>{
  const voice=createVoice({caption:element(),readout:element()});
  const handle=voice.stream.begin();handle.setText('five');handle.addAlignment(align('five',250));handle.addAudio(audio(.3));await tick();advance(voice,.25);
  assert.ok(voice.currentShape().tuck>.7);
  advance(voice,2);assert.ok(voice.currentEnvelope()<.000001);
  assert.equal(voice.currentShape().h,1);assert.equal(voice.currentShape().tuck,0);
  handle.interrupt();
});
