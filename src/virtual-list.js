export function visibleRange(count, rowHeight, listTop, viewportTop, viewportBottom, overscan = 5) {
  const start = Math.min(count, Math.max(0, Math.floor((viewportTop - listTop) / rowHeight) - overscan));
  const end = Math.min(count, Math.max(start, Math.ceil((viewportBottom - listTop) / rowHeight) + overscan));
  return { start, end };
}

// Both song lists and the queue keep DOM/image work bounded by viewport height.
export class VirtualList {
  constructor(element, renderRow, scroller = window) {
    this.element = element;
    this.renderRow = renderRow;
    this.scroller = scroller;
    this.items = [];
    this.nodes = new Map();
    this.frame = 0;
    element.classList.add('virtual-list');
    this.schedule = () => {
      if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
    };
    scroller.addEventListener('scroll', this.schedule, { passive: true });
    window.addEventListener('resize', this.schedule);
  }
  setItems(items) {
    this.items = items;
    this.element.style.height = `${items.length * 68}px`;
    this.element.dataset.count = items.length;
    this.draw();
  }
  draw() {
    if (!this.element.getClientRects().length) return;
    const top = this.element.getBoundingClientRect().top;
    const viewport = this.scroller === window ? { top: 40, bottom: window.innerHeight - 102 } : this.scroller.getBoundingClientRect();
    const { start, end } = visibleRange(this.items.length, 68, top, viewport.top, viewport.bottom);
    const keep = new Set();
    for (let i = start; i < end; i++) {
      const item = this.items[i];
      const key = item.id;
      const markup = this.renderRow(item, i);
      let node = this.nodes.get(key);
      if (!node || node._markup !== markup) {
        const template = document.createElement('template');
        template.innerHTML = markup;
        const next = template.content.firstElementChild;
        next._markup = markup;
        if (node) node.replaceWith(next); else this.element.append(next);
        node = next;
        this.nodes.set(key, node);
      }
      node.style.top = `${i * 68}px`;
      const position = this.element.children[i - start];
      if (position !== node) this.element.insertBefore(node, position || null);
      keep.add(key);
    }
    for (const [key, node] of this.nodes) {
      if (!keep.has(key)&&!node.classList.contains('track-dragging')) { node.remove(); this.nodes.delete(key); }
    }
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener('scroll', this.schedule);
    window.removeEventListener('resize', this.schedule);
  }
}
