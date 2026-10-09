// One audio owner replaces app.js's placeholder oscillator. All samples are original WAVs.
const NAMES=['step-heavy','step-light','stomp','seed','charm','guard','swipe','hurt','summon','heal','shelter','hail','warning','charge','hex','win','lose','coin','stone','ink','seal','horn','ascend','ambience'];
export class Soundscape {
 constructor({contextFactory=()=>new (window.AudioContext||window.webkitAudioContext)(),fetcher=(url)=>fetch(url),onState=()=>{}}={}){
  this.contextFactory=contextFactory;this.fetcher=fetcher;this.onState=onState;this.enabled=true;this.playing=false;this.volume=.55;this.buffers=new Map();this.voices=new Set();this.lastPlayed=new Map();this.ambient=null;this.loaded=null;this.missing=[];
 }
 async unlock(){
  if(!this.context){this.context=this.contextFactory();this.master=this.context.createGain();this.master.gain.value=this.enabled?this.volume:0;this.master.connect(this.context.destination);this.context.onstatechange=()=>this.onState(this.context.state==='running'?(this.missing.length?'partial':'ready'):'locked');}
  await this.context.resume();
  if(!this.loaded){
   this.onState('loading');
   this.loaded=Promise.all(NAMES.map(async name=>{
    try{const response=await this.fetcher('./assets/audio/'+name+'.wav');if(!response.ok)throw new Error(name);this.buffers.set(name,await this.context.decodeAudioData(await response.arrayBuffer()));}
    catch{this.missing.push(name);}
   })).then(()=>{this.onState(this.missing.length?'partial':'ready');this.syncAmbience();});
  }
  await this.loaded;this.syncAmbience();
 }
 setEnabled(enabled){this.enabled=enabled;if(this.master)this.master.gain.setValueAtTime(enabled?this.volume:0,this.context.currentTime);if(!enabled)this.stopVoices();else this.syncAmbience();}
 setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));if(this.master)this.master.gain.setValueAtTime(this.enabled?this.volume:0,this.context.currentTime);}
 setPlaying(playing){if(this.playing===playing)return;this.playing=playing;if(!playing)this.stopVoices();else this.syncAmbience();}
 stopVoices(){for(const v of [...this.voices]){try{v.stop();}catch{}v.disconnect();}this.voices.clear();this.ambient=null;this.lastPlayed.clear();}
 syncAmbience(){if(this.playing&&this.enabled&&!this.ambient&&this.buffers.has('ambience')&&this.context?.state==='running')this.ambient=this.voice('ambience',{loop:true,gain:.18});}
 voice(name,{gain=1,loop=false,pan=0}={}){
  const context=this.context,buffer=this.buffers.get(name);if(!this.enabled||!buffer||context?.state!=='running')return null;
  const source=context.createBufferSource(),volume=context.createGain();source.buffer=buffer;source.loop=loop;volume.gain.value=gain;source.connect(volume);
  let panner;if(context.createStereoPanner){panner=context.createStereoPanner();panner.pan.value=Math.max(-.7,Math.min(.7,pan));volume.connect(panner);panner.connect(this.master);}else volume.connect(this.master);
  source.onended=()=>{this.voices.delete(source);volume.disconnect();panner?.disconnect();source.disconnect();if(this.ambient===source)this.ambient=null;};
  source.soundName=name;this.voices.add(source);source.start();return source;
 }
 play(name,{gain=1,pan=0,allowIdle=false}={}){
  if(!this.enabled||(!this.playing&&!allowIdle)||!this.context)return;
  const now=this.context.currentTime,step=name.startsWith('step-'),limit=step?.16:.075;
  if(now-(this.lastPlayed.get(name)??-100)<limit)return;
  if(step&&this.voices.size>=7)return;
  if(this.voices.size>=12){
   const quiet=[...this.voices].find(v=>v.soundName?.startsWith('step-'));
   if(!quiet)return;quiet.stop();quiet.disconnect();this.voices.delete(quiet);
  }
  const voice=this.voice(name,{gain:gain*(step?.24:name==='coin'?.45:.95),pan});if(voice)this.lastPlayed.set(name,now);
 }
 event(e,heroX){
  if(e.type==='swipe'||e.type==='claw')return;
  let name=e.type;
  if(e.type==='hit')name=({horn:'horn',stone:'stone',seed:'seed',ink:'ink',seal:'seal',charm:'charm',hex:'hex',stomp:'stomp',rush:'charge',horse:'hurt',boss:'stomp',hail:'hail'})[e.weapon]||'hurt';
  if(e.type==='footstep')name=['haetae','cow'].includes(e.kind)?'step-heavy':'step-light';
  if(e.type==='projectile')name='swipe';
  if(e.type==='vanish'&&e.kind==='reaper')name='ascend';
  if(e.type==='rush')name='charge';
  if(e.type==='upgrade')name='heal';
  if(e.type==='finish'){this.setPlaying(false);this.play(e.status==='won'?'win':'lose',{allowIdle:true});return;}
  if(e.type==='hail-impact')name=e.blocked?'guard':'stomp';
  if(!NAMES.includes(name)||name==='ambience')return;
  this.play(name,{gain:e.type==='projectile'?.15:e.type==='swipe'?.35:1,pan:((e.x??e.from??heroX)-heroX-150)/900});
 }
}
