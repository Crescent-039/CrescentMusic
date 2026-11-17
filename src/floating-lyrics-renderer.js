window.desktopLyrics.onData(data=>{
  document.querySelector('#floating-title').textContent=data.title;
  document.querySelector('#floating-line').textContent=data.line;
  document.querySelector('#floating-next').textContent=data.next;
  document.querySelector('#floating-toggle').textContent=data.playing?'Ⅱ':'▶';
});
document.addEventListener('click',event=>{const button=event.target.closest('[data-control]');if(button)window.desktopLyrics.control(button.dataset.control);});
