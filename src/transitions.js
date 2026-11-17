const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const animations=new WeakMap();
function animate(element,frames,duration){
  animations.get(element)?.cancel();
  const animation=element.animate(frames,{duration:reduceMotion()?0:duration,easing:'cubic-bezier(.2,.75,.25,1)'});
  animations.set(element,animation);return animation;
}
export function showPanel(element,kind='detail'){
  element.classList.remove('hidden');
  animate(element,kind==='drawer'?[{opacity:0,transform:'translateX(28px)'},{opacity:1,transform:'translateX(0)'}]:[{opacity:0,transform:'translateY(26px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],260);
}
export function hidePanel(element,kind='detail'){
  const animation=animate(element,[{opacity:1,transform:'none'},{opacity:0,transform:kind==='drawer'?'translateX(28px)':'translateY(22px) scale(.99)'}],180);
  animation.onfinish=()=>{element.classList.add('hidden');};
}
export function transitionPage(element){animate(element,[{opacity:.3,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)'}],200);}
