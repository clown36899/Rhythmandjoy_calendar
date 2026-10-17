// Authored stage-two scenery. Journey still owns combat, movement and rewards.
// walkLine uses normalized source coordinates; the whole near foreground stays intact.
const line=points=>points.map(([x,y])=>[x/1916,y/821]);
const tile=(n,x,walkLine,fade=0,foot=542)=>({file:`stage2-ink-ground-${n}-v145.webp`,maskFile:`stage2-ink-mask-${n}-v145.webp`,x,width:n===1?1915:1916,height:821,foot,walkLine:line(walkLine),fade:[fade,216]});
export const STAGE2_ART={
 file:'stage2-entry-field-far-v146.webp',detailFiles:[],skyInPainting:false,sunFile:'stage2-sun-v1-v146.webp',paintingFoot:540/821,
 roadAtlas:null,roadFinite:true,actorScale:1.02,shadowOpacity:.65,
 roadEnd:7600,
 roadTiles:[
  tile(2,0,[[0,566],[450,573],[900,587],[1300,594],[1600,578],[1916,569]],0,540),
  tile(3,1700,[[0,588],[400,593],[800,611],[1200,625],[1600,625],[1916,612]],216,553),
  tile(4,3400,[[0,602],[400,611],[800,624],[1200,641],[1600,642],[1916,639]],216,534),
  tile(5,5100,[[0,597],[400,607],[800,626],[1200,640],[1600,641],[1916,622]],216,490),
  {...tile(7,6800,[[0,578],[400,594],[900,618],[1400,622],[1916,610]],216,433),file:'stage2-ink-ground-7-v146.webp',maskFile:'stage2-ink-mask-7-v146.webp'}
 ]
};
