async (page) => {
  await page.goto('http://127.0.0.1:8880/');
  return await page.evaluate(async () => {
    const files={stone:'stone-connected-v51.png',wood:'wood-bridge-v51.png',steps:'steps-v52.png',brush:'brush-v52.png'};
    const images={};
    for(const [key,file] of Object.entries(files)){const im=new Image();im.src=file;await im.decode();images[key]=im;}
    const widths=[680,1000,340,200,800,260,356];
    const names=['돌다리','나무다리','수풀길','돌길','징검다리','수풀길','돌길'];
    let position=0;
    const sections=widths.map((width,i)=>{const part={name:names[i],x:position,width,frame:'path'+i,height:280,foot:80,sourceY:0,sourceHeight:280};position+=width;return part;});
    const atlas=document.createElement('canvas');atlas.width=position;atlas.height=280;
    const ctx=atlas.getContext('2d');
    for(let x=0;x<position;x+=1212)ctx.drawImage(images.stone,0,0,1212,280,x,0,1212,280);
    function insertBridge(image,source,x,width){
      const layer=document.createElement('canvas');layer.width=width;layer.height=280;
      const l=layer.getContext('2d');l.drawImage(image,...source,0,0,width,280);
      const mask=document.createElement('canvas');mask.width=width;mask.height=280;
      const m=mask.getContext('2d'),g=m.createLinearGradient(0,0,width,0),feather=50/width;
      g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(feather,'rgba(0,0,0,1)');g.addColorStop(1-feather,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');m.fillStyle=g;m.fillRect(0,0,width,280);
      ctx.save();ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,x,0);ctx.restore();
      l.globalCompositeOperation='destination-in';l.drawImage(mask,0,0);ctx.drawImage(layer,x,0);
    }
    insertBridge(images.wood,[470,380,1000,280],680,1000);
    insertBridge(images.steps,[280,285,1400,490],2220,800);
    // Only plants above the foot plane are used; the generated duplicate road is discarded.
    ctx.drawImage(images.brush,600,380,340,76,1680,0,340,76);
    ctx.drawImage(images.brush,1000,380,260,76,3020,0,260,76);
    const crops={};
    for(const part of sections){
      const c=document.createElement('canvas');c.width=part.width;c.height=280;
      c.getContext('2d').drawImage(atlas,part.x,0,part.width,280,0,0,part.width,280);
      crops[part.frame]={url:c.toDataURL('image/webp',.9),width:part.width,height:280,name:part.name};
    }
    const preview=atlas.toDataURL('image/webp',.84);
    return {url:atlas.toDataURL('image/png'),preview,width:atlas.width,height:280,sections,crops};
  });
}
