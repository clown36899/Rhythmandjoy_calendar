async(page)=>{
 await page.goto('http://127.0.0.1:8881/');
 return await page.evaluate(async()=>{
  const cellW=300,cellH=220,cols=12,rows=13,c=document.createElement('canvas');c.width=cellW*cols;c.height=cellH*rows;const ctx=c.getContext('2d',{willReadFrequently:true});
  const old=new Image();old.src='atlas.png';await old.decode();ctx.drawImage(old,0,0);
  const raw=ctx.getImageData(0,0,c.width,c.height);let supportingBottom=0;
  for(let frame=0;frame<48;frame++)for(let y=0;y<cellH;y++)for(let x=0;x<cellW;x++)if(raw.data[((Math.floor(frame/cols)*cellH+y)*c.width+frame%cols*cellW+x)*4+3])supportingBottom=Math.max(supportingBottom,y+1);
  const walk=Array.from({length:48},(_,i)=>34+Math.floor(i*29/48)),idle=0,cache=new Map();
  for(const frame of new Set([...walk,idle])){
   const source=new Image();source.src='walk-frames/frame-'+String(frame+1).padStart(3,'0')+'.png';await source.decode();
   const im=document.createElement('canvas');im.width=cellW;im.height=cellH;const g=im.getContext('2d',{willReadFrequently:true});g.drawImage(source,170,75,cellW,cellH,0,0,cellW,cellH);
   const pixels=g.getImageData(0,0,cellW,cellH),p=pixels.data,seen=new Uint8Array(cellW*cellH),queue=new Int32Array(cellW*cellH);let head=0,tail=0;
   const add=i=>{if(i<0||i>=seen.length||seen[i])return;const k=i*4;if(p[k]<235||p[k+1]<235||p[k+2]<235)return;seen[i]=1;queue[tail++]=i;};
   for(let x=0;x<cellW;x++){add(x);add((cellH-1)*cellW+x);}for(let y=0;y<cellH;y++){add(y*cellW);add(y*cellW+cellW-1);}
   while(head<tail){const at=queue[head++];p[at*4+3]=0;const x=at%cellW;if(x>0)add(at-1);if(x<cellW-1)add(at+1);add(at-cellW);add(at+cellW);}
   cache.set(frame,pixels);
  }
  let newBottom=0;for(const frame of walk){const p=cache.get(frame).data;for(let y=0;y<cellH;y++)for(let x=0;x<cellW;x++)if(p[(y*cellW+x)*4+3])newBottom=Math.max(newBottom,y+1);}
  const shiftY=supportingBottom-newBottom;
  for(const [slot,frame]of [...walk.map((f,i)=>[i,f]),[144,idle]]){
   const destX=slot%cols*cellW,destY=Math.floor(slot/cols)*cellH;
   ctx.clearRect(destX,destY,cellW,cellH);ctx.putImageData(cache.get(frame),destX,destY+shiftY,0,Math.max(0,-shiftY),cellW,cellH-Math.abs(shiftY));
  }
  const previews={};for(const [name,slot]of [['walk',12],['run',60],['attack',120]]){const p=document.createElement('canvas');p.width=cellW;p.height=cellH;p.getContext('2d').drawImage(c,slot%cols*cellW,Math.floor(slot/cols)*cellH,cellW,cellH,0,0,cellW,cellH);previews[name]=p.toDataURL('image/png');}
  return{url:c.toDataURL('image/png'),width:c.width,height:c.height,frames:145,walkSourceFrames:walk,idleSourceFrame:idle,shiftY,supportingBottom,newBottom,previews};
 });
}
