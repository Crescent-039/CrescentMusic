import koffi from 'koffi';

// DWM receives the artwork bitmap directly, independently of the window surface.
export function createTaskbarArtwork(win,onError,ffi=koffi) {
  const dwm=ffi.load('dwmapi.dll'),gdi=ffi.load('gdi32.dll');
  const attribute=dwm.func('long __stdcall DwmSetWindowAttribute(void *, uint32_t, const void *, uint32_t)');
  const invalidate=dwm.func('long __stdcall DwmInvalidateIconicBitmaps(void *)');
  const thumbnail=dwm.func('long __stdcall DwmSetIconicThumbnail(void *, void *, uint32_t)');
  const preview=dwm.func('long __stdcall DwmSetIconicLivePreviewBitmap(void *, void *, void *, uint32_t)');
  const bitmap=gdi.func('void * __stdcall CreateDIBSection(void *, const void *, uint32_t, void *, void *, uint32_t)');
  const deleteObject=gdi.func('int __stdcall DeleteObject(void *)');
  const hwnd=ffi.decode(win.getNativeWindowHandle(),'void *');
  const check=(result,name)=>{if(result<0)throw new Error(`${name} 失败：0x${(result>>>0).toString(16)}`);};
  const enabled=Buffer.alloc(4);enabled.writeInt32LE(1);
  check(attribute(hwnd,7,enabled,4),'启用封面缩略图');
  check(attribute(hwnd,10,enabled,4),'启用自定义封面');
  let artwork;
  function send(width,height,live=false){
    if(!artwork)return;
    const size=Math.min(width,height,512),image=artwork.resize({width:size,height:size,quality:'best'}),pixels=image.toBitmap();
    const info=Buffer.alloc(44);info.writeUInt32LE(40,0);info.writeInt32LE(size,4);info.writeInt32LE(-size,8);info.writeUInt16LE(1,12);info.writeUInt16LE(32,14);info.writeUInt32LE(pixels.length,20);
    const bits=Buffer.alloc(8),handle=bitmap(null,info,0,bits,null,0);
    if(!handle)throw new Error('创建任务栏封面位图失败');
    try{ffi.encode(ffi.decode(bits,'void *'),'uint8_t',pixels,pixels.length);check(live?preview(hwnd,handle,null,0):thumbnail(hwnd,handle,0),'更新任务栏封面');}finally{deleteObject(handle);}
  }
  win.hookWindowMessage(0x0323,(_w,l)=>{
    try{const dimensions=l.readUInt32LE();send(dimensions>>>16,dimensions&0xffff);}catch(error){onError(error);}
  });
  win.hookWindowMessage(0x0326,()=>{try{send(200,200,true);}catch(error){onError(error);}});
  return {set(image){artwork=image;check(invalidate(hwnd),'刷新任务栏封面');}};
}
