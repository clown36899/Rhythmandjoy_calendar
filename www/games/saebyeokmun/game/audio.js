// One audio owner. User-provided music + credited effects; see assets/audio/LICENSES.txt.
const NAMES=['step-heavy','step-light','stomp','seed','charm','guard','swipe','hurt','summon','heal','shelter','hail','warning','charge','hex','win','lose','coin','stone','ink','seal','horn','ascend','ambience'];
const LEVELS={'step-heavy':.18,'step-light':.13,coin:.22,swipe:.38,guard:.62,warning:.8,summon:.65,heal:.55,seal:.68,charm:.68,hex:.7,ascend:.6};
export class Soundscape {
 constructor({contextFactory=()=>new (window.AudioContext||window.webkitAudioContext)(),fetcher=(url)=>fetch(url),onState=()=>{}}={}){
  this.contextFactory=contextFactory;this.fetcher=fetcher;this.onState=onState;this.enabled=true;this.musicEnabled=true;this.effectsEnabled=true;this.playing=false;this.volume=.55;this.buffers=new Map();this.voices=new Set();this.lastPlayed=new Map();this.ambient=null;this.ambientOffset=0;this.loaded=null;this.missing=[];
 }
 async unlock(){
  if(!this.context){this.context=this.contextFactory();this.master=this.context.createGain();this.master.gain.value=this.enabled?this.volume:0;
   if(this.context.createDynamicsCompressor){this.limiter=this.context.createDynamicsCompressor();this.limiter.threshold.value=-5;this.limiter.knee.value=6;this.limiter.ratio.value=12;this.limiter.attack.value=.003;this.limiter.release.value=.16;this.master.connect(this.limiter);this.limiter.connect(this.context.destination);}else this.master.connect(this.context.destination);
   this.context.onstatechange=()=>this.onState(this.context.state==='running'?(this.missing.length?'partial':'ready'):'locked');}
  await this.context.resume();
  if(!this.loaded){
   this.onState('loading');
   this.loaded=Promise.all(NAMES.map(async name=>{
    try{const response=await this.fetcher('./assets/audio/'+name+(name==='ambience'?'.mp3':'.wav')+'?v=31');if(!response.ok)throw new Error(name);this.buffers.set(name,await this.context.decodeAudioData(await response.arrayBuffer()));}
    catch{this.missing.push(name);}
   })).then(()=>{this.onState(this.missing.length?'partial':'ready');this.syncAmbience();});
  }
  await this.loaded;this.syncAmbience();
 }
 setEnabled(enabled){this.enabled=enabled;if(this.master)this.master.gain.setValueAtTime(enabled?this.volume:0,this.context.currentTime);if(!enabled)this.stopVoices();else this.syncAmbience();}
 setChannelEnabled(channel,enabled){if(!['music','effects'].includes(channel))return;this[channel+'Enabled']=!!enabled;if(!enabled)this.stopVoices(false,channel);else if(channel==='music')this.syncAmbience();}
 setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));if(this.master)this.master.gain.setValueAtTime(this.enabled?this.volume:0,this.context.currentTime);}
 setPlaying(playing){if(this.playing===playing)return;this.playing=playing;if(!playing)this.stopVoices();else this.syncAmbience();}
 stopVoices(resetMusic=false,channel=null){if(this.ambient&&channel!=='effects')this.ambientOffset=(this.ambientOffset+this.context.currentTime-this.ambient.startedAt)%this.ambient.buffer.duration;for(const v of [...this.voices]){if(channel==='music'&&!v.loop||channel==='effects'&&v.loop)continue;try{v.stop();}catch{}v.disconnect();this.voices.delete(v);}if(channel!=='effects')this.ambient=null;if(channel!=='music')this.lastPlayed.clear();if(resetMusic)this.ambientOffset=0;}
 syncAmbience(){if(this.playing&&this.enabled&&this.musicEnabled&&!this.ambient&&this.buffers.has('ambience')&&this.context?.state==='running')this.ambient=this.voice('ambience',{loop:true,gain:.22});}
 voice(name,{gain=1,loop=false,pan=0,rate=1}={}){
  const context=this.context,buffer=this.buffers.get(name);if(!this.enabled||!(loop?this.musicEnabled:this.effectsEnabled)||!buffer||context?.state!=='running')return null;
  const source=context.createBufferSource(),volume=context.createGain();source.buffer=buffer;source.loop=loop;source.playbackRate.value=rate;volume.gain.value=gain;source.connect(volume);
  let panner;if(context.createStereoPanner){panner=context.createStereoPanner();panner.pan.value=Math.max(-.7,Math.min(.7,pan));volume.connect(panner);panner.connect(this.master);}else volume.connect(this.master);
  source.onended=()=>{this.voices.delete(source);volume.disconnect();panner?.disconnect();source.disconnect();if(this.ambient===source)this.ambient=null;};
  source.soundName=name;source.startedAt=context.currentTime;this.voices.add(source);source.start(0,loop?this.ambientOffset:0);return source;
 }
 play(name,{gain=1,pan=0,allowIdle=false}={}){
  if(!this.enabled||!this.effectsEnabled||(!this.playing&&!allowIdle)||!this.context)return;
  const now=this.context.currentTime,step=name.startsWith('step-'),limit=step?.18:name==='coin'?.24:.09;
  if(now-(this.lastPlayed.get(name)??-100)<limit)return;
  if(step&&this.voices.size>=7)return;
  if(this.voices.size>=12){
   const quiet=[...this.voices].find(v=>v.soundName?.startsWith('step-'));
   if(!quiet)return;quiet.stop();quiet.disconnect();this.voices.delete(quiet);
  }
  const vary=step||['stone','horn','seed','hurt','guard','swipe'].includes(name),rate=vary?.97+(now*7%1)*.06:1;
  const voice=this.voice(name,{gain:gain*(LEVELS[name]??.86),pan,rate});if(voice)this.lastPlayed.set(name,now);
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
  this.play(name,{gain:e.type==='projectile'?.45:1,pan:((e.x??e.from??heroX)-heroX-150)/900});
 }
}
