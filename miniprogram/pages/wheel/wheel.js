Page({
  data: {
    pool: [],
    items: [],
    result: '吃什么、去哪玩、谁洗碗…\n让缘分替你决定 🎲',
    spinning: false
  },

  onLoad() {
    let pool = wx.getStorageSync('wheelPool');
    if (!Array.isArray(pool) || !pool.length) pool = ['火锅', '烧烤', '寿司', '麻辣烫', '甜品'];
    let items = wx.getStorageSync('wheelItems');
    if (!Array.isArray(items) || !items.length) items = pool.slice(0, Math.min(pool.length, 6));
    this.angle = 0;
    this.setData({ pool: pool, items: items }, () => this.draw());
  },

  savePool() { wx.setStorageSync('wheelPool', this.data.pool); },
  saveWheel() { wx.setStorageSync('wheelItems', this.data.items); },

  onInput(e) { this.input = e.detail.value; },

  add() {
    const v = (this.input || '').trim();
    if (!v) return;
    const pool = this.data.pool.slice();
    let items = this.data.items.slice();
    if (pool.indexOf(v) >= 0) { wx.showToast({ title: '已经有「' + v + '」了', icon: 'none' }); return; }
    if (pool.length >= 24) { wx.showToast({ title: '选项满啦，先删掉一些', icon: 'none' }); return; }
    pool.push(v);
    if (items.length < 12) items.push(v);
    this.input = '';
    this.setData({ pool: pool, items: items }, () => { this.savePool(); this.saveWheel(); this.draw(); });
  },

  toggle(e) {
    if (this.data.spinning) return;
    const i = Number(e.currentTarget.dataset.i);
    const o = this.data.pool[i];
    if (!o) return;
    let items = this.data.items.slice();
    const at = items.indexOf(o);
    if (at >= 0) {
      items.splice(at, 1);
      if (items.length < 2) this.setData({ result: '至少要两个选项才能开转哦' });
    } else {
      if (items.length >= 12) { wx.showToast({ title: '转盘最多 12 个选项', icon: 'none' }); return; }
      items.push(o);
    }
    this.setData({ items: items }, () => { this.saveWheel(); this.draw(); });
  },

  remove(e) {
    if (this.data.spinning) return;
    const i = Number(e.currentTarget.dataset.i);
    const o = this.data.pool[i];
    const pool = this.data.pool.slice();
    let items = this.data.items.slice();
    const at = items.indexOf(o);
    if (at >= 0) items.splice(at, 1);
    pool.splice(i, 1);
    this.setData({ pool: pool, items: items }, () => { this.savePool(); this.saveWheel(); this.draw(); });
  },

  draw() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#wheel').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio || 2;
      canvas.width = 440 * dpr;
      canvas.height = 440 * dpr;
      ctx.scale(dpr, dpr);
      const size = 440;
      const cx = size / 2, cy = size / 2, R = size / 2 - 10;
      ctx.clearRect(0, 0, size, size);
      const items = this.data.items;
      const n = items.length;
      if (!n) return;
      const arc = (Math.PI * 2) / n;
      const COLORS = ['#ff8fab', '#ffd3e0', '#ff9ebe', '#ffe6ee', '#f97ba8', '#ffc9d8', '#ff86ae', '#fbdce6'];
      for (let i = 0; i < n; i++) {
        const a0 = i * arc - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a0 + arc);
        ctx.closePath();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#7a1f43';
      ctx.font = 'bold 30px sans-serif';
      for (let i = 0; i < n; i++) {
        const mid = i * arc - Math.PI / 2 + arc / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(mid);
        let t = items[i];
        if (t.length > 6) t = t.slice(0, 6) + '…';
        ctx.fillText(t, R * 0.58, 0);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,107,157,.55)';
      ctx.lineWidth = 5;
      ctx.stroke();
    });
  },

  spin() {
    if (this.data.spinning) return;
    const items = this.data.items;
    if (items.length < 2) return wx.showToast({ title: '至少要两个选项才能纠结呀', icon: 'none' });
    const target = Math.floor(Math.random() * items.length);
    const arcDeg = 360 / items.length;
    const segCenter = target * arcDeg + arcDeg / 2;
    const jitter = (Math.random() - 0.5) * arcDeg * 0.6;
    const targetDeg = (360 - ((segCenter + jitter) % 360)) % 360;
    this.angle = this.angle + 360 * 5 + (((targetDeg - (this.angle % 360)) % 360) + 360) % 360;
    this.setData({ spinning: true, result: '转盘转转转…', spinStyle: 'transform: rotate(' + this.angle + 'deg)' });
    setTimeout(() => {
      const pick = items[target];
      this.setData({ spinning: false, result: '🎯 就去 ' + pick + '！' });
      wx.showToast({ title: '缘分已定：' + pick, icon: 'none' });
    }, 4300);
  }
});
