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
      ctx.clearRect(x,0,width,280);ctx.drawImage(layer,x,0);
    }
    insertBridge(images.wood,[470,380,1000,280],680,1000);
    insertBridge(images.steps,[280,285,1400,490],2220,800);
    // Only plants above the foot plane are used; the generated duplicate road is discarded.
    // Keep this landing's original sparse vegetation; the added tuft straddled its new abutment.
    ctx.drawImage(images.brush,1000,380,260,76,3020,0,260,76);
    // Replace the join artwork completely; never dissolve materials or leave old bank pixels below it.
    for(const [name,x] of [['wood-entry',680],['wood-exit',1680],['steps-entry',2220],['steps-exit',3020]]){
      const im=new Image();im.src=name+'-repair-v53.png';await im.decode();
      const scale=im.width/600;
      ctx.clearRect(x-120,0,240,280);
      ctx.drawImage(im,180*scale,0,240*scale,im.height,x-120,0,240,280);
    }
    const junctions={};
    for(const [name,x] of [['wood-entry',680],['wood-exit',1680],['steps-entry',2220],['steps-exit',3020]]){
      const c=document.createElement('canvas');c.width=600;c.height=280;
      c.getContext('2d').drawImage(atlas,x-300,0,600,280,0,0,600,280);
      junctions[name]={url:c.toDataURL('image/png'),preview:c.toDataURL('image/webp',.9),x,width:600,height:280};
    }
    const crops={};
    for(const part of sections){
      const c=document.createElement('canvas');c.width=part.width;c.height=280;
      c.getContext('2d').drawImage(atlas,part.x,0,part.width,280,0,0,part.width,280);
      crops[part.frame]={url:c.toDataURL('image/webp',.9),width:part.width,height:280,name:part.name};
    }
    const before={};const old=new Image();old.src='terrain-before-v52.png';await old.decode();
    for(const [name,j] of Object.entries(junctions)){const c=document.createElement('canvas');c.width=600;c.height=280;c.getContext('2d').drawImage(old,j.x-300,0,600,280,0,0,600,280);before[name]=c.toDataURL('image/webp',.9);}
    const preview=atlas.toDataURL('image/webp',.84);
    return {url:atlas.toDataURL('image/png'),preview,width:atlas.width,height:280,sections,crops,junctions,before};
  });
}
