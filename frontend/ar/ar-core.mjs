export function headingDifference(a,b){return Math.abs(((a-b+540)%360)-180)}

export function advanceDistance(distance,{currentHeading,target=0,step=.7}={}){
 if(currentHeading==null)return{distance,reason:'heading-unavailable'};
 if(headingDifference(target,currentHeading)>55)return{distance,reason:'wrong-direction'};
 return{distance:Math.max(0,+(distance-step).toFixed(2)),reason:'advanced'};
}

export function largeObstacle(item,w,h){
 const [x,y,bw,bh]=item.bbox,area=bw*bh/(w*h),center=(x+bw/2)/w;
 return area>=.14&&center>.22&&center<.78&&y+bh>h*.42;
}
