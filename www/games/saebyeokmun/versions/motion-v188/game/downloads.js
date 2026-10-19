// One owner for image transport: bounded requests, byte progress, and the next map's compressed cache.
// Phaser still owns decoded textures; Journey and saved rewards never enter this module.
export class AssetDownloads {
 constructor(sizes,{fetcher=globalThis.fetch,concurrency=4,retainUrls=[]}={}){this.sizes=sizes;this.fetcher=fetcher.bind(globalThis);this.limit=concurrency;this.retainUrls=new Set(retainUrls);this.active=0;this.queue=[];this.records=new Map();this.listeners=new Set();this.future=new Set();}
 notify(){for(const fn of this.listeners)fn();}
 pump(){while(this.active<this.limit&&this.queue.length){if(this.active>=Math.max(1,this.limit-1)&&!this.records.get(this.queue[0].url)?.foreground)break;const job=this.queue.shift();this.active++;job.run().then(job.resolve,job.reject).finally(()=>{this.active--;this.pump();});}}
 request(file,background=false,playback=false){
  const old=this.records.get(file.url);if(old){if(playback)old.playback=true;if(!background){old.foreground=true;const queued=this.queue.find(j=>j.url===file.url);if(queued){this.queue.splice(this.queue.indexOf(queued),1);this.queue.unshift(queued);}this.pump();}return old.promise;}
  const record={loaded:0,total:this.sizes[file.url]||this.sizes[file.url.split('?')[0]]||0,done:false,blob:null,foreground:!background,playback};this.records.set(file.url,record);
  record.promise=new Promise((resolve,reject)=>{
   const job={url:file.url,resolve,reject,run:async()=>{
    const abort=new AbortController();record.abort=abort;let timer;const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>abort.abort(),45000);};
    try{
     touch();const response=await this.fetcher(file.url,{signal:abort.signal,cache:'default',priority:background?'low':'high'});
     if(!response.ok)throw new Error(`HTTP ${response.status}`);
     const length=Number(response.headers.get('content-length'));if(length>0&&!response.headers.get('content-encoding'))record.total=length;
     const chunks=[];
     if(response.body?.getReader){const reader=response.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);record.loaded+=value.byteLength;touch();this.notify();}}
     else {const bytes=await response.arrayBuffer();chunks.push(bytes);record.loaded=bytes.byteLength;}
     if(record.total&&record.loaded!==record.total)throw new Error('Incomplete image');
     record.total=record.loaded;record.blob=new Blob(chunks,{type:response.headers.get('content-type')||''});record.done=true;this.notify();return record.blob;
    }catch(error){if(this.records.get(file.url)===record)this.records.delete(file.url);throw new Error('연결이 끊겼어요. 받은 그림은 유지됩니다. 다시 시도해 주세요.',{cause:error});}
    finally{clearTimeout(timer);}
   }};if(background)this.queue.push(job);else this.queue.unshift(job);this.pump();
  });return record.promise;
 }
 async batch(files,onProgress=()=>{},background=false){
  const unique=[...new Map(files.map(f=>[f.url,f])).values()],observed=new Map();
  const report=()=>{let loaded=0,total=0,complete=0;for(const f of unique){const current=this.records.get(f.url);if(current)observed.set(f.url,{loaded:current.loaded,total:current.total,done:current.done});const r=current||observed.get(f.url);loaded+=r?.loaded||0;total+=r?.total||this.sizes[f.url]||this.sizes[f.url.split('?')[0]]||0;if(r?.done)complete++;}
   const progress={loaded,total,percent:total?Math.min(100,Math.floor(loaded/total*100)):unique.length?0:100,complete,count:unique.length,phase:'download'};
   if(!background)this.lastProgress=progress;onProgress(progress);
  };
  this.listeners.add(report);report();
  try{await Promise.all(unique.map(f=>this.request(f,background)));report();}finally{this.listeners.delete(report);}
 }
 take(url){const r=this.records.get(url);if(!r?.done)return null;if(!this.retainUrls.has(url))this.records.delete(url);return r.blob;}
 async prefetch(files,onProgress=()=>{}){
  this.future=new Set(files.map(f=>f.url));
  // Keep only one upcoming map in RAM. Previous decoded maps belong to the scene.
  for(const [url,r]of this.records)if(!this.future.has(url)&&!r.foreground&&!r.playback&&!this.retainUrls.has(url)){
   if(r.done)this.records.delete(url);
   else {const queued=this.queue.find(j=>j.url===url);if(queued){this.queue.splice(this.queue.indexOf(queued),1);this.records.delete(url);queued.reject(new Error('다음 맵이 바뀌었습니다.'));}else r.abort?.abort();}
  }
  await this.batch(files,onProgress,true);
 }
}
