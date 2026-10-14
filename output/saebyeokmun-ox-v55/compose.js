async(page)=>{
 await page.goto('http://127.0.0.1:8881/');
 return await page.evaluate(async()=>{
  const sequences={walk:Array.from({length:48},(_,i)=>i),run:Array.from({length:48},(_,i)=>60+i),attack:Array.from({length:48},(_,i)=>Math.round(i<24?192+i/23*15:207+(i-24)/23*32)),idle:[0]};
  const order=[...sequences.walk,...sequences.run,...sequences.attack,...sequences.idle];
  const cellW=300,cellH=220,cols=12,rows=13,c=document.createElement('canvas');c.width=cellW*cols;c.height=cellH*rows;const ctx=c.getContext('2d');
  const cache=new Map();
  for(let slot=0;slot<order.length;slot++){
   const frame=order[slot];let im=cache.get(frame);
   if(!im){const source=new Image();source.src='frames/frame-'+String(frame+1).padStart(3,'0')+'.png';await source.decode();
    im=document.createElement('canvas');im.width=cellW;im.height=cellH;const g=im.getContext('2d');g.drawImage(source,170,75,cellW,cellH,0,0,cellW,cellH);
    const pixels=g.getImageData(0,0,cellW,cellH),p=pixels.data,seen=new Uint8Array(cellW*cellH),queue=new Int32Array(cellW*cellH);let head=0,tail=0;
    const add=i=>{if(i<0||i>=seen.length||seen[i])return;const k=i*4;if(p[k]<235||p[k+1]<235||p[k+2]<235)return;seen[i]=1;queue[tail++]=i;};
    for(let x=0;x<cellW;x++){add(x);add((cellH-1)*cellW+x);}for(let y=0;y<cellH;y++){add(y*cellW);add(y*cellW+cellW-1);}
    while(head<tail){const at=queue[head++];p[at*4+3]=0;const x=at%cellW;if(x>0)add(at-1);if(x<cellW-1)add(at+1);add(at-cellW);add(at+cellW);}
    g.putImageData(pixels,0,0);cache.set(frame,im);
   }
   ctx.drawImage(im,slot%cols*cellW,Math.floor(slot/cols)*cellH);
  }
  const previews={};for(const [name,slot]of [['walk',12],['run',60],['attack',120]]){const p=document.createElement('canvas');p.width=cellW;p.height=cellH;p.getContext('2d').drawImage(c,slot%cols*cellW,Math.floor(slot/cols)*cellH,cellW,cellH,0,0,cellW,cellH);previews[name]=p.toDataURL('image/png');}
  return {url:c.toDataURL('image/png'),width:c.width,height:c.height,sequences,frames:order.length,previews};
 });
}
