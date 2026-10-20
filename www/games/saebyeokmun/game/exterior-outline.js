// Delivered from the local maker art-outline.mjs; keep the same exterior mask algorithm.
// One exterior-only silhouette owner for both local artwork comparison views.
// Flood-fill exterior transparency, so bow/arm holes are not given new outlines.
const masks=new WeakMap();
export function exteriorMask(image,crop=null){
 const key=crop?.join(',')||'full';let cache=masks.get(image);
 if(!cache){cache=new Map();masks.set(image,cache);}if(cache.has(key))return cache.get(key);
 const [sx,sy,w,h]=crop||[0,0,image.naturalWidth||image.width,image.naturalHeight||image.height];
 const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(image,sx,sy,w,h,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h),data=pixels.data;
 const outside=new Uint8Array(w*h),queue=new Int32Array(w*h);let read=0,end=0;
 const visit=i=>{if(!outside[i]&&data[i*4+3]<=175){outside[i]=1;queue[end++]=i;}};
 for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x);}for(let y=1;y<h-1;y++){visit(y*w);visit(y*w+w-1);}
 while(read<end){const i=queue[read++],x=i%w;if(x)visit(i-1);if(x<w-1)visit(i+1);if(i>=w)visit(i-w);if(i<w*(h-1))visit(i+w);}
 for(let i=0;i<w*h;i++){data[i*4]=data[i*4+1]=data[i*4+2]=0;data[i*4+3]=outside[i]?0:255;}
 ctx.putImageData(pixels,0,0);cache.set(key,c);return c;
}
export function outlineLayer(mask,width,height,radius){
 const pad=Math.ceil(radius)+2,c=document.createElement('canvas');c.width=Math.ceil(width)+2*pad;c.height=Math.ceil(height)+2*pad;
 const ctx=c.getContext('2d');for(let n=0;n<32;n++){const a=n*Math.PI/16;ctx.drawImage(mask,pad+Math.cos(a)*radius,pad+Math.sin(a)*radius,width,height);}
 ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,pad,pad,width,height);
 return {canvas:c,pad};
}
