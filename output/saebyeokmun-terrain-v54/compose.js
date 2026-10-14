async(page)=>{
 await page.goto('http://127.0.0.1:8880/');
 return await page.evaluate(async()=>{
  const files={old:'terrain-v53.png',stone:'stone-connected-v51.png',roof:'roof-v54.png',willow:'willow-v54.png'},images={};
  for(const [k,file]of Object.entries(files)){const im=new Image();im.src=file;await im.decode();images[k]=im;}
  const c=document.createElement('canvas');c.width=7272;c.height=720;const x=c.getContext('2d');
  for(let at=0;at<7272;at+=1212)x.drawImage(images.stone,0,0,1212,280,at,420,1212,280);
  x.clearRect(0,420,3636,280);x.drawImage(images.old,0,0,3636,280,0,420,3636,280);
  // Reuse the approved wood deck AND both solid-painted junctions, with their exact native coordinates.
  x.clearRect(4196,420,1240,280);x.drawImage(images.old,560,0,1240,280,4196,420,1240,280);
  // New roof/trees sit behind the existing walking lane. No path replacement, dissolve or alpha masks.
  x.drawImage(images.roof,400,0,1140,430,4246,40,1140,430);
  // Continue only the three structural posts down to the rear deck edge, preserving the original banks.
  for(const [at,width] of [[600,65],[947,65],[1293,65]])x.drawImage(images.roof,at,430,width,22,3846+at,470,width,22);
  x.drawImage(images.willow,0,0,1944,450,5330,40,1944,450);
  const widths=[680,1000,340,200,800,260,356,680,1000,1212,744];
  let at=0;const sections=widths.map((width,i)=>{const p={x:at,width,frame:'path'+i,height:720,foot:500,sourceY:0,sourceHeight:720};at+=width;return p;});
  const previews={};for(const [name,start,width]of [['roof',3980,1600],['willow',5300,1944]]){const p=document.createElement('canvas');p.width=width;p.height=720;p.getContext('2d').drawImage(c,start,0,width,720,0,0,width,720);previews[name]=p.toDataURL('image/png');}
  return {url:c.toDataURL('image/png'),width:c.width,height:c.height,sections,previews};
 });
}
