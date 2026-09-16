/**
 * ar-core.js — AR 걸음·방향·장애물 판정 (frontend/ar/ar-core.mjs 와 동일)
 * .mjs 는 Windows 의 Flask 가 JS 로 인식하지 못해 모듈 로딩이 막히므로 .js 로 둔다.
 */

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
