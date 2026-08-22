'use strict';

/**
 * scene3d.js — three.js 3D 装柜场景
 *
 * 业务坐标系：box = {x, y, z, dx, dy, dz}，其中 z 为高度方向（柜高轴）
 * three.js 映射：three.x = box.x, three.y = box.z(高度), three.z = box.y
 */
class Scene3D {
  constructor(containerEl) {
    this.el = containerEl;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 500000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.el.appendChild(this.renderer.domElement);

    // 灯光
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(2, 3, 2);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-2, 1, -1.5);
    this.scene.add(dir2);

    this.ground = new THREE.GridHelper(20000, 40, 0x9aa7b8, 0xd4dce6);
    this.ground.position.y = 0;
    this.scene.add(this.ground);

    // 柜体组
    this.contGroup = new THREE.Group();
    this.scene.add(this.contGroup);

    // 状态
    this.boxMeshes = []; // {mesh, box}
    this.current = null; // 当前柜型 {L,W,H}
    this.locked = true;
    this.selectedId = null;
    this.snap = 10;
    this._target = null;
    this._dragState = null;

    this.onChange = null;
    this.onSelect = null;

    this._bindControls();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._animate();
    this.setView('iso');
  }

  /* ---------------- 渲染 ---------------- */

  setContainer(container) {
    this.current = container;
    this._clearGroup(this.contGroup);
    this.boxMeshes = [];
    this.selectedId = null;
    if (!container) { this._target = null; return; }

    const { L, W, H } = container;
    // 底面
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(L / 2, 0, W / 2);
    this.contGroup.add(floor);

    // 柜体线框
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
      new THREE.LineBasicMaterial({ color: 0x2f6fed })
    );
    wire.position.set(L / 2, H / 2, W / 2);
    this.contGroup.add(wire);

    // 半透明壁
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(L, H, W),
      new THREE.MeshBasicMaterial({ color: 0x2f6fed, transparent: true, opacity: 0.05, side: THREE.DoubleSide })
    );
    wall.position.set(L / 2, H / 2, W / 2);
    this.contGroup.add(wall);

    this._addLabels(container);
    this._target = new THREE.Vector3(L / 2, H / 2, W / 2);
    this._fitCamera();
  }

  _addLabels({ L, W, H }) {
    const mk = (text, pos) => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#5b6b80';
      ctx.textAlign = 'center';
      ctx.fillText(text, 256, 44);
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      s.position.copy(pos);
      s.scale.set(1500, 190, 1);
      this.contGroup.add(s);
    };
    mk(`长 ${L} mm`, new THREE.Vector3(L / 2, -140, W + 130));
    mk(`宽 ${W} mm`, new THREE.Vector3(L + 130, -140, W / 2));
    mk(`高 ${H} mm`, new THREE.Vector3(L + 130, H / 2, W + 130));
  }

  setBoxes(boxes) {
    // 移除旧箱子
    for (const { mesh } of this.boxMeshes) {
      this.contGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.boxMeshes = [];
    boxes.forEach(b => this._addBox(b));
    this._refreshSelection();
  }

  _addBox(box) {
    const geo = new THREE.BoxGeometry(box.dx, box.dz, box.dy);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(box.color || '#4f9df7') });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(box.x + box.dx / 2, box.z + box.dz / 2, box.y + box.dy / 2);
    mesh.userData.clId = box.id;

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x1f2d3d, transparent: true, opacity: 0.5 })
    );
    mesh.add(edge);
    this.contGroup.add(mesh);
    this.boxMeshes.push({ mesh, box });
  }

  _clearGroup(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  /* ---------- 选中 ---------- */

  select(id) {
    this.selectedId = id;
    this._refreshSelection();
    if (this.onSelect) this.onSelect(id);
  }

  _refreshSelection() {
    for (const { mesh, box } of this.boxMeshes) {
      const sel = box.id === this.selectedId;
      mesh.material.color.set(sel ? new THREE.Color(0xffb020) : new THREE.Color(box.color || '#4f9df7'));
      mesh.material.emissive = sel ? new THREE.Color(0x442200) : new THREE.Color(0x000000);
    }
  }

  /* ---------- 视图 ---------- */

  setView(v) {
    const c = this.current;
    if (!c) return;
    const cx = c.L / 2, cy = c.W / 2, ch = c.H / 2;
    const dist = Math.max(c.L, c.W, c.H) * 1.9;
    const posMap = {
      front: [cx, ch, -dist],
      back: [cx, ch, dist],
      left: [-dist, ch, cy],
      right: [dist, ch, cy],
      top: [cx, dist, cy],
      iso: [cx + dist * 0.78, ch + dist * 0.5, cy + dist * 0.78]
    };
    const p = posMap[v] || posMap.iso;
    this.camera.position.set(p[0], p[1], p[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(cx, ch * 0.7, cy);
    this.camera.near = 1;
    this.camera.far = 500000;
  }

  _fitCamera() {
    const c = this.current;
    if (!c) return;
    const dist = Math.max(c.L, c.W, c.H) * 1.35;
    this.camera.position.set(c.L / 2 + dist * 0.72, c.H / 2 + dist * 0.45, c.W / 2 + dist * 0.72);
    this.camera.lookAt(c.L / 2, c.H / 2, c.W / 2);
    this.camera.near = 1;
    this.camera.far = 500000;
  }

  /* ---------- 交互 ---------- */

  _bindControls() {
    const el = this.el;
    const rc = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let orbit = null;

    const setNDC = (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };

    const pick = (e) => {
      setNDC(e);
      rc.setFromCamera(ndc, this.camera);
      const hits = rc.intersectObjects(this.boxMeshes.map(m => m.mesh), true);
      return hits.length ? hits[0].object : null;
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { orbit = { x: e.clientX, y: e.clientY }; return; }
      if (e.button !== 0) return;
      const obj = pick(e);
      if (obj && obj.userData.clId !== undefined) {
        this.select(obj.userData.clId);
        this._dragState = { mesh: obj, id: obj.userData.clId };
        el.style.cursor = 'grabbing';
      } else {
        this.select(null);
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (orbit) {
        const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
        orbit.x = e.clientX; orbit.y = e.clientY;
        this._orbit(dx, dy);
        return;
      }
      const d = this._dragState;
      if (!d || !d.mesh) return;
      const rec = this.boxMeshes.find(r => r.box.id === d.id);
      if (!rec) return;
      setNDC(e);
      const b = rec.box;
      const planeY = b.z + b.dz / 2;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      rc.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      if (!rc.ray.intersectPlane(plane, hit)) return;

      const cont = this.current;
      let nx = Math.round(hit.x - b.dx / 2);
      let ny = Math.round(hit.z - b.dy / 2);
      const snap = this.snap;
      nx = Math.round(nx / snap) * snap;
      ny = Math.round(ny / snap) * snap;
      nx = Math.max(0, Math.min(cont.L - b.dx, nx));
      ny = Math.max(0, Math.min(cont.W - b.dy, ny));
      if (this.locked) {
        const s = this._snap(nx, ny, b, cont);
        nx = s.x; ny = s.z;
      }
      b.x = nx; b.y = ny;
      if (this.locked) b.z = this._supportZ(b.x, b.y, b, cont);
      this._updateMesh(rec);
      if (this.onChange) this.onChange();
    });

    const endDrag = () => { this._dragState = null; this.el.style.cursor = ''; };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointerleave', endDrag);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this._target) return;
      const dir = this.camera.position.clone().sub(this._target);
      const factor = e.deltaY > 0 ? 1.08 : 0.92;
      this.camera.position.copy(this._target.clone().add(dir.multiplyScalar(factor)));
      this.camera.lookAt(this._target);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!this.selectedId) return;
      const rec = this.boxMeshes.find(r => r.box.id === this.selectedId);
      if (!rec) return;
      const key = e.key.toLowerCase();
      if (key === 'q' || key === 'e') {
        const b = rec.box, cc = this.current;
        [b.dx, b.dy] = [b.dy, b.dx]; // 绕高度轴旋转90°
        b.x = Math.max(0, Math.min(cc.L - b.dx, b.x));
        b.y = Math.max(0, Math.min(cc.W - b.dy, b.y));
        b.z = this._supportZ(b.x, b.y, b, cc);
        this._updateMesh(rec);
        this._refreshSelection();
        if (this.onChange) this.onChange();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        this.contGroup.remove(rec.mesh);
        this.boxMeshes = this.boxMeshes.filter(r => r.box.id !== this.selectedId);
        this.selectedId = null;
        this._refreshSelection();
        if (this.onChange) this.onChange();
      }
    });
  }

  _updateMesh(rec) {
    const { mesh, box } = rec;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(box.dx, box.dz, box.dy);
    // 更新边线
    const oldEdge = mesh.children[0];
    if (oldEdge) mesh.remove(oldEdge);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x1f2d3d, transparent: true, opacity: 0.5 })
    );
    mesh.add(edge);
    mesh.position.set(box.x + box.dx / 2, box.z + box.dz / 2, box.y + box.dy / 2);
  }

  _orbit(dx, dy) {
    if (!this._target) return;
    const offset = this.camera.position.clone().sub(this._target);
    const radius = offset.length();
    if (radius < 1) return;
    const theta = Math.atan2(offset.x, offset.z) - dx * 0.008;
    const phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius))) - dy * 0.008;
    const phi2 = Math.max(0.05, Math.min(Math.PI - 0.05, phi));
    offset.set(
      radius * Math.sin(phi2) * Math.sin(theta),
      radius * Math.cos(phi2),
      radius * Math.sin(phi2) * Math.cos(theta)
    );
    this.camera.position.copy(this._target.clone().add(offset));
    this.camera.lookAt(this._target);
  }

  /** 水平吸附：贴近其他箱子面或柜壁时对齐（业务 x/y 平面） */
  _snap(nx, ny, b, cont) {
    let bx = nx, by = ny;
    const th = Math.max(this.snap, 10);
    let best = th;
    for (const m of this.boxMeshes) {
      const ob = m.box;
      if (ob.id === b.id) continue;
      const candsX = [
        { v: ob.x - b.dx, d: Math.abs(nx + b.dx - ob.x) },
        { v: ob.x + ob.dx, d: Math.abs(nx - (ob.x + ob.dx)) }
      ];
      for (const c of candsX) if (c.d < best) { best = c.d; bx = c.v; }
      const candsY = [
        { v: ob.y - b.dy, d: Math.abs(ny + b.dy - ob.y) },
        { v: ob.y + ob.dy, d: Math.abs(ny - (ob.y + ob.dy)) }
      ];
      for (const c of candsY) if (c.d < best) { best = c.d; by = c.v; }
    }
    if (Math.abs(nx) < th) bx = 0;
    if (Math.abs(nx + b.dx - cont.L) < th) bx = cont.L - b.dx;
    if (Math.abs(ny) < th) by = 0;
    if (Math.abs(ny + b.dy - cont.W) < th) by = cont.W - b.dy;
    return { x: bx, z: by };
  }

  /** 支撑高度：最高重叠箱顶，否则 0 */
  _supportZ(nx, ny, b, cont) {
    let z = 0;
    for (const m of this.boxMeshes) {
      const ob = m.box;
      if (ob.id === b.id) continue;
      if (nx < ob.x + ob.dx && nx + b.dx > ob.x &&
          ny < ob.y + ob.dy && ny + b.dy > ob.y) {
        z = Math.max(z, ob.z + ob.dz);
      }
    }
    return Math.min(z, cont.H - b.dz);
  }

  /* ---------- 截图 ---------- */

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  screenshotViews(views) {
    const savedPos = this.camera.position.clone();
    const savedTarget = this._target ? this._target.clone() : null;
    const imgs = [];
    views.forEach(v => {
      this.setView(v);
      this.renderer.render(this.scene, this.camera);
      imgs.push(this.renderer.domElement.toDataURL('image/jpeg', 0.85));
    });
    this.camera.position.copy(savedPos);
    if (savedTarget) { this._target = savedTarget; this.camera.lookAt(savedTarget); }
    return imgs;
  }

  /* ---------- 动画/尺寸 ---------- */

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
